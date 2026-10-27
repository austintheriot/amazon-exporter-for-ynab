import { fc, it } from '@fast-check/vitest';
import { describe, expect } from 'vitest';
import type { AmazonCharge, AmazonOrder } from './amazon';
import { buildScanResult, matchScan } from './scan';
import { explainUnmatched, type UnmatchedEntry } from './unmatched';
import type { YnabTransaction } from './ynab';

const DAY_MS = 86_400_000;
const BASE_DAY = Date.UTC(2026, 5, 1);

const dayAt = (offset: number): string => new Date(BASE_DAY + offset * DAY_MS).toISOString().slice(0, 10);

const orderIdArb = fc.constantFrom(
  '111-0000000-0000001',
  '111-0000000-0000002',
  '111-0000000-0000003',
  'D01-0000000-0000004',
);
const amountArb = fc.constantFrom(5, 12.5, 67.38, 67.39);
const entryArb: fc.Arbitrary<AmazonCharge> = fc.record({
  orderId: orderIdArb,
  date: fc.integer({ min: 0, max: 6 }).map(dayAt),
  amount: amountArb,
  paymentMethod: fc.constant('Visa ****1234'),
});

const nearTransactionArb = (entries: AmazonCharge[]): fc.Arbitrary<Omit<YnabTransaction, 'id'>> =>
  fc
    .record({
      source: fc.constantFrom(...entries),
      dayShift: fc.integer({ min: -3, max: 10 }),
      sign: fc.constantFrom(-1, 1),
      memo: fc.constantFrom<string | null>(null, '', 'Already written'),
      payee: fc.constantFrom('Amazon.com', 'AMZN Mktp US', 'Grocery Store'),
    })
    .map(({ source, dayShift, sign, memo, payee }) => ({
      date: dayAt(Math.round((Date.parse(source.date) - BASE_DAY) / DAY_MS) + dayShift),
      amount: sign * Math.round(source.amount * 1000),
      payee_name: payee,
      memo,
      category_name: null,
    }));

const scenarioArb = fc
  .tuple(fc.array(entryArb, { maxLength: 6 }), fc.array(entryArb, { maxLength: 3 }))
  .filter(([charges, credits]) => charges.length + credits.length > 0)
  .chain(([charges, credits]) =>
    fc.record({
      charges: fc.constant(charges),
      credits: fc.constant(credits),
      transactions: fc
        .array(nearTransactionArb([...charges, ...credits]), { maxLength: 8 })
        .map((list) => list.map((transaction, index) => ({ ...transaction, id: `txn-${String(index)}` }))),
      readableOrderIds: fc.subarray(['111-0000000-0000001', '111-0000000-0000002', '111-0000000-0000003']),
      maxDays: fc.integer({ min: 0, max: 7 }),
    }),
  );

const entryKey = (kind: string, entry: { orderId: string; date: string; amount: number }) =>
  `${kind}|${entry.orderId}|${entry.date}|${String(entry.amount)}`;

const ordersFor = (orderIds: string[]): Map<string, AmazonOrder> =>
  new Map(
    orderIds.map((orderId) => [
      orderId,
      { id: orderId, date: dayAt(0), total: 1, items: [{ name: 'Item', price: null }] },
    ]),
  );

function explainScenario(scenario: {
  charges: AmazonCharge[];
  credits: AmazonCharge[];
  transactions: YnabTransaction[];
  readableOrderIds: string[];
  maxDays: number;
}) {
  const { charges, credits, transactions, readableOrderIds, maxDays } = scenario;
  const matches = matchScan({ charges, credits, transactions, maxDays });
  const { proposals } = buildScanResult({
    matches,
    orders: ordersFor(readableOrderIds),
    transactions,
    maxDays,
    captures: [],
  });
  const unmatched = explainUnmatched({ scanDebug: matches.scanDebug, proposals, maxDays });
  return { proposals, unmatched };
}

describe('explainUnmatched against the matcher', () => {
  it.prop([scenarioArb])('lists exactly the entries with no proposal', (scenario) => {
    const { proposals, unmatched } = explainScenario(scenario);

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
      ...scenario.charges.map((entry) => entryKey('charge', entry)),
      ...scenario.credits.map((entry) => entryKey('refund', entry)),
    ].filter((key) => {
      const count = remaining.get(key) ?? 0;
      if (count === 0) return true;
      remaining.set(key, count - 1);
      return false;
    });

    expect(unmatched.map((entry) => entryKey(entry.kind, entry)).sort()).toEqual([...expected].sort());
  });

  it.prop([scenarioArb])('says an order was unreadable only when its order page is missing', (scenario) => {
    const { unmatched } = explainScenario(scenario);
    const unreadable = unmatched.filter((entry: UnmatchedEntry) => entry.reason.kind === 'order-unreadable');
    for (const entry of unreadable) expect(scenario.readableOrderIds).not.toContain(entry.orderId);
  });

  it.prop([scenarioArb])('marks every digital order as digital', (scenario) => {
    const { unmatched } = explainScenario(scenario);
    for (const entry of unmatched) {
      expect(entry.reason.kind === 'digital').toBe(entry.orderId.startsWith('D0'));
    }
  });
});
