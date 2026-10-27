import { describe, expect, it } from 'vitest';
import type { Effect, Model, Msg, ReadyModel } from './model';
import { bootSnapshot, NOW, readyModel, scannedSync, syncWith } from './test-model';
import { isBusy, pendingIds, update } from './update';

function ready(model: Model): ReadyModel {
  if (model.kind !== 'ready') throw new Error(`expected ready, got ${model.kind}`);
  return model;
}

const step = (model: Model, msg: Msg): [ReadyModel, Effect[]] => {
  const [next, effects] = update(model, msg);
  return [ready(next), effects];
};

const scanned = (overrides: Partial<ReadyModel> = {}): ReadyModel => {
  const sync = scannedSync();
  return readyModel({
    sync,
    selection: new Set(pendingIds(sync)),
    selectionScanAt: sync.lastScanAt,
    ...overrides,
  });
};

describe('boot', () => {
  it('becomes ready with every pending match selected and loads budgets', () => {
    const [model, effects] = step({ kind: 'booting' }, {
      type: 'booted',
      snapshot: bootSnapshot({ sync: scannedSync() }),
    });
    expect([...model.selection]).toEqual(['txn-1', 'txn-2']);
    expect(model.budgets).toEqual({ kind: 'loading', requestId: 1 });
    expect(effects).toEqual([{ type: 'loadBudgets', requestId: 1 }]);
  });

  it('does not load budgets when YNAB is not connected', () => {
    const [model, effects] = step({ kind: 'booting' }, {
      type: 'booted',
      snapshot: bootSnapshot({ ynabConnected: false }),
    });
    expect(model.budgets).toEqual({ kind: 'idle' });
    expect(effects).toEqual([]);
  });

  it('ignores other messages while booting', () => {
    expect(update({ kind: 'booting' }, { type: 'scanPressed' })).toEqual([{ kind: 'booting' }, []]);
  });

  it('records a boot failure', () => {
    expect(update({ kind: 'booting' }, { type: 'bootFailed', message: 'boom' })).toEqual([
      { kind: 'boot-failed', message: 'boom' },
      [],
    ]);
  });

  it('shows a scan already running when the popup opens', () => {
    const [model] = step({ kind: 'booting' }, {
      type: 'booted',
      snapshot: bootSnapshot({ sync: syncWith({ status: 'scanning', message: 'Reading YNAB transactions…' }) }),
    });
    expect(isBusy(model.sync)).toBe(true);
    expect(step(model, { type: 'scanPressed' })[1]).toEqual([]);
  });
});

describe('budgets', () => {
  it('ignores a stale budget reply', () => {
    const model = readyModel({ budgets: { kind: 'loading', requestId: 3 } });
    const [next] = step(model, { type: 'budgetsLoaded', requestId: 2, budgets: [] });
    expect(next.budgets).toEqual({ kind: 'loading', requestId: 3 });
  });

  it('stores the current budget reply', () => {
    const model = readyModel({ budgets: { kind: 'loading', requestId: 3 } });
    const budgets = [{ id: 'b9', name: 'Nine' }];
    expect(step(model, { type: 'budgetsLoaded', requestId: 3, budgets })[0].budgets).toEqual({
      kind: 'loaded',
      value: budgets,
    });
  });

  it('records a budget failure and logs it', () => {
    const model = readyModel({ budgets: { kind: 'loading', requestId: 3 } });
    const [next, effects] = step(model, { type: 'budgetsFailed', requestId: 3, message: 'nope' });
    expect(next.budgets.kind).toBe('failed');
    expect(effects).toEqual([{ type: 'logError', context: 'Load budgets', detail: 'nope' }]);
  });

  it('loads budgets when a token arrives', () => {
    const model = readyModel({ ynabConnected: false, budgets: { kind: 'idle' }, nextRequestId: 5 });
    const [next, effects] = step(model, { type: 'tokenChanged', connected: true });
    expect(next.ynabConnected).toBe(true);
    expect(effects).toEqual([{ type: 'loadBudgets', requestId: 5 }]);
    expect(next.nextRequestId).toBe(6);
  });

  it('clears budgets when the token goes away', () => {
    const [next, effects] = step(readyModel(), { type: 'tokenChanged', connected: false });
    expect(next.ynabConnected).toBe(false);
    expect(next.budgets).toEqual({ kind: 'idle' });
    expect(effects).toEqual([]);
  });
});

