import { describe, expect, it } from 'vitest';
import type { AmazonCharge, AmazonOrder, DebugCapture } from './amazon';
import {
  buildScanResult,
  MAX_DEBUG_CAPTURES,
  matchScan,
  RECENT_SCAN_DAYS,
  scanWindow,
  YNAB_LOOKBACK_DAYS,
} from './scan';
import { DEFAULT_SETTINGS } from './state';
import type { YnabTransaction } from './ynab';

const txn = (
  id: string,
  date: string,
  amount: number,
  payee: string | null,
  extra: Partial<YnabTransaction> = {},
): YnabTransaction => ({
  id,
  date,
  amount,
  payee_name: payee,
  memo: null,
  category_name: null,
  ...extra,
});

const charge = (orderId: string, date: string, amount: number): AmazonCharge => ({
  orderId,
  date,
  amount,
  paymentMethod: 'Visa ****1234',
});

const order = (
  id: string,
  date: string,
  total: number,
  items: { name: string; price: number | null }[],
): AmazonOrder => ({ id, date, total, items });

const capture = (orderId: string): DebugCapture => ({
  orderId,
  requestedUrl: `https://example.test/${orderId}`,
  finalUrl: `https://example.test/${orderId}`,
  status: 200,
  html: '<html></html>',
});

describe('scan constants', () => {
  it('match the current scan behavior', () => {
    expect(RECENT_SCAN_DAYS).toBe(90);
    expect(YNAB_LOOKBACK_DAYS).toBe(60);
    expect(MAX_DEBUG_CAPTURES).toBe(3);
  });
});

describe('scanWindow', () => {
  it('uses the last 90 days when no year is set', () => {
    expect(scanWindow({ ...DEFAULT_SETTINGS, year: null }, '2026-07-01')).toEqual({
      sinceDate: '2026-04-02',
      untilDate: undefined,
      ynabSinceDate: '2026-02-01',
    });
  });

  it('uses the full calendar year when a year is set', () => {
    expect(scanWindow({ ...DEFAULT_SETTINGS, year: 2025 }, '2026-07-01')).toEqual({
      sinceDate: '2025-01-01',
      untilDate: '2025-12-31',
      ynabSinceDate: '2024-11-02',
    });
  });

  it('crosses month and year boundaries and a 28-day February', () => {
    expect(scanWindow({ ...DEFAULT_SETTINGS, year: null }, '2026-03-01')).toEqual({
      sinceDate: '2025-12-01',
      untilDate: undefined,
      ynabSinceDate: '2025-10-02',
    });
  });
});

describe('matchScan', () => {
  const charges = [
    charge('111-A', '2026-06-10', 20),
    charge('D01-DIGITAL', '2026-06-11', 5),
    charge('111-B', '2026-06-12', 30),
  ];
  const credits = [charge('D01-REFUND', '2026-06-13', 4), charge('111-A', '2026-06-14', 20)];
  const transactions = [
    txn('t-a', '2026-06-11', -20000, 'Amazon.com'),
    txn('t-digital', '2026-06-12', -5000, 'AMZN Digital'),
    txn('t-b', '2026-06-13', -30000, 'AMZN Mktp US'),
    txn('t-refund-digital', '2026-06-14', 4000, 'Amazon.com'),
    txn('t-refund-a', '2026-06-15', 20000, 'Amazon.com'),
    txn('t-memo', '2026-06-15', -99000, 'Amazon.com', { memo: 'kept' }),
    txn('t-grocer', '2026-06-15', -20000, 'Grocer', { memo: null }),
    txn('t-null-payee', '2026-06-15', -1000, null),
  ];
  const result = matchScan({ charges, credits, transactions, maxDays: 7 });

  it('drops digital orders from both lists and counts them', () => {
    expect(result.charges.map((match) => match.charge.orderId)).toEqual(['111-A', '111-B']);
    expect(result.refunds.map((match) => match.charge.orderId)).toEqual(['111-A']);
    expect(result.digitalSkipped).toBe(2);
  });

  it('lists order ids to fetch, charges then refunds, duplicates kept', () => {
    expect(result.orderIdsToFetch).toEqual(['111-A', '111-B', '111-A']);
  });

  it('builds scanDebug with the raw lists and Amazon candidates only', () => {
    expect(result.scanDebug.charges).toBe(charges);
    expect(result.scanDebug.credits).toBe(credits);
    expect(result.scanDebug.candidates).toEqual([
      { id: 't-a', date: '2026-06-11', amount: -20000, payee: 'Amazon.com', hasMemo: false },
      { id: 't-digital', date: '2026-06-12', amount: -5000, payee: 'AMZN Digital', hasMemo: false },
      { id: 't-b', date: '2026-06-13', amount: -30000, payee: 'AMZN Mktp US', hasMemo: false },
      { id: 't-refund-digital', date: '2026-06-14', amount: 4000, payee: 'Amazon.com', hasMemo: false },
      { id: 't-refund-a', date: '2026-06-15', amount: 20000, payee: 'Amazon.com', hasMemo: false },
      { id: 't-memo', date: '2026-06-15', amount: -99000, payee: 'Amazon.com', hasMemo: true },
    ]);
  });

  it('treats a whitespace memo as no memo', () => {
    const blank = matchScan({
      charges: [],
      credits: [],
      transactions: [txn('t-blank', '2026-06-01', -1000, 'Amazon', { memo: '   ' })],
      maxDays: 7,
    });
    expect(blank.scanDebug.candidates[0]?.hasMemo).toBe(false);
  });
});

