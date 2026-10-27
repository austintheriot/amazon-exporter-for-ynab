import type { MatchProposal } from '../proposal';
import { DEFAULT_SETTINGS, DEFAULT_STATE, type SyncState } from '../state';
import type { BootSnapshot, ReadyModel } from './model';

export const NOW = '2026-10-27T12:00:00.000Z';

export const proposal = (overrides: Partial<MatchProposal> = {}): MatchProposal => ({
  kind: 'charge',
  orderId: '111-0000000-0000001',
  orderDate: '2026-10-20',
  orderTotal: 42.17,
  items: ['USB-C cable'],
  txnId: 'txn-1',
  txnDate: '2026-10-21',
  txnPayee: 'Amazon.com',
  memo: 'USB-C cable [111-0000000-0000001]',
  ...overrides,
});

export const syncWith = (overrides: Partial<SyncState> = {}): SyncState => ({
  ...DEFAULT_STATE,
  proposals: [],
  appliedTxnIds: [],
  debugCaptures: [],
  ...overrides,
});

export const scannedSync = (overrides: Partial<SyncState> = {}): SyncState =>
  syncWith({
    status: 'done',
    message: 'Found 2 charges and 0 refunds. 2 matches ready to write.',
    proposals: [proposal({ txnId: 'txn-1' }), proposal({ txnId: 'txn-2', orderId: '111-0000000-0000002' })],
    lastScanAt: '2026-10-27T11:00:00.000Z',
    scanBudgetId: 'b1',
    scanBudgetName: 'Household',
    ...overrides,
  });

export const bootSnapshot = (overrides: Partial<BootSnapshot> = {}): BootSnapshot => ({
  settings: { ...DEFAULT_SETTINGS, budgetId: 'b1', budgetName: 'Household' },
  sync: syncWith(),
  ynabConnected: true,
  ynabAuth: { kind: 'idle' },
  amazonGranted: true,
  oauthConfigured: true,
  now: NOW,
  ...overrides,
});

export const readyModel = (overrides: Partial<ReadyModel> = {}): ReadyModel => ({
  ...bootSnapshot(),
  kind: 'ready',
  budgets: { kind: 'loaded', value: [{ id: 'b1', name: 'Household' }, { id: 'b2', name: 'Personal' }] },
  selection: new Set<string>(),
  selectionScanAt: null,
  applyPending: false,
  orderLimitHint: null,
  nextRequestId: 2,
  ...overrides,
});
