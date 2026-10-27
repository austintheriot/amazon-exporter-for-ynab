import { z } from 'zod/mini';
import { matchProposalSchema } from './proposal';

const settingsObjectSchema = z.object({
  budgetId: z.string(),
  budgetName: z.string(),
  /** null = recent orders (no year filter) */
  year: z.nullable(z.number()),
  maxDays: z.number(),
  orderLimit: z.number(),
});

export type Settings = z.infer<typeof settingsObjectSchema>;

export const DEFAULT_SETTINGS: Settings = {
  budgetId: '',
  budgetName: '',
  year: null,
  maxDays: 7,
  orderLimit: 50,
};

const settingsFields = settingsObjectSchema.shape;

const settingsSchema = z.catch(
  z.object({
    budgetId: z.catch(settingsFields.budgetId, DEFAULT_SETTINGS.budgetId),
    budgetName: z.catch(settingsFields.budgetName, DEFAULT_SETTINGS.budgetName),
    year: z.catch(settingsFields.year, DEFAULT_SETTINGS.year),
    maxDays: z.catch(settingsFields.maxDays, DEFAULT_SETTINGS.maxDays),
    orderLimit: z.catch(settingsFields.orderLimit, DEFAULT_SETTINGS.orderLimit),
  } satisfies Record<keyof Settings, unknown>),
  () => ({ ...DEFAULT_SETTINGS }),
);

export function parseSettings(raw: unknown): Settings {
  return settingsSchema.parse(raw);
}

const syncStatusSchema = z.enum(['idle', 'scanning', 'applying', 'done', 'error']);

export type SyncStatus = z.infer<typeof syncStatusSchema>;

const chargeSchema = z.object({
  orderId: z.string(),
  date: z.string(),
  amount: z.number(),
  paymentMethod: z.string(),
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

/** Snapshot of both sides of the matching input, for debug export. */
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

export type ScanDebug = z.infer<typeof scanDebugSchema>;

const syncStateObjectSchema = z.object({
  status: syncStatusSchema,
  message: z.string(),
  proposals: z.array(matchProposalSchema),
  counts: z.nullable(countsSchema),
  appliedTxnIds: z.array(z.string()),
  lastScanAt: z.nullable(z.string()),
  debugCaptures: z.array(captureSchema),
  scanDebug: z.nullable(scanDebugSchema),
  scanBudgetId: z.nullable(z.string()),
  scanBudgetName: z.nullable(z.string()),
});

export type SyncState = z.infer<typeof syncStateObjectSchema>;

export const DEFAULT_STATE: SyncState = {
  status: 'idle',
  message: '',
  proposals: [],
  counts: null,
  appliedTxnIds: [],
  lastScanAt: null,
  debugCaptures: [],
  scanDebug: null,
  scanBudgetId: null,
  scanBudgetName: null,
};

const syncStateFields = syncStateObjectSchema.shape;

const syncStateSchema = z.catch(
  z.object({
    status: z.catch(syncStateFields.status, DEFAULT_STATE.status),
    message: z.catch(syncStateFields.message, DEFAULT_STATE.message),
    proposals: z.catch(syncStateFields.proposals, () => []),
    counts: z.catch(syncStateFields.counts, DEFAULT_STATE.counts),
    appliedTxnIds: z.catch(syncStateFields.appliedTxnIds, () => []),
    lastScanAt: z.catch(syncStateFields.lastScanAt, DEFAULT_STATE.lastScanAt),
    debugCaptures: z.catch(syncStateFields.debugCaptures, () => []),
    scanDebug: z.catch(syncStateFields.scanDebug, DEFAULT_STATE.scanDebug),
    scanBudgetId: z.catch(syncStateFields.scanBudgetId, DEFAULT_STATE.scanBudgetId),
    scanBudgetName: z.catch(syncStateFields.scanBudgetName, DEFAULT_STATE.scanBudgetName),
  } satisfies Record<keyof SyncState, unknown>),
  () => ({ ...DEFAULT_STATE, proposals: [], appliedTxnIds: [], debugCaptures: [] }),
);

export function parseSyncState(raw: unknown): SyncState {
  return syncStateSchema.parse(raw);
}

const messageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('scan') }),
  z.object({ type: z.literal('reset') }),
  z.object({ type: z.literal('connectYnab') }),
  z.object({ type: z.literal('apply'), txnIds: z.array(z.string()) }),
]);

export type Message = z.infer<typeof messageSchema>;

export function parseMessage(raw: unknown): Message | null {
  const result = messageSchema.safeParse(raw);
  return result.success ? result.data : null;
}
