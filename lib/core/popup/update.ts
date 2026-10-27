import { applyBlocker } from '../apply';
import {
  ALL_APPLIED,
  budgetMismatchMessage,
  CONNECT_AMAZON_FIRST,
  missingSetupMessage,
  NOTHING_SELECTED,
  ORDER_LIMIT_INVALID_HINT,
  ORDER_LIMIT_MAX_HINT,
} from '../copy';
import type { SyncState } from '../state';
import { isConnecting } from '../ynab-auth';
import type { Effect, Model, Msg, ReadyModel } from './model';

const MAX_ORDER_LIMIT = 200;
const DEBUG_FILE_NAME = 'ynab-amazon-debug.json';

export type Readiness = { kind: 'ready' } | { kind: 'busy' } | { kind: 'blocked'; reason: string | null };

type Step = [Model, Effect[]];

export function isBusy(sync: SyncState): boolean {
  return sync.status === 'scanning' || sync.status === 'applying';
}

export function pendingIds(sync: SyncState): string[] {
  const applied = new Set(sync.appliedTxnIds);
  return sync.proposals.map((proposal) => proposal.txnId).filter((txnId) => !applied.has(txnId));
}

export function scanReadiness(model: ReadyModel): Readiness {
  if (isBusy(model.sync)) return { kind: 'busy' };
  if (!model.ynabConnected) return { kind: 'blocked', reason: missingSetupMessage(false) };
  if (!model.settings.budgetId) return { kind: 'blocked', reason: missingSetupMessage(true) };
  if (!model.amazonGranted) return { kind: 'blocked', reason: CONNECT_AMAZON_FIRST };
  return { kind: 'ready' };
}

export function applyReadiness(model: ReadyModel): Readiness {
  const { sync, settings } = model;
  if (isBusy(sync) || model.applyPending) return { kind: 'busy' };
  if (sync.proposals.length === 0) return { kind: 'blocked', reason: null };
  if (applyBlocker({ selectedBudgetId: settings.budgetId, scanBudgetId: sync.scanBudgetId })) {
    return {
      kind: 'blocked',
      reason: budgetMismatchMessage(sync.scanBudgetName, settings.budgetName),
    };
  }
  if (pendingIds(sync).length === 0) return { kind: 'blocked', reason: ALL_APPLIED };
  if (model.selection.size === 0) return { kind: 'blocked', reason: NOTHING_SELECTED };
  return { kind: 'ready' };
}

function reconcileSelection(model: ReadyModel): ReadyModel {
  const pending = pendingIds(model.sync);
  if (model.sync.lastScanAt !== model.selectionScanAt) {
    return { ...model, selection: new Set(pending), selectionScanAt: model.sync.lastScanAt };
  }
  return { ...model, selection: new Set(pending.filter((txnId) => model.selection.has(txnId))) };
}

function requestBudgets(model: ReadyModel): Step {
  const requestId = model.nextRequestId;
  return [
    { ...model, budgets: { kind: 'loading', requestId }, nextRequestId: requestId + 1 },
    [{ type: 'loadBudgets', requestId }],
  ];
}

function orderLimitStep(model: ReadyModel, raw: string): Step {
  const parsed = /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 1) {
    return [{ ...model, orderLimitHint: ORDER_LIMIT_INVALID_HINT }, []];
  }
  const orderLimit = Math.min(parsed, MAX_ORDER_LIMIT);
  return [
    {
      ...model,
      settings: { ...model.settings, orderLimit },
      orderLimitHint: parsed > MAX_ORDER_LIMIT ? ORDER_LIMIT_MAX_HINT : null,
    },
    [{ type: 'persistSettings', patch: { orderLimit } }],
  ];
}

function toggleRow(model: ReadyModel, txnId: string): ReadyModel {
  if (!pendingIds(model.sync).includes(txnId)) return model;
  const selection = new Set(model.selection);
  if (selection.has(txnId)) selection.delete(txnId);
  else selection.add(txnId);
  return { ...model, selection };
}

function toggleAll(model: ReadyModel): ReadyModel {
  const pending = pendingIds(model.sync);
  const allSelected = pending.every((txnId) => model.selection.has(txnId));
  return { ...model, selection: new Set(allSelected ? [] : pending) };
}

function applyStep(model: ReadyModel): Step {
  if (applyReadiness(model).kind !== 'ready') return [model, []];
  const txnIds = pendingIds(model.sync).filter((txnId) => model.selection.has(txnId));
  return [
    { ...model, applyPending: true },
    [{ type: 'sendBackground', message: { type: 'apply', txnIds } }],
  ];
}

