import type { AmazonCharge } from './amazon';

export type PageDecision =
  | { kind: 'fetch-next'; body: string }
  | {
      kind: 'stop';
      reason: 'empty-first-page' | 'past-cutoff' | 'limit' | 'last-page' | 'max-pages';
    };

export interface PageDecisionInput {
  page: number;
  pageCharges: number;
  pageCredits: number;
  oldestDateOnPage: string | null;
  chargesSoFar: number;
  sinceDate: string;
  limit: number;
  nextPageBody: string | null;
  maxPages: number;
}

export function decideAfterPage(input: PageDecisionInput): PageDecision {
  if (input.page === 1 && input.pageCharges === 0 && input.pageCredits === 0) {
    return { kind: 'stop', reason: 'empty-first-page' };
  }
  if (input.oldestDateOnPage !== null && input.oldestDateOnPage < input.sinceDate) {
    return { kind: 'stop', reason: 'past-cutoff' };
  }
  if (input.chargesSoFar >= input.limit) return { kind: 'stop', reason: 'limit' };
  if (!input.nextPageBody) return { kind: 'stop', reason: 'last-page' };
  if (input.page >= input.maxPages) return { kind: 'stop', reason: 'max-pages' };
  return { kind: 'fetch-next', body: input.nextPageBody };
}

export function finalizeCharges(
  charges: AmazonCharge[],
  credits: AmazonCharge[],
  window: { sinceDate: string; untilDate: string | undefined; limit: number },
): { charges: AmazonCharge[]; credits: AmazonCharge[] } {
  const inWindow = (item: AmazonCharge) =>
    item.date >= window.sinceDate && (!window.untilDate || item.date <= window.untilDate);
  return {
    charges: charges.filter(inWindow).slice(0, window.limit),
    credits: credits.filter(inWindow),
  };
}
