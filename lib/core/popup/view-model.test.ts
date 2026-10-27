import { describe, expect, it } from 'vitest';
import type { ReadyModel } from './model';
import { proposal, readyModel, scannedSync, syncWith } from './test-model';
import { pendingIds } from './update';
import { viewModel, type ReadyView } from './view-model';

const view = (overrides: Partial<ReadyModel> = {}): ReadyView => {
  const result = viewModel(readyModel(overrides));
  if (result.kind !== 'ready') throw new Error('expected a ready view');
  return result;
};

const scannedView = (overrides: Partial<ReadyModel> = {}): ReadyView => {
  const sync = overrides.sync ?? scannedSync();
  return view({ selection: new Set(pendingIds(sync)), selectionScanAt: sync.lastScanAt, ...overrides, sync });
};

const connected = (result: ReadyView) => {
  if (result.ynab.kind !== 'connected') throw new Error('expected connected');
  return result.ynab;
};

describe('viewModel shells', () => {
  it('shows booting', () => {
    expect(viewModel({ kind: 'booting' })).toEqual({ kind: 'booting' });
  });

  it('shows a boot failure', () => {
    expect(viewModel({ kind: 'boot-failed', message: 'boom' })).toEqual({ kind: 'boot-failed', message: 'boom' });
  });
});

describe('YNAB section', () => {
  it('offers Recent orders and the last five years', () => {
    expect(connected(view()).yearOptions.map((option) => option.label)).toEqual([
      'Recent orders',
      '2026',
      '2025',
      '2024',
      '2023',
      '2022',
    ]);
  });

  it('keeps a saved year outside the five-year window, selected', () => {
    const options = connected(view({ settings: { ...readyModel().settings, year: 2019 } })).yearOptions;
    expect(options.map((option) => option.label)).toContain('2019');
    expect(options.find((option) => option.selected)?.label).toBe('2019');
  });

  it('keeps the saved budget when the loaded list lacks it', () => {
    const options = connected(
      view({ settings: { ...readyModel().settings, budgetId: 'gone', budgetName: 'Old' } }),
    ).budgetOptions;
    expect(options).toContainEqual({ id: 'gone', name: 'Old', selected: true });
  });

  it('explains a budget load failure', () => {
    expect(connected(view({ budgets: { kind: 'failed', message: 'x' } })).budgetError).toBe(
      'Could not load budgets. Press Disconnect YNAB, then Connect YNAB.',
    );
  });

  it('shows the sign-in window as open', () => {
    expect(
      view({ ynabConnected: false, ynabAuth: { kind: 'connecting', startedAt: readyModel().now } }).ynab,
    ).toEqual({ kind: 'disconnected', error: null, connecting: true });
  });

  it('shows a sign-in failure', () => {
    expect(view({ ynabConnected: false, ynabAuth: { kind: 'failed', message: 'nope' } }).ynab).toEqual({
      kind: 'disconnected',
      error: 'nope',
      connecting: false,
    });
  });

  it('reports a missing OAuth client', () => {
    expect(view({ ynabConnected: false, oauthConfigured: false }).ynab).toEqual({ kind: 'not-configured' });
  });
});

describe('controls', () => {
  it('lets a ready user scan', () => {
    expect(view().scan).toEqual({ label: 'Scan', disabled: false, reason: null });
  });

  it('says why Scan is disabled without Amazon access', () => {
    expect(view({ amazonGranted: false }).scan).toEqual({
      label: 'Scan',
      disabled: true,
      reason: 'Connect Amazon first.',
    });
  });

  it('shows a running scan', () => {
    expect(view({ sync: syncWith({ status: 'scanning' }) }).scan).toEqual({
      label: 'Scanning…',
      disabled: true,
      reason: null,
    });
  });

  it('counts the checked matches on Apply', () => {
    expect(scannedView().apply).toEqual({ label: 'Apply 2 memos to YNAB', disabled: false, reason: null });
  });

  it('says why Apply is disabled after a budget switch', () => {
    const apply = scannedView({ settings: { ...readyModel().settings, budgetId: 'b2', budgetName: 'Personal' } }).apply;
    expect(apply.disabled).toBe(true);
    expect(apply.reason).toBe('These matches are from budget Household. Scan again to match against Personal.');
  });

  it('says why Apply is disabled when every match is written', () => {
    const sync = scannedSync({ appliedTxnIds: ['txn-1', 'txn-2'] });
    expect(scannedView({ sync }).apply).toEqual({
      label: 'Apply 0 memos to YNAB',
      disabled: true,
      reason: 'All matches are already written.',
    });
  });

  it('says why Apply is disabled with nothing checked', () => {
    expect(scannedView({ selection: new Set() }).apply.reason).toBe('Check at least one match.');
  });

  it('labels Reset Stop while busy', () => {
    expect(view({ sync: syncWith({ status: 'applying' }) }).reset).toEqual({
      label: 'Stop',
      disabled: false,
      reason: null,
    });
  });

  it('disables Clear results when there is nothing to clear', () => {
    expect(view().reset).toEqual({ label: 'Clear results', disabled: true, reason: null });
  });
});

