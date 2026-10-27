import { describe, expect, it } from 'vitest';
import type { AmazonCharge, AmazonOrder } from './amazon';
import {
  buildMemo,
  buildRefundMemo,
  buildSplits,
  findOriginalTransaction,
  matchCharges,
  matchRefunds,
} from './matcher';
import type { YnabTransaction } from './ynab';

const txn = (
  id: string,
  date: string,
  amount: number,
  payee: string | null,
  memo: string | null = null,
  category: string | null = null,
): YnabTransaction => ({
  id,
  date,
  amount,
  payee_name: payee,
  memo,
  category_name: category,
});

const charge = (
  orderId: string,
  date: string,
  amount: number,
): AmazonCharge => ({ orderId, date, amount, paymentMethod: 'Visa ****1234' });

describe('matchCharges', () => {
  const charges = [
    charge('A', '2026-06-12', 67.39),
    charge('B', '2026-06-15', 23.5),
    charge('C', '2026-06-20', 99.99),
    charge('D', '2026-06-22', 10.0),
    charge('D', '2026-06-23', 15.0),
  ];
  const txns: YnabTransaction[] = [
    txn('t1', '2026-06-13', -67390, 'Amazon.com'),
    txn('t2', '2026-06-16', -23500, 'AMZN Mktp US'),
    txn('t3', '2026-06-21', -99990, 'Costco'),
    txn('t4', '2026-06-14', -67390, 'Amazon.com', 'already has memo'),
    txn('t5', '2026-06-23', -10000, 'Amazon.com'),
    txn('t6', '2026-06-24', -15000, 'Amazon.com'),
  ];
  const matches = matchCharges(charges, txns);

  it('four matches', () => {
    expect(matches.length).toBe(4);
  });
  it('A matched to t1', () => {
    expect(
      matches.some(
        (match) => match.charge.orderId === 'A' && match.txn.id === 't1',
      ),
    ).toBe(true);
  });
  it('C unmatched (payee filter)', () => {
    expect(matches.some((match) => match.charge.orderId === 'C')).toBe(false);
  });
  it('split shipment: both D charges matched', () => {
    expect(matches.filter((match) => match.charge.orderId === 'D').length).toBe(
      2,
    );
  });
  it('one-to-one claiming', () => {
    const duplicateCharges = [
      charge('X', '2026-06-12', 10),
      charge('Y', '2026-06-12', 10),
    ];
    const oneTxn = [txn('t9', '2026-06-13', -10000, 'Amazon.com')];
    expect(matchCharges(duplicateCharges, oneTxn).length).toBe(1);
  });
  it('treats a whitespace-only memo as blank', () => {
    const blankMemo = txn('t7', '2026-06-13', -10000, 'Amazon.com', '   ');
    expect(
      matchCharges([charge('E', '2026-06-12', 10)], [blankMemo]),
    ).toHaveLength(1);
  });
  it('never matches a null payee', () => {
    const noPayee = txn('t8', '2026-06-13', -10000, null);
    expect(
      matchCharges([charge('E', '2026-06-12', 10)], [noPayee]),
    ).toHaveLength(0);
  });
});

describe('buildMemo', () => {
  it('memo truncated', () => {
    const longMemo = buildMemo(
      Array.from({ length: 60 }, (_, i) => `Item number ${String(i)} with a long name`),
      '111-1234567-7654321',
    );
    expect(longMemo.length).toBeLessThanOrEqual(480);
  });
  it('order id survives truncation', () => {
    const longMemo = buildMemo(
      Array.from({ length: 60 }, (_, i) => `Item number ${String(i)} with a long name`),
      '111-1234567-7654321',
    );
    expect(longMemo.endsWith(' [111-1234567-7654321]')).toBe(true);
  });
  it('short memo has order id', () => {
    expect(buildMemo(['Echo Dot'], '111-0000000-0000000')).toBe(
      'Echo Dot [111-0000000-0000000]',
    );
  });
});

