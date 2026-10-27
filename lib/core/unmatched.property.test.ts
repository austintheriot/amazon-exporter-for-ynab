import { fc, it } from '@fast-check/vitest';
import { describe, expect } from 'vitest';
import { chargeArb, transactionArb } from '../../test/arbitraries';
import type { AmazonCharge, AmazonOrder } from './amazon';
import { buildScanResult, matchScan } from './scan';
import { explainUnmatched } from './unmatched';

const entryKey = (kind: string, entry: { orderId: string; date: string; amount: number }) =>
  `${kind}|${entry.orderId}|${entry.date}|${String(entry.amount)}`;

const sorted = (keys: string[]) => [...keys].sort();

const ordersFor = (entries: AmazonCharge[]): Map<string, AmazonOrder> =>
  new Map(
    entries.map((entry) => [
      entry.orderId,
      { id: entry.orderId, date: entry.date, total: entry.amount, items: [{ name: 'Item', price: null }] },
    ]),
  );

describe('explainUnmatched against the matcher', () => {
  it.prop([
    fc.array(chargeArb, { maxLength: 8 }),
    fc.array(chargeArb, { maxLength: 4 }),
    fc.array(transactionArb, { maxLength: 10 }),
    fc.integer({ min: 0, max: 14 }),
  ])('lists exactly the entries with no proposal', (charges, credits, rawTransactions, maxDays) => {
    const transactions = rawTransactions.map((transaction, index) => ({
      ...transaction,
      id: `txn-${String(index)}`,
    }));
    const matches = matchScan({ charges, credits, transactions, maxDays });
    const { proposals } = buildScanResult({
      matches,
      orders: ordersFor([...charges, ...credits]),
      transactions,
      maxDays,
      captures: [],
    });

    const unmatched = explainUnmatched({ scanDebug: matches.scanDebug, proposals, maxDays });

    const remaining = new Map<string, number>();
    for (const proposal of proposals) {
      const key = entryKey(proposal.kind, {
        orderId: proposal.orderId,
        date: proposal.orderDate,
        amount: proposal.orderTotal,
      });
      remaining.set(key, (remaining.get(key) ?? 0) + 1);
    }
    const expected = [
      ...charges.map((entry) => entryKey('charge', entry)),
      ...credits.map((entry) => entryKey('refund', entry)),
    ].filter((key) => {
      const count = remaining.get(key) ?? 0;
      if (count === 0) return true;
      remaining.set(key, count - 1);
      return false;
    });

    expect(sorted(unmatched.map((entry) => entryKey(entry.kind, entry)))).toEqual(sorted(expected));
    expect(unmatched.some((entry) => entry.reason.kind === 'order-unreadable')).toBe(false);
  });
});