describe('buildScanResult', () => {
  const twoItemOrder = order('111-A', '2026-06-10', 20, [
    { name: 'Widget', price: 12 },
    { name: 'Gadget', price: 7 },
  ]);
  const charges = [
    charge('111-A', '2026-06-10', 20),
    charge('111-B', '2026-06-12', 30),
    charge('111-C', '2026-06-12', 15),
  ];
  const credits = [charge('111-R', '2026-06-20', 25), charge('111-N', '2026-06-21', 9)];
  const transactions = [
    txn('t-a', '2026-06-11', -20000, 'Amazon.com'),
    txn('t-b', '2026-06-13', -30000, 'Amazon.com', { subtransactions: [{ id: 's1' }] }),
    txn('t-c', '2026-06-13', -15000, 'Amazon.com'),
    txn('t-orig-r', '2026-05-02', -25000, 'Amazon.com', {
      memo: 'Thing [111-R]',
      category_name: 'Home',
    }),
    txn('t-r', '2026-06-21', 25000, 'Amazon.com'),
    txn('t-n', '2026-06-22', 9000, 'Amazon.com'),
  ];
  const orders = new Map<string, AmazonOrder>([
    ['111-A', twoItemOrder],
    [
      '111-B',
      order('111-B', '2026-06-12', 30, [
        { name: 'Lamp', price: 20 },
        { name: 'Bulb', price: 9 },
      ]),
    ],
    ['111-R', order('111-R', '2026-05-01', 25, [{ name: 'Thing', price: 25 }])],
    ['111-N', order('111-N', '2026-03-01', 9, [{ name: 'Old', price: 9 }])],
  ]);
  const matches = matchScan({ charges, credits, transactions, maxDays: 7 });
  const result = buildScanResult({
    matches,
    orders,
    transactions,
    maxDays: 7,
    captures: [capture('c1'), capture('c2'), capture('c3'), capture('c4')],
  });

  it('orders proposals charges then refunds', () => {
    expect(result.proposals.map((proposal) => [proposal.kind, proposal.orderId])).toEqual([
      ['charge', '111-A'],
      ['charge', '111-B'],
      ['refund', '111-R'],
      ['refund', '111-N'],
    ]);
  });

  it('builds splits for an unsplit transaction', () => {
    const [first] = result.proposals;
    expect(first?.memo).toBe('Widget, Gadget [111-A]');
    expect(first?.splits).toEqual([
      { amount: -12000, memo: 'Widget' },
      { amount: -7000, memo: 'Gadget' },
      { amount: -1000, memo: 'Tax & shipping' },
    ]);
  });

  it('keeps splits undefined for an already-split transaction', () => {
    const second = result.proposals[1];
    expect(second?.txnId).toBe('t-b');
    expect(second).toHaveProperty('splits', undefined);
  });

  it('recovers the original category for a refund', () => {
    expect(result.proposals[2]?.memo).toBe('Refund: Thing → was: Home [111-R]');
    expect(result.proposals[2]).not.toHaveProperty('splits');
  });

  it('omits the category suffix when no original is in range', () => {
    expect(result.proposals[3]?.memo).toBe('Refund: Old [111-N]');
  });

  it('counts unparsed invoices and copies the scan counts', () => {
    expect(result.counts).toEqual({
      charges: 3,
      credits: 2,
      digitalSkipped: 0,
      invoicesUnparsed: 1,
    });
  });

  it('writes the done message', () => {
    expect(result.message).toBe('Found 3 charges, matched 4 transactions.');
  });

  it('caps debug captures at 3 in input order', () => {
    expect(result.debugCaptures.map((item) => item.orderId)).toEqual(['c1', 'c2', 'c3']);
  });
});
