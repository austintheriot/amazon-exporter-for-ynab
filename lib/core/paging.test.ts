import { describe, expect, it } from 'vitest';
import type { AmazonCharge } from './amazon';
import { decideAfterPage, finalizeCharges } from './paging';

const baseInput = {
  page: 1,
  pageCharges: 3,
  pageCredits: 0,
  oldestDateOnPage: '2025-06-10',
  chargesSoFar: 3,
  sinceDate: '2025-01-01',
  limit: 100,
  nextPageBody: 'next=1',
  maxPages: 25,
};

const charge = (date: string, orderId = `order-${date}`): AmazonCharge => ({
  orderId,
  date,
  amount: 10,
  paymentMethod: 'Visa',
});

describe('decideAfterPage', () => {
  it('fetches the next page when no stop condition applies', () => {
    expect(decideAfterPage(baseInput)).toEqual({ kind: 'fetch-next', body: 'next=1' });
  });

  it('stops on an empty first page', () => {
    expect(
      decideAfterPage({
        ...baseInput,
        pageCharges: 0,
        pageCredits: 0,
        oldestDateOnPage: null,
        chargesSoFar: 0,
      }),
    ).toEqual({ kind: 'stop', reason: 'empty-first-page' });
  });

  it('continues past an empty page 2', () => {
    expect(
      decideAfterPage({
        ...baseInput,
        page: 2,
        pageCharges: 0,
        pageCredits: 0,
        oldestDateOnPage: null,
        chargesSoFar: 3,
      }),
    ).toEqual({ kind: 'fetch-next', body: 'next=1' });
  });

  it('stops when the page holds a row older than sinceDate', () => {
    expect(decideAfterPage({ ...baseInput, oldestDateOnPage: '2024-12-31' })).toEqual({
      kind: 'stop',
      reason: 'past-cutoff',
    });
  });

  it('does not stop when the oldest row is on sinceDate', () => {
    expect(decideAfterPage({ ...baseInput, oldestDateOnPage: '2025-01-01' }).kind).toBe(
      'fetch-next',
    );
  });

  it('stops when charges so far reach the limit', () => {
    expect(decideAfterPage({ ...baseInput, chargesSoFar: 100 })).toEqual({
      kind: 'stop',
      reason: 'limit',
    });
  });

  it('prefers past-cutoff over limit', () => {
    expect(
      decideAfterPage({
        ...baseInput,
        oldestDateOnPage: '2024-12-31',
        chargesSoFar: 100,
      }),
    ).toEqual({ kind: 'stop', reason: 'past-cutoff' });
  });

  it('stops on the last page when there is no next page body', () => {
    expect(decideAfterPage({ ...baseInput, nextPageBody: null })).toEqual({
      kind: 'stop',
      reason: 'last-page',
    });
  });

  it('treats an empty next page body as the last page', () => {
    expect(decideAfterPage({ ...baseInput, nextPageBody: '' })).toEqual({
      kind: 'stop',
      reason: 'last-page',
    });
  });

  it('stops at max pages when a next page exists', () => {
    expect(decideAfterPage({ ...baseInput, page: 25 })).toEqual({
      kind: 'stop',
      reason: 'max-pages',
    });
  });

  it('prefers last-page over max-pages', () => {
    expect(decideAfterPage({ ...baseInput, page: 25, nextPageBody: null })).toEqual({
      kind: 'stop',
      reason: 'last-page',
    });
  });
});

describe('finalizeCharges', () => {
  const window = { sinceDate: '2025-01-01', untilDate: undefined, limit: 100 };

  it('keeps a charge on sinceDate and drops the day before', () => {
    const result = finalizeCharges(
      [charge('2025-01-01'), charge('2024-12-31')],
      [],
      window,
    );
    expect(result.charges.map((item) => item.date)).toEqual(['2025-01-01']);
  });

  it('keeps a charge on untilDate and drops the day after', () => {
    const result = finalizeCharges(
      [charge('2025-12-31'), charge('2026-01-01')],
      [],
      { ...window, untilDate: '2025-12-31' },
    );
    expect(result.charges.map((item) => item.date)).toEqual(['2025-12-31']);
  });

  it('filters credits by the same window', () => {
    const result = finalizeCharges([], [charge('2025-02-01'), charge('2024-01-01')], window);
    expect(result.credits.map((item) => item.date)).toEqual(['2025-02-01']);
  });

  it('limits charges only after filtering', () => {
    const result = finalizeCharges(
      [charge('2024-01-01'), charge('2025-02-01'), charge('2025-02-02'), charge('2025-02-03')],
      [],
      { ...window, limit: 2 },
    );
    expect(result.charges.map((item) => item.date)).toEqual(['2025-02-01', '2025-02-02']);
  });

  it('does not limit credits', () => {
    const credits = [charge('2025-02-01'), charge('2025-02-02'), charge('2025-02-03')];
    const result = finalizeCharges([], credits, { ...window, limit: 1 });
    expect(result.credits).toHaveLength(3);
  });
});
