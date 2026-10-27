import { z } from 'zod/mini';
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

const messageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('scan') }),
  z.object({ type: z.literal('apply'), txnIds: z.array(z.string()) }),
]);

export type Message = z.infer<typeof messageSchema>;

export function parseMessage(raw: unknown): Message | null {
  const result = messageSchema.safeParse(raw);
  return result.success ? result.data : null;
}

const settingsSchema = z.catch(
  z.object({
    budgetId: z.catch(z.string(), DEFAULT_SETTINGS.budgetId),
    budgetName: z.catch(z.string(), DEFAULT_SETTINGS.budgetName),
    year: z.catch(z.nullable(z.number()), DEFAULT_SETTINGS.year),
    maxDays: z.catch(z.number(), DEFAULT_SETTINGS.maxDays),
    orderLimit: z.catch(z.number(), DEFAULT_SETTINGS.orderLimit),
  }),
  () => ({ ...DEFAULT_SETTINGS }),
);

export function parseSettings(raw: unknown): Settings {
  return settingsSchema.parse(raw);
}

const chargeSchema = z.object({
  orderId: z.string(),
  date: z.string(),
  amount: z.number(),
  paymentMethod: z.string(),
});

const proposalSchema = z.object({
  kind: z.enum(['charge', 'refund']),
  orderId: z.string(),
  orderDate: z.string(),
  orderTotal: z.number(),
  items: z.array(z.string()),
  txnId: z.string(),
  txnDate: z.string(),
  txnPayee: z.string(),
  memo: z.string(),
  splits: z.optional(z.array(z.object({ amount: z.number(), memo: z.string() }))),
});

const countsSchema = z.object({
  charges: z.number(),
  credits: z.number(),
  digitalSkipped: z.number(),
  invoicesUnparsed: z.number(),
});

const captureSchema = z.object({
  orderId: z.string(),
  requestedUrl: z.string(),
  finalUrl: z.string(),
  status: z.number(),
  html: z.string(),
});

const scanDebugSchema = z.object({
  charges: z.array(chargeSchema),
  credits: z.array(chargeSchema),
  candidates: z.array(
    z.object({
      id: z.string(),
      date: z.string(),
      amount: z.number(),
      payee: z.string(),
      hasMemo: z.boolean(),
    }),
  ),
});

const syncStateSchema = z.catch(
  z.object({
    status: z.catch(
      z.enum(['idle', 'scanning', 'applying', 'done', 'error']),
      DEFAULT_STATE.status,
    ),
    message: z.catch(z.string(), DEFAULT_STATE.message),
    proposals: z.catch(z.array(proposalSchema), () => []),
    counts: z.catch(z.nullable(countsSchema), DEFAULT_STATE.counts),
    appliedTxnIds: z.catch(z.array(z.string()), () => []),
    lastScanAt: z.catch(z.nullable(z.string()), DEFAULT_STATE.lastScanAt),
    debugCaptures: z.catch(z.array(captureSchema), () => []),
    scanDebug: z.catch(z.nullable(scanDebugSchema), DEFAULT_STATE.scanDebug),
  }),
  () => ({ ...DEFAULT_STATE, proposals: [], appliedTxnIds: [], debugCaptures: [] }),
);

export function parseSyncState(raw: unknown): SyncState {
  return syncStateSchema.parse(raw);
}
