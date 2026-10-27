import { describe, expect, it } from 'vitest';
import { applyStartMessage, applySummary, selectProposals } from './apply';
import type { MatchProposal } from './matcher';

const proposal = (txnId: string): MatchProposal => ({
  kind: 'charge',
  orderId: `order-${txnId}`,
  orderDate: '2026-06-01',
  orderTotal: 10,
  items: ['Item'],
  txnId,
  txnDate: '2026-06-02',
  txnPayee: 'Amazon.com',
  memo: `Item [order-${txnId}]`,
});

describe('selectProposals', () => {
  it('keeps proposal order, not txnIds order', () => {
    const proposals = [proposal('a'), proposal('b'), proposal('c')];
    expect(selectProposals(proposals, ['c', 'a']).map((selected) => selected.txnId)).toEqual([
      'a',
      'c',
    ]);
  });

  it('ignores ids with no proposal', () => {
    expect(selectProposals([proposal('a')], ['z'])).toEqual([]);
  });
});

describe('applyStartMessage', () => {
  it('names the count', () => {
    expect(applyStartMessage(3)).toBe('Writing 3 memos…');
  });
});

describe('applySummary', () => {
  it('reports success without failures', () => {
    expect(applySummary(4, 0)).toBe('Applied 4 memos.');
  });

  it('reports successes and failures', () => {
    expect(applySummary(4, 1)).toBe('Applied 3 memos, 1 failed.');
  });
});
