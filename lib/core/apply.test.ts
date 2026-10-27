import { describe, expect, it } from 'vitest';
import { applyBlocker, selectProposals } from './apply';
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
    expect(selectProposals(proposals, ['c', 'a'], []).map((selected) => selected.txnId)).toEqual([
      'a',
      'c',
    ]);
  });

  it('skips ids that are already applied', () => {
    const proposals = [proposal('a'), proposal('b')];
    expect(selectProposals(proposals, ['a', 'b'], ['a']).map((selected) => selected.txnId)).toEqual(['b']);
  });

  it('ignores ids with no proposal', () => {
    expect(selectProposals([proposal('a')], ['z'], [])).toEqual([]);
  });
});

describe('applyBlocker', () => {
  it('blocks a scan stored before budgets were recorded', () => {
    expect(applyBlocker({ selectedBudgetId: 'b1', scanBudgetId: null })).toBe('no-scan-budget');
  });

  it('blocks when the selected budget changed after the scan', () => {
    expect(applyBlocker({ selectedBudgetId: 'b1', scanBudgetId: 'b2' })).toBe('budget-changed');
  });

  it('allows the budget the scan ran against', () => {
    expect(applyBlocker({ selectedBudgetId: 'b1', scanBudgetId: 'b1' })).toBeNull();
  });
});
