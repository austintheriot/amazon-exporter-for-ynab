import type { Message, Settings, SyncState } from '../state';
import type { YnabBudget } from '../ynab';
import type { YnabAuthStatus } from '../ynab-auth';

export type Remote<Value> =
  | { kind: 'idle' }
  | { kind: 'loading'; requestId: number }
  | { kind: 'loaded'; value: Value }
  | { kind: 'failed'; message: string };

export interface BootSnapshot {
  settings: Settings;
  sync: SyncState;
  ynabConnected: boolean;
  ynabAuth: YnabAuthStatus;
  amazonGranted: boolean;
  oauthConfigured: boolean;
  now: string;
}

export interface ReadyModel extends BootSnapshot {
  kind: 'ready';
  budgets: Remote<YnabBudget[]>;
  selection: ReadonlySet<string>;
  selectionScanAt: string | null;
  applyPending: boolean;
  orderLimitHint: string | null;
  nextRequestId: number;
}

export type Model = { kind: 'booting' } | { kind: 'boot-failed'; message: string } | ReadyModel;

export type Effect =
  | { type: 'loadBudgets'; requestId: number }
  | { type: 'persistSettings'; patch: Partial<Settings> }
  | { type: 'sendBackground'; message: Message }
  | { type: 'requestAmazonPermission' }
  | { type: 'openAmazonLogin' }
  | { type: 'disconnectYnab' }
  | { type: 'downloadFile'; name: string; json: string }
  | { type: 'logError'; context: string; detail: string };

export type Msg =
  | { type: 'booted'; snapshot: BootSnapshot }
  | { type: 'bootFailed'; message: string }
  | { type: 'syncStateChanged'; sync: SyncState }
  | { type: 'settingsChanged'; settings: Settings }
  | { type: 'tokenChanged'; connected: boolean }
  | { type: 'ynabAuthChanged'; auth: YnabAuthStatus }
  | { type: 'budgetsLoaded'; requestId: number; budgets: YnabBudget[] }
  | { type: 'budgetsFailed'; requestId: number; message: string }
  | { type: 'connectYnabPressed' }
  | { type: 'disconnectYnabPressed' }
  | { type: 'budgetPicked'; budgetId: string }
  | { type: 'yearPicked'; year: number | null }
  | { type: 'orderLimitEntered'; raw: string }
  | { type: 'connectAmazonPressed' }
  | { type: 'amazonPermissionResolved'; granted: boolean }
  | { type: 'scanPressed' }
  | { type: 'applyPressed' }
  | { type: 'resetPressed' }
  | { type: 'rowToggled'; txnId: string }
  | { type: 'allToggled' }
  | { type: 'exportPressed' }
  | { type: 'tick'; now: string }
  | { type: 'effectFailed'; effect: Effect['type']; message: string };