describe('settings', () => {
  it('persists a picked budget with its name', () => {
    const [next, effects] = step(readyModel(), { type: 'budgetPicked', budgetId: 'b2' });
    expect(next.settings.budgetId).toBe('b2');
    expect(effects).toEqual([
      { type: 'persistSettings', patch: { budgetId: 'b2', budgetName: 'Personal' } },
    ]);
  });

  it('persists a picked year and updates the model at once', () => {
    const [next, effects] = step(readyModel(), { type: 'yearPicked', year: 2024 });
    expect(next.settings.year).toBe(2024);
    expect(effects).toEqual([{ type: 'persistSettings', patch: { year: 2024 } }]);
  });

  it('clamps a large order limit and says so', () => {
    const [next, effects] = step(readyModel(), { type: 'orderLimitEntered', raw: '500' });
    expect(next.orderLimitHint).toBe('Max 200');
    expect(next.settings.orderLimit).toBe(200);
    expect(effects).toEqual([{ type: 'persistSettings', patch: { orderLimit: 200 } }]);
  });

  it.each(['0', '', 'abc', '-3'])('rejects order limit %j without saving', (raw) => {
    const [next, effects] = step(readyModel(), { type: 'orderLimitEntered', raw });
    expect(next.orderLimitHint).toBe('Enter a number from 1 to 200');
    expect(effects).toEqual([]);
  });

  it('saves a valid order limit and clears the hint', () => {
    const [next, effects] = step(readyModel({ orderLimitHint: 'Max 200' }), {
      type: 'orderLimitEntered',
      raw: '50',
    });
    expect(next.orderLimitHint).toBeNull();
    expect(effects).toEqual([{ type: 'persistSettings', patch: { orderLimit: 50 } }]);
  });

  it('takes settings changed elsewhere', () => {
    const settings = { ...readyModel().settings, maxDays: 3 };
    expect(step(readyModel(), { type: 'settingsChanged', settings })[0].settings).toEqual(settings);
  });
});

describe('sync state and selection', () => {
  it('selects every pending match after a new scan', () => {
    const model = scanned({ selection: new Set(['txn-1']) });
    const sync = scannedSync({ lastScanAt: '2026-10-27T11:30:00.000Z' });
    expect([...step(model, { type: 'syncStateChanged', sync })[0].selection]).toEqual(['txn-1', 'txn-2']);
  });

  it('keeps the selection for the same scan and drops applied rows', () => {
    const model = scanned({ selection: new Set(['txn-1', 'txn-2']) });
    const sync = scannedSync({ appliedTxnIds: ['txn-1'] });
    expect([...step(model, { type: 'syncStateChanged', sync })[0].selection]).toEqual(['txn-2']);
  });

  it('keeps an unchecked row unchecked for the same scan', () => {
    const model = scanned({ selection: new Set(['txn-2']) });
    expect([...step(model, { type: 'syncStateChanged', sync: scannedSync() })[0].selection]).toEqual([
      'txn-2',
    ]);
  });

  it.each(['applying', 'done', 'error'] as const)('clears a pending apply when status is %s', (status) => {
    const model = scanned({ applyPending: true });
    expect(step(model, { type: 'syncStateChanged', sync: scannedSync({ status }) })[0].applyPending).toBe(false);
  });

  it('flips one row', () => {
    const [next] = step(scanned(), { type: 'rowToggled', txnId: 'txn-1' });
    expect([...next.selection]).toEqual(['txn-2']);
    expect([...step(next, { type: 'rowToggled', txnId: 'txn-1' })[0].selection].sort()).toEqual([
      'txn-1',
      'txn-2',
    ]);
  });

  it('does not select an applied row', () => {
    const sync = scannedSync({ appliedTxnIds: ['txn-1'] });
    const model = scanned({ sync, selection: new Set(['txn-2']) });
    expect([...step(model, { type: 'rowToggled', txnId: 'txn-1' })[0].selection]).toEqual(['txn-2']);
  });

  it('check all clears a full selection', () => {
    expect(step(scanned(), { type: 'allToggled' })[0].selection.size).toBe(0);
  });

  it('check all fills a partial selection', () => {
    const [next] = step(scanned({ selection: new Set(['txn-2']) }), { type: 'allToggled' });
    expect([...next.selection].sort()).toEqual(['txn-1', 'txn-2']);
  });
});

