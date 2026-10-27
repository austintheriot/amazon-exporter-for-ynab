import { describe, expect, it } from 'vitest';
import {
  ALL_APPLIED,
  applyButtonLabel,
  applyStartMessage,
  applySummary,
  budgetMismatchMessage,
  countOf,
  countsLine,
  errorMessage,
  missingSetupMessage,
  NOTHING_SELECTED,
  RECONNECT_MESSAGE,
  RESET_LABEL_BUSY,
  RESET_LABEL_IDLE,
  scanSummary,
  unmatchedReasonText,
  YNAB_SIGN_IN_FAILED,
  YNAB_SIGN_IN_OPEN,
} from './copy';
import { AmazonSessionError, YnabAuthError } from './errors';
import { YnabResponseError } from './ynab';

describe('countOf', () => {
  it('uses the singular for one', () => {
    expect(countOf(1, 'memo', 'memos')).toBe('1 memo');
  });

  it('uses the plural for zero', () => {
    expect(countOf(0, 'memo', 'memos')).toBe('0 memos');
  });
});

describe('apply copy', () => {
  it('labels the Apply button with the plural count', () => {
    expect(applyButtonLabel(3)).toBe('Apply 3 memos to YNAB');
  });

  it('labels the Apply button with the singular count', () => {
    expect(applyButtonLabel(1)).toBe('Apply 1 memo to YNAB');
  });

  it('names the count when a write starts', () => {
    expect(applyStartMessage(2)).toBe('Writing 2 memos to YNAB…');
  });

  it('summarizes a write with no failures', () => {
    expect(applySummary(3, 0)).toBe('Wrote 3 memos to YNAB.');
  });

  it('summarizes a write with a failure and says how to retry', () => {
    expect(applySummary(3, 1)).toBe(
      'Wrote 2 of 3 memos to YNAB. 1 failed and stays checked. Press Apply to retry it.',
    );
  });

  it('pins the disabled-Apply reasons', () => {
    expect(ALL_APPLIED).toBe('All matches are already written.');
    expect(NOTHING_SELECTED).toBe('Check at least one match.');
  });

  it('pins the Reset labels', () => {
    expect(RESET_LABEL_BUSY).toBe('Stop');
    expect(RESET_LABEL_IDLE).toBe('Clear results');
  });
});

describe('scan copy', () => {
  it('summarizes a scan', () => {
    expect(scanSummary(12, 1, 3)).toBe('Found 12 charges and 1 refund. 3 matches ready to write.');
  });

  it('lists every nonzero count', () => {
    expect(
      countsLine({ charges: 12, credits: 1, digitalSkipped: 2, invoicesUnparsed: 1 }),
    ).toBe('12 charges · 1 refund · 2 digital orders skipped · 1 order could not be read');
  });

  it('omits zero counts other than charges', () => {
    expect(countsLine({ charges: 4, credits: 0, digitalSkipped: 0, invoicesUnparsed: 0 })).toBe(
      '4 charges',
    );
  });
});

describe('errorMessage', () => {
  it('tells the user to sign in to Amazon', () => {
    expect(errorMessage(new AmazonSessionError('x'))).toBe(
      'Not signed in to Amazon. Nothing was changed. Sign in at amazon.com, then press Scan.',
    );
  });

  it('tells the user to reconnect YNAB', () => {
    expect(errorMessage(new YnabAuthError('x'))).toBe(RECONNECT_MESSAGE);
    expect(RECONNECT_MESSAGE).toBe('YNAB sign-in expired. Nothing was changed. Press Connect YNAB.');
  });

  it('hides raw API error text', () => {
    expect(errorMessage(new Error('YNAB API error 500: <html>'))).toBe(
      'Something went wrong. Press Scan to try again. Details are in the debug file.',
    );
  });

  it('hides a YNAB response parse error', () => {
    expect(errorMessage(new YnabResponseError('response invalid at data.x'))).toBe(
      'Something went wrong. Press Scan to try again. Details are in the debug file.',
    );
  });

  it('hides a non-Error value', () => {
    expect(errorMessage('plain')).toBe(
      'Something went wrong. Press Scan to try again. Details are in the debug file.',
    );
  });
});

describe('setup copy', () => {
  it('asks to connect YNAB when no token exists', () => {
    expect(missingSetupMessage(false)).toBe('Connect YNAB first.');
  });

  it('asks for a budget when a token exists', () => {
    expect(missingSetupMessage(true)).toBe('Pick a budget first.');
  });

  it('names both budgets on a mismatch', () => {
    expect(budgetMismatchMessage('Household', 'Personal')).toBe(
      'These matches are from budget Household. Scan again to match against Personal.',
    );
  });

  it('falls back when the scan budget name is unknown', () => {
    expect(budgetMismatchMessage(null, 'Personal')).toBe(
      'These matches are from a different budget. Scan again to match against Personal.',
    );
  });

  it('pins the YNAB sign-in messages', () => {
    expect(YNAB_SIGN_IN_FAILED).toBe(
      'YNAB sign-in was cancelled or failed. Nothing was changed. Press Connect YNAB to try again.',
    );
    expect(YNAB_SIGN_IN_OPEN).toBe('Sign-in window is open.');
  });
});

describe('unmatchedReasonText', () => {
  it('explains each reason', () => {
    expect(unmatchedReasonText({ kind: 'digital' })).toBe('Digital order, skipped.');
    expect(unmatchedReasonText({ kind: 'order-unreadable' })).toBe(
      'Matched, but the order page could not be read. Download the debug file.',
    );
    expect(unmatchedReasonText({ kind: 'already-has-memo' })).toBe(
      'The matching YNAB transaction already has a memo.',
    );
    expect(unmatchedReasonText({ kind: 'taken' })).toBe(
      'Another charge or refund with the same amount took the only matching YNAB transaction.',
    );
  });

  it('says how far away an out-of-window match is', () => {
    expect(unmatchedReasonText({ kind: 'outside-window', daysAway: 10, maxDays: 7 })).toBe(
      'A YNAB transaction has this amount, but its date is 10 days away (limit: 7).',
    );
    expect(unmatchedReasonText({ kind: 'outside-window', daysAway: 1, maxDays: 0 })).toBe(
      'A YNAB transaction has this amount, but its date is 1 day away (limit: 0).',
    );
  });

  it('names the closest amount', () => {
    expect(
      unmatchedReasonText({ kind: 'no-amount-match', closest: { amount: 67.39, date: '2026-06-11' } }),
    ).toBe('No Amazon YNAB transaction for this amount. Closest: $67.39 on 2026-06-11.');
    expect(unmatchedReasonText({ kind: 'no-amount-match', closest: null })).toBe(
      'No Amazon YNAB transaction for this amount.',
    );
  });
});
