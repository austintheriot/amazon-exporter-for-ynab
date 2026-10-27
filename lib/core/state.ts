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

export type Message =
  | { type: 'scan' }
  | { type: 'apply'; txnIds: string[] };