function updateReady(model: ReadyModel, msg: Msg): Step {
  switch (msg.type) {
    case 'booted':
    case 'bootFailed':
      return [model, []];
    case 'syncStateChanged': {
      const applyPending = model.applyPending && !['applying', 'done', 'error'].includes(msg.sync.status);
      return [reconcileSelection({ ...model, sync: msg.sync, applyPending }), []];
    }
    case 'settingsChanged':
      return [{ ...model, settings: msg.settings }, []];
    case 'tokenChanged':
      if (!msg.connected) return [{ ...model, ynabConnected: false, budgets: { kind: 'idle' } }, []];
      if (model.ynabConnected && model.budgets.kind !== 'idle') return [model, []];
      return requestBudgets({ ...model, ynabConnected: true });
    case 'ynabAuthChanged':
      return [{ ...model, ynabAuth: msg.auth }, []];
    case 'budgetsLoaded':
      if (model.budgets.kind !== 'loading' || model.budgets.requestId !== msg.requestId) return [model, []];
      return [{ ...model, budgets: { kind: 'loaded', value: msg.budgets } }, []];
    case 'budgetsFailed':
      if (model.budgets.kind !== 'loading' || model.budgets.requestId !== msg.requestId) return [model, []];
      return [
        { ...model, budgets: { kind: 'failed', message: msg.message } },
        [{ type: 'logError', context: 'Load budgets', detail: msg.message }],
      ];
    case 'connectYnabPressed':
      if (isConnecting(model.ynabAuth, model.now)) return [model, []];
      return [model, [{ type: 'sendBackground', message: { type: 'connectYnab' } }]];
    case 'disconnectYnabPressed':
      return [{ ...model, ynabConnected: false, budgets: { kind: 'idle' } }, [{ type: 'disconnectYnab' }]];
    case 'budgetPicked': {
      const budgetName =
        model.budgets.kind === 'loaded'
          ? (model.budgets.value.find((budget) => budget.id === msg.budgetId)?.name ?? '')
          : '';
      const patch = { budgetId: msg.budgetId, budgetName };
      return [{ ...model, settings: { ...model.settings, ...patch } }, [{ type: 'persistSettings', patch }]];
    }
    case 'yearPicked':
      return [
        { ...model, settings: { ...model.settings, year: msg.year } },
        [{ type: 'persistSettings', patch: { year: msg.year } }],
      ];
    case 'orderLimitEntered':
      return orderLimitStep(model, msg.raw);
    case 'connectAmazonPressed':
      return [model, [{ type: 'requestAmazonPermission' }]];
    case 'amazonPermissionResolved':
      return msg.granted
        ? [{ ...model, amazonGranted: true }, [{ type: 'openAmazonLogin' }]]
        : [model, []];
    case 'scanPressed':
      return scanReadiness(model).kind === 'ready'
        ? [model, [{ type: 'sendBackground', message: { type: 'scan' } }]]
        : [model, []];
    case 'applyPressed':
      return applyStep(model);
    case 'resetPressed':
      return [model, [{ type: 'sendBackground', message: { type: 'reset' } }]];
    case 'rowToggled':
      return [toggleRow(model, msg.txnId), []];
    case 'allToggled':
      return [toggleAll(model), []];
    case 'exportPressed': {
      const json = JSON.stringify(
        { captures: model.sync.debugCaptures, scanDebug: model.sync.scanDebug },
        null,
        2,
      );
      return [model, [{ type: 'downloadFile', name: DEBUG_FILE_NAME, json }]];
    }
    case 'tick':
      return [{ ...model, now: msg.now }, []];
    case 'effectFailed':
      return [
        { ...model, applyPending: msg.effect === 'sendBackground' ? false : model.applyPending },
        [{ type: 'logError', context: msg.effect, detail: msg.message }],
      ];
  }
}

export function update(model: Model, msg: Msg): Step {
  if (model.kind === 'ready') return updateReady(model, msg);
  if (model.kind === 'boot-failed') return [model, []];
  if (msg.type === 'bootFailed') return [{ kind: 'boot-failed', message: msg.message }, []];
  if (msg.type !== 'booted') return [model, []];
  const booted = reconcileSelection({
    ...msg.snapshot,
    kind: 'ready',
    budgets: { kind: 'idle' },
    selection: new Set<string>(),
    selectionScanAt: null,
    applyPending: false,
    orderLimitHint: null,
    nextRequestId: 1,
  });
  return booted.ynabConnected ? requestBudgets(booted) : [booted, []];
}
