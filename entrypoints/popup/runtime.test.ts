import { describe, expect, it } from 'vitest';
import type { Model, Msg, ReadyModel } from '@/lib/core/popup/model';
import type { Services } from '@/lib/core/popup/services';
import { bootSnapshot, NOW, syncWith } from '@/lib/core/popup/test-model';
import type { YnabBudget } from '@/lib/core/ynab';
import { createPopupRuntime } from './runtime';

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve(value: Value): void;
  reject(reason: unknown): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve: (value: Value) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function fakeServices(overrides: Partial<Services> = {}) {
  const emitted: { emit: (msg: Msg) => void } = { emit: () => undefined };
  const logged: [string, string][] = [];
  const stopped = { watch: false, ticker: false };
  const services: Services = {
    clock: { nowIso: () => NOW },
    boot: { read: () => Promise.resolve(bootSnapshot({ ynabConnected: false })) },
    watch: (onMsg) => {
      emitted.emit = onMsg;
      return () => {
        stopped.watch = true;
      };
    },
    settings: { patch: () => Promise.resolve() },
    ynab: { loadBudgets: () => Promise.resolve([]), disconnect: () => Promise.resolve() },
    amazon: { requestPermission: () => Promise.resolve(true), openLogin: () => Promise.resolve() },
    background: { send: () => Promise.resolve() },
    files: { download: () => undefined },
    logger: {
      error: (context, detail) => {
        logged.push([context, detail]);
      },
    },
    ticker: {
      every: () => () => {
        stopped.ticker = true;
      },
    },
    ...overrides,
  };
  return { services, emitted, logged, stopped };
}

function ready(model: Model): ReadyModel {
  if (model.kind !== 'ready') throw new Error(`expected ready, got ${model.kind}`);
  return model;
}

describe('createPopupRuntime', () => {
  it('a storage change during boot wins over the boot snapshot', async () => {
    const read = deferred<ReturnType<typeof bootSnapshot>>();
    const { services, emitted } = fakeServices({ boot: { read: () => read.promise } });
    const runtime = createPopupRuntime(services);

    emitted.emit({ type: 'syncStateChanged', sync: syncWith({ status: 'scanning' }) });
    read.resolve(bootSnapshot({ ynabConnected: false, sync: syncWith({ status: 'idle' }) }));
    await flush();

    expect(ready(runtime.getModel()).sync.status).toBe('scanning');
  });

  it('a stale budget reply does not replace a newer one', async () => {
    const replies = [deferred<YnabBudget[]>(), deferred<YnabBudget[]>()];
    let calls = 0;
    const { services, emitted } = fakeServices({
      ynab: {
        loadBudgets: () => {
          const reply = replies[calls];
          calls++;
          if (!reply) throw new Error('unexpected loadBudgets call');
          return reply.promise;
        },
        disconnect: () => Promise.resolve(),
      },
    });
    const runtime = createPopupRuntime(services);
    await flush();

    emitted.emit({ type: 'tokenChanged', connected: true });
    emitted.emit({ type: 'tokenChanged', connected: false });
    emitted.emit({ type: 'tokenChanged', connected: true });
    replies[1]?.resolve([{ id: 'new', name: 'New' }]);
    await flush();
    replies[0]?.resolve([{ id: 'old', name: 'Old' }]);
    await flush();

    expect(ready(runtime.getModel()).budgets).toEqual({ kind: 'loaded', value: [{ id: 'new', name: 'New' }] });
  });

  it('a failed effect is logged and does not leave Apply pending', async () => {
    const { services, logged } = fakeServices({
      background: { send: () => Promise.reject(new Error('no receiver')) },
      boot: { read: () => Promise.resolve(bootSnapshot()) },
    });
    const runtime = createPopupRuntime(services);
    await flush();

    runtime.dispatch({ type: 'scanPressed' });
    await flush();

    expect(logged).toContainEqual(['sendBackground', 'no receiver']);
    expect(ready(runtime.getModel()).applyPending).toBe(false);
  });

  it('notifies subscribers with each new model', async () => {
    const { services } = fakeServices();
    const runtime = createPopupRuntime(services);
    const seen: string[] = [];
    runtime.subscribe((model) => seen.push(model.kind));
    await flush();
    expect(seen).toEqual(['ready']);
  });

  it('dispose stops the watcher and the ticker', () => {
    const { services, stopped } = fakeServices();
    createPopupRuntime(services).dispose();
    expect(stopped).toEqual({ watch: true, ticker: true });
  });

  it('reports a boot failure', async () => {
    const { services, logged } = fakeServices({ boot: { read: () => Promise.reject(new Error('quota')) } });
    const runtime = createPopupRuntime(services);
    await flush();
    expect(runtime.getModel()).toEqual({
      kind: 'boot-failed',
      message: 'The popup could not start. Close it and open it again.',
    });
    expect(logged).toContainEqual(['Boot', 'quota']);
  });
});
