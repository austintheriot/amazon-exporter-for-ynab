import { BOOT_FAILED } from '@/lib/core/copy';
import type { Effect, Model, Msg } from '@/lib/core/popup/model';
import type { Services } from '@/lib/core/popup/services';
import { update } from '@/lib/core/popup/update';

const TICK_MS = 30_000;

export interface PopupRuntime {
  getModel(): Model;
  dispatch(msg: Msg): void;
  subscribe(listener: (model: Model) => void): () => void;
  dispose(): void;
}

const detailOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function createPopupRuntime(services: Services): PopupRuntime {
  let model: Model = { kind: 'booting' };
  let disposed = false;
  const listeners = new Set<(model: Model) => void>();
  const queuedDuringBoot: Msg[] = [];

  const fail = (effect: Effect['type']) => (err: unknown) => {
    dispatch({ type: 'effectFailed', effect, message: detailOf(err) });
  };

  function run(effect: Effect): void {
    switch (effect.type) {
      case 'loadBudgets':
        services.ynab.loadBudgets().then(
          (budgets) => {
            dispatch({ type: 'budgetsLoaded', requestId: effect.requestId, budgets });
          },
          (err: unknown) => {
            dispatch({ type: 'budgetsFailed', requestId: effect.requestId, message: detailOf(err) });
          },
        );
        return;
      case 'persistSettings':
        services.settings.patch(effect.patch).catch(fail(effect.type));
        return;
      case 'sendBackground':
        services.background.send(effect.message).catch(fail(effect.type));
        return;
      case 'requestAmazonPermission':
        services.amazon.requestPermission().then((granted) => {
          dispatch({ type: 'amazonPermissionResolved', granted });
        }, fail(effect.type));
        return;
      case 'openAmazonLogin':
        services.amazon.openLogin().catch(fail(effect.type));
        return;
      case 'disconnectYnab':
        services.ynab.disconnect().catch(fail(effect.type));
        return;
      case 'downloadFile':
        try {
          services.files.download(effect.name, effect.json);
        } catch (err) {
          fail(effect.type)(err);
        }
        return;
      case 'logError':
        services.logger.error(effect.context, effect.detail);
        return;
    }
  }

  function dispatch(msg: Msg): void {
    if (disposed) return;
    if (model.kind === 'booting' && msg.type !== 'booted' && msg.type !== 'bootFailed') {
      queuedDuringBoot.push(msg);
      return;
    }
    const [next, effects] = update(model, msg);
    model = next;
    for (const listener of listeners) listener(model);
    for (const effect of effects) run(effect);
    if (msg.type === 'booted') {
      for (const queued of queuedDuringBoot.splice(0)) dispatch(queued);
    }
  }

  const stopWatching = services.watch(dispatch);
  const stopTicking = services.ticker.every(TICK_MS, () => {
    dispatch({ type: 'tick', now: services.clock.nowIso() });
  });
  services.boot.read().then(
    (snapshot) => {
      dispatch({ type: 'booted', snapshot: { ...snapshot, now: services.clock.nowIso() } });
    },
    (err: unknown) => {
      services.logger.error('Boot', detailOf(err));
      dispatch({ type: 'bootFailed', message: BOOT_FAILED });
    },
  );

  return {
    getModel: () => model,
    dispatch,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => {
      disposed = true;
      stopWatching();
      stopTicking();
      listeners.clear();
    },
  };
}
