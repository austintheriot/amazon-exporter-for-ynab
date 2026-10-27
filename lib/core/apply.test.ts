import { describe, expect, it } from 'vitest';
import { selectProposals } from './apply';
import type { MatchProposal } from './proposal';

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
