import { describe, expect, it } from 'vitest';
import type { AmazonCharge, AmazonOrder } from './amazon';
import {
  buildMemo,
  buildRefundMemo,
  buildSplits,
  findOriginalTransaction,
  isAmazonPayee,
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

describe('matcher behavior pins', () => {
  const amazon = 'Amazon.com';

  it('matches a transaction 1 day before the charge but not 2 days before', () => {
    const entry = charge('P', '2026-06-12', 10);
    expect(
      matchCharges([entry], [txn('early1', '2026-06-11', -10000, amazon)]),
    ).toHaveLength(1);
    expect(
      matchCharges([entry], [txn('early2', '2026-06-10', -10000, amazon)]),
    ).toHaveLength(0);
  });

  it('with maxDays 7, matches at +7 days and not at +8', () => {
    const entry = charge('P', '2026-06-12', 10);
    expect(
      matchCharges([entry], [txn('late7', '2026-06-19', -10000, amazon)], 7),
    ).toHaveLength(1);
    expect(
      matchCharges([entry], [txn('late8', '2026-06-20', -10000, amazon)], 7),
    ).toHaveLength(0);
  });

  it('defaults maxDays to 7 when the argument is omitted', () => {
    const entry = charge('P', '2026-06-12', 10);
    expect(
      matchCharges([entry], [txn('late7', '2026-06-19', -10000, amazon)]),
    ).toHaveLength(1);
    expect(
      matchCharges([entry], [txn('late8', '2026-06-20', -10000, amazon)]),
    ).toHaveLength(0);
  });

  it('picks the nearer of two qualifying transactions when the farther is listed first', () => {
    const matches = matchCharges(
      [charge('P', '2026-06-12', 10)],
      [
        txn('far', '2026-06-17', -10000, amazon),
        txn('near', '2026-06-13', -10000, amazon),
      ],
    );
    expect(matches.map((match) => match.txn.id)).toEqual(['near']);
  });

  it('skips a sole candidate with a non-blank memo', () => {
    expect(
      matchCharges(
        [charge('P', '2026-06-12', 10)],
        [txn('memo', '2026-06-13', -10000, amazon, 'x')],
      ),
    ).toHaveLength(0);
  });

  it('converts a float-unsafe dollar amount to exact milliunits', () => {
    expect(2.01 * 1000).not.toBe(2010);
    const matches = matchCharges(
      [charge('P', '2026-06-12', 2.01)],
      [txn('exact', '2026-06-12', -2010, amazon)],
    );
    expect(matches.map((match) => match.txn.id)).toEqual(['exact']);
  });

  it('findOriginalTransaction prefers an order-ID memo at +6 days over an amount match at +0', () => {
    const original = findOriginalTransaction(refundOrder, [
      txn('amountOnly', '2026-06-10', -67390, amazon),
      txn('byMemo', '2026-06-16', -67390, amazon, `stuff [${refundOrder.id}]`),
    ]);
    expect(original?.id).toBe('byMemo');
  });

  it('truncates an over-long memo to exactly 480 characters with an ellipsis before the order ID', () => {
    const orderId = '111-1234567-7654321';
    const suffix = ` [${orderId}]`;
    const body = 'a'.repeat(600);
    const memo = buildMemo([body], orderId);
    expect(memo).toHaveLength(480);
    expect(memo).toBe(`${'a'.repeat(480 - suffix.length - 1)}… [${orderId}]`);
  });

  it('keeps a memo body that exactly fills the limit untruncated', () => {
    const orderId = '111-1234567-7654321';
    const body = 'b'.repeat(480 - ` [${orderId}]`.length);
    expect(buildMemo([body], orderId)).toBe(`${body} [${orderId}]`);
  });

  it('names a refunded item when the amount is inside the price-plus-12%-plus-2-cents band', () => {
    expect(buildRefundMemo(refundOrder, 56.0, null)).toBe(
      'Refund: Echo Dot (5th Gen) Smart Speaker [111-5555555-5555555]',
    );
  });

  it('falls back to the item list when the amount is 1 cent above the band', () => {
    expect(buildRefundMemo(refundOrder, 56.01, null)).toBe(
      'Partial refund of $67.39 order: Echo Dot (5th Gen) Smart Speaker, Anker USB-C Cable 6ft (2-pack) [111-5555555-5555555]',
    );
  });
});

describe('isAmazonPayee', () => {
  it.each(['Amazon.com', 'AMZN Mktp US', 'amazon prime*AB12', 'Www.amzn.com/bill'])(
    'accepts %s',
    (name) => {
      expect(isAmazonPayee(name)).toBe(true);
    },
  );
  it.each([null, undefined, '', 'Costco', 'Amaz on'])('rejects %s', (name) => {
    expect(isAmazonPayee(name)).toBe(false);
  });
  it('gives the same answer on repeated calls', () => {
    expect([1, 2, 3].map(() => isAmazonPayee('Amazon'))).toEqual([true, true, true]);
  });
});
