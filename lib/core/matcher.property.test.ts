import { fc, it } from '@fast-check/vitest';
import { describe, expect } from 'vitest';
import {
  chargeArb,
  orderArb,
  pricedOrderArb,
  refundAmountArb,
  textArb,
  transactionArb,
} from '../../test/arbitraries';
import {
  buildMemo,
  buildRefundMemo,
  buildSplits,
  matchCharges,
  matchRefunds,
} from './matcher';
import { dollarsToOutflowMilliunits, type YnabTransaction } from './ynab';

const DAY_MS = 86_400_000;
const MEMO_MAX_LENGTH = 480;
const SPEC_AMAZON_PAYEE = /amazon|amzn/i;

const daysBetween = (from: string, to: string): number =>
  (new Date(to).getTime() - new Date(from).getTime()) / DAY_MS;

const withUniqueIds = (transactions: YnabTransaction[]): YnabTransaction[] =>
  transactions.map((transaction, index) => ({
    ...transaction,
    id: `txn-${String(index)}`,
  }));

const scenarioArb = fc
  .array(chargeArb, { minLength: 1, maxLength: 8 })
  .chain((charges) =>
    fc
      .tuple(
        fc.array(transactionArb, { maxLength: 8 }),
        fc.array(
          fc
            .tuple(
              fc.constantFrom(...charges),
              transactionArb,
              fc.integer({ min: -2, max: 9 }),
              fc.constantFrom(-1, 1),
            )
            .map(([source, base, dayShift, sign]) => ({
              ...base,
              amount: sign * Math.round(source.amount * 1000),
              date: shiftDate(source.date, dayShift),
            })),
          { maxLength: 12 },
        ),
        fc.integer({ min: 0, max: 14 }),
      )
      .map(([randomTransactions, nearTransactions, maxDays]) => ({
        charges,
        transactions: withUniqueIds([
          ...randomTransactions,
          ...nearTransactions,
        ]),
        maxDays,
      })),
  );

function shiftDate(date: string, days: number): string {
  return new Date(new Date(date).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

const matchers = [
  { name: 'matchCharges', match: matchCharges, sign: -1 },
  { name: 'matchRefunds', match: matchRefunds, sign: 1 },
] as const;

describe.each(matchers)('$name properties', ({ match, sign }) => {
  it.prop([scenarioArb])(
    'claims each transaction at most once',
    ({ charges, transactions, maxDays }) => {
      const ids = match(charges, transactions, maxDays).map(
        (found) => found.txn.id,
      );
      expect(new Set(ids).size).toBe(ids.length);
    },
  );

  it.prop([scenarioArb])(
    'matches only on exact milliunit amount inside the date window',
    ({ charges, transactions, maxDays }) => {
      for (const found of match(charges, transactions, maxDays)) {
        expect(found.txn.amount).toBe(
          sign * Math.round(found.charge.amount * 1000),
        );
        const diff = daysBetween(found.charge.date, found.txn.date);
        expect(diff).toBeGreaterThanOrEqual(-1);
        expect(diff).toBeLessThanOrEqual(maxDays);
      }
    },
  );

  it.prop([scenarioArb])(
    'leaves no unmatched entry with an unclaimed qualifying transaction',
    ({ charges, transactions, maxDays }) => {
      const found = match(charges, transactions, maxDays);
      const claimedIds = new Set(found.map((pair) => pair.txn.id));
      const matchedEntries = new Set(found.map((pair) => pair.charge));
      for (const entry of charges) {
        if (matchedEntries.has(entry)) continue;
        const leftover = transactions.filter((transaction) => {
          const diff = daysBetween(entry.date, transaction.date);
          return (
            !claimedIds.has(transaction.id) &&
            transaction.amount === sign * Math.round(entry.amount * 1000) &&
            SPEC_AMAZON_PAYEE.test(transaction.payee_name ?? '') &&
            (transaction.memo ?? '').trim() === '' &&
            diff >= -1 &&
            diff <= maxDays
          );
        });
        expect(leftover).toEqual([]);
      }
    },
  );
});

describe('buildSplits properties', () => {
  it.prop([
    fc.oneof(pricedOrderArb, pricedOrderArb, orderArb),
    fc.integer({ min: -1, max: 1 }),
  ])(
    'sums to the charge in milliunits whenever it returns splits',
    (order, centsOffset) => {
      const chargeAmount = Math.max(
        0.01,
        Math.round(order.total * 100 + centsOffset) / 100,
      );
      const splits = buildSplits(order, chargeAmount);
      if (splits === null) return;
      const total = splits.reduce((sum, split) => sum + split.amount, 0);
      expect(total).toBe(dollarsToOutflowMilliunits(chargeAmount));
    },
  );
});

describe('memo properties', () => {
  it.prop([orderArb])(
    'buildMemo stays within the memo limit and ends with the order ID',
    (order) => {
      const memo = buildMemo(
        order.items.map((item) => item.name),
        order.id,
      );
      expect(memo.length).toBeLessThanOrEqual(MEMO_MAX_LENGTH);
      expect(memo.endsWith(`[${order.id}]`)).toBe(true);
    },
  );

  it.prop([
    orderArb.chain((order) =>
      fc.tuple(fc.constant(order), refundAmountArb(order)),
    ),
    fc.option(textArb, { nil: null }),
  ])(
    'buildRefundMemo stays within the memo limit and ends with the order ID',
    ([order, refundAmount], category) => {
      const memo = buildRefundMemo(order, refundAmount, category);
      expect(memo.length).toBeLessThanOrEqual(MEMO_MAX_LENGTH);
      expect(memo.endsWith(`[${order.id}]`)).toBe(true);
    },
  );
});
