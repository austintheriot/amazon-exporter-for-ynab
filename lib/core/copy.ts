import type { ScanCounts } from './amazon';
import { AmazonSessionError, YnabAuthError } from './errors';
import type { UnmatchedReason } from './unmatched';

const pluralRules = new Intl.PluralRules('en-US');

export function countOf(count: number, one: string, other: string): string {
  return `${String(count)} ${pluralRules.select(count) === 'one' ? one : other}`;
}

export const RECONNECT_MESSAGE = 'YNAB sign-in expired. Nothing was changed. Press Connect YNAB.';
export const YNAB_SIGN_IN_FAILED =
  'YNAB sign-in was cancelled or failed. Nothing was changed. Press Connect YNAB to try again.';
export const YNAB_SIGN_IN_OPEN = 'Sign-in window is open.';
export const ALL_APPLIED = 'All matches are already written.';
export const NOTHING_SELECTED = 'Check at least one match.';
export const RESET_LABEL_BUSY = 'Stop';
export const RESET_LABEL_IDLE = 'Clear results';

const AMAZON_SIGNED_OUT =
  'Not signed in to Amazon. Nothing was changed. Sign in at amazon.com, then press Scan.';
const UNKNOWN_FAILURE = 'Something went wrong. Press Scan to try again. Details are in the debug file.';

export function errorMessage(err: unknown): string {
  if (err instanceof AmazonSessionError) return AMAZON_SIGNED_OUT;
  if (err instanceof YnabAuthError) return RECONNECT_MESSAGE;
  return UNKNOWN_FAILURE;
}

export function missingSetupMessage(hasToken: boolean): string {
  return hasToken ? 'Pick a budget first.' : 'Connect YNAB first.';
}

export function budgetMismatchMessage(scanBudgetName: string | null, currentBudgetName: string): string {
  const source = scanBudgetName ? `budget ${scanBudgetName}` : 'a different budget';
  return `These matches are from ${source}. Scan again to match against ${currentBudgetName}.`;
}

export function applyButtonLabel(selected: number): string {
  return `Apply ${countOf(selected, 'memo', 'memos')} to YNAB`;
}

export function applyStartMessage(count: number): string {
  return `Writing ${countOf(count, 'memo', 'memos')} to YNAB…`;
}

export function applySummary(total: number, failures: number): string {
  if (!failures) return `Wrote ${countOf(total, 'memo', 'memos')} to YNAB.`;
  const retryTarget = failures === 1 ? 'it' : 'them';
  const verb = failures === 1 ? 'stays' : 'stay';
  return `Wrote ${String(total - failures)} of ${countOf(total, 'memo', 'memos')} to YNAB. ${String(failures)} failed and ${verb} checked. Press Apply to retry ${retryTarget}.`;
}

export function scanSummary(charges: number, refunds: number, matches: number): string {
  return `Found ${countOf(charges, 'charge', 'charges')} and ${countOf(refunds, 'refund', 'refunds')}. ${countOf(matches, 'match', 'matches')} ready to write.`;
}

export function countsLine(counts: ScanCounts): string {
  const parts = [countOf(counts.charges, 'charge', 'charges')];
  if (counts.credits) parts.push(countOf(counts.credits, 'refund', 'refunds'));
  if (counts.digitalSkipped) {
    parts.push(`${countOf(counts.digitalSkipped, 'digital order', 'digital orders')} skipped`);
  }
  if (counts.invoicesUnparsed) {
    parts.push(`${countOf(counts.invoicesUnparsed, 'order', 'orders')} could not be read`);
  }
  return parts.join(' · ');
}

export function dollars(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function unmatchedReasonText(reason: UnmatchedReason): string {
  switch (reason.kind) {
    case 'digital':
      return 'Digital order, skipped.';
    case 'order-unreadable':
      return 'Matched, but the order page could not be read. Download the debug file.';
    case 'already-has-memo':
      return 'The matching YNAB transaction already has a memo.';
    case 'taken':
      return 'Another charge or refund with the same amount took the only matching YNAB transaction.';
    case 'outside-window':
      return `A YNAB transaction has this amount, but its date is ${countOf(reason.daysAway, 'day', 'days')} away (limit: ${String(reason.maxDays)}).`;
    case 'no-amount-match':
      return reason.closest
        ? `No Amazon YNAB transaction for this amount. Closest: ${dollars(reason.closest.amount)} on ${reason.closest.date}.`
        : 'No Amazon YNAB transaction for this amount.';
  }
}

export const CONNECT_AMAZON_FIRST = 'Connect Amazon first.';
export const ORDER_LIMIT_MAX_HINT = 'Max 200';
export const ORDER_LIMIT_INVALID_HINT = 'Enter a number from 1 to 200';
export const BUDGETS_FAILED = 'Could not load budgets. Press Disconnect YNAB, then Connect YNAB.';
export const BOOT_FAILED = 'The popup could not start. Close it and open it again.';