const refundOrder: AmazonOrder = {
  id: '111-5555555-5555555',
  date: '2026-06-10',
  total: 67.39,
  items: [
    { name: 'Echo Dot (5th Gen) Smart Speaker', price: 49.99 },
    { name: 'Anker USB-C Cable 6ft (2-pack)', price: 12.99 },
  ],
};

describe('refunds', () => {
  it('refund matched to inflow', () => {
    const refundTxns = [
      txn('r1', '2026-06-26', 53740, 'Amazon.com'),
      txn('r2', '2026-06-26', -53740, 'Amazon.com'),
    ];
    const refundMatches = matchRefunds(
      [
        {
          orderId: refundOrder.id,
          date: '2026-06-25',
          amount: 53.74,
          paymentMethod: '',
        },
      ],
      refundTxns,
    );
    expect(refundMatches.length).toBe(1);
    expect(refundMatches[0]?.txn.id).toBe('r1');
  });
  it('full refund memo lists items and category', () => {
    expect(buildRefundMemo(refundOrder, 67.39, 'Electronics')).toBe(
      'Refund: Echo Dot (5th Gen) Smart Speaker, Anker USB-C Cable 6ft (2-pack) → was: Electronics [111-5555555-5555555]',
    );
  });
  it('partial refund names the single price-matched item', () => {
    expect(buildRefundMemo(refundOrder, 53.74, null)).toBe(
      'Refund: Echo Dot (5th Gen) Smart Speaker [111-5555555-5555555]',
    );
  });
  it('ambiguous partial refund falls back to item list', () => {
    const memo = buildRefundMemo(refundOrder, 30.0, null);
    expect(memo.startsWith('Partial refund of $67.39 order:')).toBe(true);
    expect(memo).toContain('Echo Dot');
  });
});

describe('findOriginalTransaction', () => {
  const originalTxns = [
    txn(
      'o1',
      '2026-06-11',
      -67390,
      'Amazon.com',
      'stuff [111-5555555-5555555]',
      'Electronics',
    ),
    txn('o2', '2026-06-11', -67390, 'Amazon.com', null, 'Household'),
  ];
  it('original found by order id in memo', () => {
    expect(findOriginalTransaction(refundOrder, originalTxns)?.id).toBe('o1');
  });
  it('original found by amount when no memo has the order id', () => {
    expect(findOriginalTransaction(refundOrder, originalTxns.slice(1))?.id).toBe(
      'o2',
    );
  });
  it('no original when nothing matches', () => {
    expect(
      findOriginalTransaction(refundOrder, [
        txn('o3', '2026-06-11', -10000, 'Amazon.com'),
      ]),
    ).toBeNull();
  });
});

describe('buildSplits', () => {
  const [firstItem] = refundOrder.items;
  it('splits: item amounts plus tax remainder', () => {
    const splits = buildSplits(refundOrder, 67.39);
    expect(splits?.length).toBe(3);
    expect(splits?.map((split) => split.amount)).toEqual([
      -49990, -12990, -4410,
    ]);
    expect(splits?.[2]?.memo).toBe('Tax & shipping');
  });
  it('splits sum to the charge', () => {
    const splits = buildSplits(refundOrder, 67.39);
    expect(splits?.reduce((sum, split) => sum + split.amount, 0)).toBe(-67390);
  });
  it('no splits for single item', () => {
    expect(
      buildSplits(
        { ...refundOrder, items: firstItem ? [firstItem] : [] },
        67.39,
      ),
    ).toBeNull();
  });
  it('no splits when charge is not the order total', () => {
    expect(buildSplits(refundOrder, 49.99)).toBeNull();
  });
  it('no splits when a price is missing', () => {
    expect(
      buildSplits(
        {
          ...refundOrder,
          items: [
            ...(firstItem ? [firstItem] : []),
            { name: 'X mystery item', price: null },
          ],
        },
        67.39,
      ),
    ).toBeNull();
  });
});
