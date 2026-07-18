import type { MatchProposal } from './matcher';
import type { AmazonCharge, DebugCapture, ScanCounts } from './amazon';

/** Snapshot of both sides of the matching input, for debug export. */
export interface ScanDebug {
  charges: AmazonCharge[];
  credits: AmazonCharge[];
  candidates: {
    id: string;
    date: string;
    amount: number;
    payee: string;
    hasMemo: boolean;
  }[];
}

export interface Settings {
  pat: string;
  budgetId: string;
  budgetName: string;
  year: number | null; // null = recent orders (no year filter)
  maxDays: number;
  orderLimit: number;
}

export type SyncStatus = 'idle' | 'scanning' | 'applying' | 'done' | 'error';

export interface SyncState {
  status: SyncStatus;
  message: string;
  proposals: MatchProposal[];
  counts: ScanCounts | null;
  appliedTxnIds: string[];
  lastScanAt: string | null;
  debugCaptures: DebugCapture[];
  scanDebug: ScanDebug | null;
}

export const DEFAULT_SETTINGS: Settings = {
  pat: '',
  budgetId: '',
  budgetName: '',
  year: null,
  maxDays: 7,
  orderLimit: 50,
};

export const DEFAULT_STATE: SyncState = {
  status: 'idle',
  message: '',
  proposals: [],
  counts: null,
  appliedTxnIds: [],
  lastScanAt: null,
  debugCaptures: [],
  scanDebug: null,
};

const SETTINGS_KEY = 'settings';
const STATE_KEY = 'syncState';

export async function getSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] ?? {}) };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function getState(): Promise<SyncState> {
  const stored = await browser.storage.local.get(STATE_KEY);
  return { ...DEFAULT_STATE, ...(stored[STATE_KEY] ?? {}) };
}

export async function setState(patch: Partial<SyncState>): Promise<SyncState> {
  const next = { ...(await getState()), ...patch };
  await browser.storage.local.set({ [STATE_KEY]: next });
  return next;
}

export type Message =
  | { type: 'scan' }
  | { type: 'apply'; txnIds: string[] };