describe('commands', () => {
  it('sends scan when ready', () => {
    expect(step(readyModel(), { type: 'scanPressed' })[1]).toEqual([
      { type: 'sendBackground', message: { type: 'scan' } },
    ]);
  });

  it.each([
    ['no YNAB', { ynabConnected: false }],
    ['no budget', { settings: { ...readyModel().settings, budgetId: '' } }],
    ['no Amazon', { amazonGranted: false }],
    ['busy', { sync: syncWith({ status: 'applying' }) }],
  ] as const)('does not scan with %s', (_label, overrides) => {
    expect(step(readyModel(overrides), { type: 'scanPressed' })[1]).toEqual([]);
  });

  it('sends the selected IDs in match order and marks the apply pending', () => {
    const [next, effects] = step(scanned({ selection: new Set(['txn-2', 'txn-1']) }), {
      type: 'applyPressed',
    });
    expect(effects).toEqual([
      { type: 'sendBackground', message: { type: 'apply', txnIds: ['txn-1', 'txn-2'] } },
    ]);
    expect(next.applyPending).toBe(true);
  });

  it('ignores a second Apply before the background answers', () => {
    const [next] = step(scanned(), { type: 'applyPressed' });
    expect(step(next, { type: 'applyPressed' })[1]).toEqual([]);
  });

  it.each([
    ['an empty selection', { selection: new Set<string>() }],
    ['a busy run', { sync: scannedSync({ status: 'scanning' }) }],
    ['a scan from another budget', { sync: scannedSync({ scanBudgetId: 'b2' }) }],
    ['a scan with no stored budget', { sync: scannedSync({ scanBudgetId: null }) }],
  ] as const)('does not apply with %s', (_label, overrides) => {
    expect(step(scanned(overrides), { type: 'applyPressed' })[1]).toEqual([]);
  });

  it('sends reset', () => {
    expect(step(scanned(), { type: 'resetPressed' })[1]).toEqual([
      { type: 'sendBackground', message: { type: 'reset' } },
    ]);
  });

  it('asks the background to connect YNAB', () => {
    expect(step(readyModel({ ynabConnected: false }), { type: 'connectYnabPressed' })[1]).toEqual([
      { type: 'sendBackground', message: { type: 'connectYnab' } },
    ]);
  });

  it('does not start a second YNAB sign-in', () => {
    const model = readyModel({ ynabConnected: false, ynabAuth: { kind: 'connecting', startedAt: NOW } });
    expect(step(model, { type: 'connectYnabPressed' })[1]).toEqual([]);
  });

  it('takes the sign-in status from storage', () => {
    const auth = { kind: 'failed', message: 'x' } as const;
    expect(step(readyModel(), { type: 'ynabAuthChanged', auth })[0].ynabAuth).toEqual(auth);
  });

  it('disconnects YNAB', () => {
    const [next, effects] = step(readyModel(), { type: 'disconnectYnabPressed' });
    expect(next.ynabConnected).toBe(false);
    expect(next.budgets).toEqual({ kind: 'idle' });
    expect(effects).toEqual([{ type: 'disconnectYnab' }]);
  });

  it('requests Amazon access, then opens the login page when granted', () => {
    const model = readyModel({ amazonGranted: false });
    expect(step(model, { type: 'connectAmazonPressed' })[1]).toEqual([{ type: 'requestAmazonPermission' }]);
    const [granted, effects] = step(model, { type: 'amazonPermissionResolved', granted: true });
    expect(granted.amazonGranted).toBe(true);
    expect(effects).toEqual([{ type: 'openAmazonLogin' }]);
  });

  it('does nothing more when Amazon access is refused', () => {
    expect(
      step(readyModel({ amazonGranted: false }), { type: 'amazonPermissionResolved', granted: false })[1],
    ).toEqual([]);
  });

  it('downloads the debug data', () => {
    const scanDebug = { charges: [], credits: [], candidates: [] };
    const [, effects] = step(scanned({ sync: scannedSync({ scanDebug }) }), { type: 'exportPressed' });
    const [effect] = effects;
    if (effect?.type !== 'downloadFile') throw new Error('expected downloadFile');
    expect(effect.name).toBe('ynab-amazon-debug.json');
    expect(JSON.parse(effect.json)).toEqual({ captures: [], scanDebug });
  });

  it('takes the time from a tick', () => {
    expect(step(readyModel(), { type: 'tick', now: '2026-10-27T13:00:00.000Z' })[0].now).toBe(
      '2026-10-27T13:00:00.000Z',
    );
  });

  it('clears a pending apply and logs when sending fails', () => {
    const [next, effects] = step(scanned({ applyPending: true }), {
      type: 'effectFailed',
      effect: 'sendBackground',
      message: 'no receiver',
    });
    expect(next.applyPending).toBe(false);
    expect(effects).toEqual([{ type: 'logError', context: 'sendBackground', detail: 'no receiver' }]);
  });
});