describe('match list', () => {
  it('describes each row', () => {
    const sync = scannedSync({
      proposals: [
        proposal({ txnId: 'txn-1', splits: [{ amount: -1, memo: 'a' }, { amount: -2, memo: 'b' }] }),
        proposal({ txnId: 'txn-2', kind: 'refund', orderTotal: 5 }),
      ],
      appliedTxnIds: ['txn-2'],
    });
    expect(scannedView({ sync }).rows).toEqual([
      {
        txnId: 'txn-1',
        amount: '$42.17',
        title: 'charged Oct 20, matched to YNAB transaction on Oct 21',
        memo: 'USB-C cable [111-0000000-0000001]',
        meta: 'split into 2 parts',
        checked: true,
        applied: false,
      },
      {
        txnId: 'txn-2',
        amount: '$5.00',
        title: 'refunded Oct 20, matched to YNAB transaction on Oct 21',
        memo: 'USB-C cable [111-0000000-0000001]',
        meta: 'written',
        checked: true,
        applied: true,
      },
    ]);
  });

  it('checks check-all when every pending row is checked', () => {
    expect(scannedView().checkAll).toEqual({ checked: true, indeterminate: false, disabled: false });
  });

  it('shows check-all indeterminate for a partial selection', () => {
    expect(scannedView({ selection: new Set(['txn-1']) }).checkAll).toEqual({
      checked: false,
      indeterminate: true,
      disabled: false,
    });
  });

  it('disables check-all when every row is written', () => {
    const sync = scannedSync({ appliedTxnIds: ['txn-1', 'txn-2'] });
    expect(scannedView({ sync }).checkAll).toEqual({ checked: false, indeterminate: false, disabled: true });
  });
});

describe('status and extras', () => {
  it('shows the background message and marks errors', () => {
    expect(view({ sync: syncWith({ status: 'error', message: 'Bad' }) }).status).toEqual({
      text: 'Bad',
      isError: true,
    });
  });

  it('shows the counts line', () => {
    const counts = { charges: 2, credits: 0, digitalSkipped: 0, invoicesUnparsed: 0 };
    expect(scannedView({ sync: scannedSync({ counts }) }).countsLine).toBe('2 charges');
  });

  it('hides the unmatched list without scan data', () => {
    expect(scannedView().unmatched).toBeNull();
  });

  it('explains unmatched charges', () => {
    const scanDebug = {
      charges: [{ orderId: '111-0000000-0000009', date: '2026-10-15', amount: 67.38, paymentMethod: 'Visa' }],
      credits: [],
      candidates: [],
    };
    expect(scannedView({ sync: scannedSync({ scanDebug }) }).unmatched).toEqual([
      { amount: '$67.38', title: 'charge on Oct 15', reason: 'No Amazon YNAB transaction for this amount.' },
    ]);
  });

  it.each(['scanning', 'error'] as const)('hides stale unmatched reasons while %s', (status) => {
    const scanDebug = {
      charges: [{ orderId: '111-0000000-0000009', date: '2026-10-15', amount: 67.38, paymentMethod: 'Visa' }],
      credits: [],
      candidates: [],
    };
    expect(scannedView({ sync: scannedSync({ status, scanDebug, proposals: [] }) }).unmatched).toBeNull();
  });

  it('offers the debug download only with debug data', () => {
    expect(view().canExport).toBe(false);
    expect(view({ sync: syncWith({ scanDebug: { charges: [], credits: [], candidates: [] } }) }).canExport).toBe(true);
  });
});
