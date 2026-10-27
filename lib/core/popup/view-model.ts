import {
  applyButtonLabel,
  BUDGETS_FAILED,
  countsLine,
  dollars,
  RESET_LABEL_BUSY,
  RESET_LABEL_IDLE,
  unmatchedReasonText,
} from '../copy';
import type { MatchProposal } from '../proposal';
import { explainUnmatched } from '../unmatched';
import { isConnecting } from '../ynab-auth';
import type { ReadyModel, Model } from './model';
import { applyReadiness, isBusy, pendingIds, scanReadiness, type Readiness } from './update';

const YEARS_SHOWN = 5;
const dayFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export interface Control {
  label: string;
  disabled: boolean;
  reason: string | null;
}

export interface YearOption {
  value: number | null;
  label: string;
  selected: boolean;
}

export type YnabView =
  | { kind: 'not-configured' }
  | { kind: 'disconnected'; error: string | null; connecting: boolean }
  | {
      kind: 'connected';
      budgetOptions: { id: string; name: string; selected: boolean }[];
      budgetError: string | null;
      yearOptions: YearOption[];
      orderLimit: number;
      orderLimitHint: string | null;
    };

export interface MatchRow {
  txnId: string;
  amount: string;
  title: string;
  memo: string;
  meta: string;
  checked: boolean;
  applied: boolean;
}

export interface UnmatchedRow {
  amount: string;
  title: string;
  reason: string;
}

export interface ReadyView {
  kind: 'ready';
  ynab: YnabView;
  amazonGranted: boolean;
  scan: Control;
  apply: Control;
  reset: Control;
  status: { text: string; isError: boolean };
  countsLine: string | null;
  checkAll: { checked: boolean; indeterminate: boolean; disabled: boolean };
  rows: MatchRow[];
  unmatched: UnmatchedRow[] | null;
  canExport: boolean;
}

export type PopupView = { kind: 'booting' } | { kind: 'boot-failed'; message: string } | ReadyView;

function formatDay(isoDate: string): string {
  return dayFormat.format(new Date(`${isoDate.slice(0, 10)}T00:00:00Z`));
}

function control(label: string, readiness: Readiness): Control {
  return {
    label,
    disabled: readiness.kind !== 'ready',
    reason: readiness.kind === 'blocked' ? readiness.reason : null,
  };
}

function yearOptions(model: ReadyModel): YearOption[] {
  const currentYear = Number(model.now.slice(0, 4));
  const saved = model.settings.year;
  const years = Array.from({ length: YEARS_SHOWN }, (_, offset) => currentYear - offset);
  const withSaved = saved === null || years.includes(saved) ? years : [...years, saved].sort((a, b) => b - a);
  return [
    { value: null, label: 'Recent orders', selected: saved === null },
    ...withSaved.map((year) => ({ value: year, label: String(year), selected: year === saved })),
  ];
}

function ynabView(model: ReadyModel): YnabView {
  if (!model.ynabConnected) {
    if (!model.oauthConfigured) return { kind: 'not-configured' };
    return {
      kind: 'disconnected',
      error: model.ynabAuth.kind === 'failed' ? model.ynabAuth.message : null,
      connecting: isConnecting(model.ynabAuth, model.now),
    };
  }
  const { budgetId, budgetName } = model.settings;
  const loaded = model.budgets.kind === 'loaded' ? model.budgets.value : [];
  const budgets =
    budgetId && !loaded.some((budget) => budget.id === budgetId)
      ? [...loaded, { id: budgetId, name: budgetName || budgetId }]
      : loaded;
  return {
    kind: 'connected',
    budgetOptions: budgets.map((budget) => ({ ...budget, selected: budget.id === budgetId })),
    budgetError: model.budgets.kind === 'failed' ? BUDGETS_FAILED : null,
    yearOptions: yearOptions(model),
    orderLimit: model.settings.orderLimit,
    orderLimitHint: model.orderLimitHint,
  };
}

function matchRow(proposal: MatchProposal, applied: boolean, checked: boolean): MatchRow {
  const verb = proposal.kind === 'refund' ? 'refunded' : 'charged';
  const meta = [
    ...(proposal.splits ? [`split into ${String(proposal.splits.length)} parts`] : []),
    ...(applied ? ['written'] : []),
  ];
  return {
    txnId: proposal.txnId,
    amount: dollars(proposal.orderTotal),
    title: `${verb} ${formatDay(proposal.orderDate)}, matched to YNAB transaction on ${formatDay(proposal.txnDate)}`,
    memo: proposal.memo,
    meta: meta.join(' · '),
    checked: applied || checked,
    applied,
  };
}

function unmatchedRows(model: ReadyModel): UnmatchedRow[] | null {
  const { scanDebug, proposals } = model.sync;
  if (!scanDebug) return null;
  return explainUnmatched({ scanDebug, proposals, maxDays: model.settings.maxDays }).map((entry) => ({
    amount: dollars(entry.amount),
    title: `${entry.kind} on ${formatDay(entry.date)}`,
    reason: unmatchedReasonText(entry.reason),
  }));
}

function readyView(model: ReadyModel): ReadyView {
  const { sync } = model;
  const busy = isBusy(sync);
  const applied = new Set(sync.appliedTxnIds);
  const pending = pendingIds(sync);
  const checkedCount = pending.filter((txnId) => model.selection.has(txnId)).length;
  const nothingToClear = !sync.message && sync.proposals.length === 0 && !sync.scanDebug;
  return {
    kind: 'ready',
    ynab: ynabView(model),
    amazonGranted: model.amazonGranted,
    scan: control(sync.status === 'scanning' ? 'Scanning…' : 'Scan', scanReadiness(model)),
    apply: control(
      busy || model.applyPending ? 'Working…' : applyButtonLabel(checkedCount),
      applyReadiness(model),
    ),
    reset: {
      label: busy ? RESET_LABEL_BUSY : RESET_LABEL_IDLE,
      disabled: !busy && nothingToClear,
      reason: null,
    },
    status: { text: sync.message, isError: sync.status === 'error' },
    countsLine: sync.counts ? countsLine(sync.counts) : null,
    checkAll: {
      checked: pending.length > 0 && checkedCount === pending.length,
      indeterminate: checkedCount > 0 && checkedCount < pending.length,
      disabled: pending.length === 0,
    },
    rows: sync.proposals.map((proposal) =>
      matchRow(proposal, applied.has(proposal.txnId), model.selection.has(proposal.txnId)),
    ),
    unmatched: unmatchedRows(model),
    canExport: sync.debugCaptures.length > 0 || sync.scanDebug !== null,
  };
}

export function viewModel(model: Model): PopupView {
  switch (model.kind) {
    case 'booting':
      return { kind: 'booting' };
    case 'boot-failed':
      return { kind: 'boot-failed', message: model.message };
    case 'ready':
      return readyView(model);
  }
}
