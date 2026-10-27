import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  legacyInvoiceHtml,
  modernInvoiceHtml,
  unparseableInvoiceHtml,
} from './fixtures/amazon';
import {
  buildLegacyInvoice,
  buildTransactionsPage,
  createScanWorld,
  ynabTransaction,
} from './fixtures/scan-world';
import { runApply, runScan } from '../entrypoints/background';

const TRANSACTIONS_URL = 'https://www.amazon.com/cpe/yourpayments/transactions';
const invoiceUrl = (orderId: string) =>
  `https://www.amazon.com/gp/css/summary/print.html?orderID=${orderId}`;
const ynabUrl = (sinceDate: string) =>
  `https://api.ynab.com/v1/budgets/budget-1/transactions?since_date=${sinceDate}`;

const ORDER_SPLIT = '113-1111111-1111111';
const ORDER_ALREADY_SPLIT = '113-2222222-2222222';
const ORDER_DIGITAL = 'D01-3333333-3333333';
const ORDER_SORRY = '113-4444444-4444444';
const ORDER_REFUND = '113-5555555-5555555';

const ECHO = 'Echo Dot (5th Gen) Smart Speaker';
const CABLE = 'Anker USB-C Cable 6ft (2-pack)';
const MYLAR = '15 Pack 5 Gallon Mylar Bags with Oxygen Absorbers';
const HOSE = 'Garden Hose 50ft';

const EMPTY_STATE_FIELDS = {
  proposals: [],
  counts: null,
  appliedTxnIds: [],
  lastScanAt: null,
  debugCaptures: [],
  scanDebug: null,
};

function fullScanOptions() {
  return {
    transactionPages: [
      buildTransactionsPage([
        { date: 'June 28, 2026', amount: '-$67.39', orderId: ORDER_SPLIT },
        { date: 'June 27, 2026', amount: '-$28.98', orderId: ORDER_ALREADY_SPLIT },
        { date: 'June 26, 2026', amount: '-$9.99', orderId: ORDER_DIGITAL },
        { date: 'June 25, 2026', amount: '-$15.00', orderId: ORDER_SORRY },
        { date: 'June 24, 2026', amount: '$20.00', orderId: ORDER_REFUND },
      ]),
    ],
    invoices: {
      [ORDER_SPLIT]: legacyInvoiceHtml,
      [ORDER_ALREADY_SPLIT]: modernInvoiceHtml,
      [ORDER_SORRY]: unparseableInvoiceHtml,
      [ORDER_REFUND]: buildLegacyInvoice(
        'June 10, 2026',
        [{ name: HOSE, price: 20 }],
        20,
      ),
    },
    ynab: {
      transactions: [
        ynabTransaction({ id: 'txn-a', date: '2026-06-29', amount: -67_390 }),
        ynabTransaction({
          id: 'txn-b',
          date: '2026-06-27',
          amount: -28_980,
          payee_name: 'AMZN Mktp US',
          subtransactions: [{ id: 'sub-1' }, { id: 'sub-2' }],
        }),
        ynabTransaction({
          id: 'txn-c',
          date: '2026-06-26',
          amount: -9_990,
          payee_name: 'Amazon Digital',
        }),
        ynabTransaction({ id: 'txn-d', date: '2026-06-26', amount: -15_000 }),
        ynabTransaction({ id: 'txn-r', date: '2026-06-24', amount: 20_000 }),
        ynabTransaction({
          id: 'txn-orig',
          date: '2026-06-11',
          amount: -20_000,
          category_name: 'Home & Garden',
        }),
        ynabTransaction({
          id: 'txn-grocery',
          date: '2026-06-20',
          amount: -5_000,
          payee_name: 'Corner Grocery',
        }),
        ynabTransaction({
          id: 'txn-gift',
          date: '2026-06-15',
          amount: -3_000,
          memo: 'Birthday gift',
        }),
      ],
    },
  };
}

const FULL_SCAN_PROPOSALS = [
  {
    kind: 'charge',
    orderId: ORDER_ALREADY_SPLIT,
    orderDate: '2026-06-27',
    orderTotal: 28.98,
    items: [MYLAR],
    txnId: 'txn-b',
    txnDate: '2026-06-27',
    txnPayee: 'AMZN Mktp US',
    memo: `${MYLAR} [${ORDER_ALREADY_SPLIT}]`,
    splits: undefined,
  },
  {
    kind: 'charge',
    orderId: ORDER_SPLIT,
    orderDate: '2026-06-28',
    orderTotal: 67.39,
    items: [ECHO, CABLE],
    txnId: 'txn-a',
    txnDate: '2026-06-29',
    txnPayee: 'Amazon.com',
    memo: `${ECHO}, ${CABLE} [${ORDER_SPLIT}]`,
    splits: [
      { amount: -49_990, memo: ECHO },
      { amount: -12_990, memo: CABLE },
      { amount: -4_410, memo: 'Tax & shipping' },
    ],
  },
  {
    kind: 'refund',
    orderId: ORDER_REFUND,
    orderDate: '2026-06-24',
    orderTotal: 20,
    items: [HOSE],
    txnId: 'txn-r',
    txnDate: '2026-06-24',
    txnPayee: 'Amazon.com',
    memo: `Refund: ${HOSE} → was: Home & Garden [${ORDER_REFUND}]`,
  },
];

beforeEach(() => {
  fakeBrowser.reset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-07-01T15:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('runScan date windows', () => {
  const onePage = buildTransactionsPage([
    { date: 'June 28, 2026', amount: '-$67.39', orderId: ORDER_SPLIT },
  ]);

  it('recent window asks YNAB for transactions since 2026-02-01', async () => {
    const world = await createScanWorld({
      transactionPages: [onePage],
      ynab: { transactions: [] },
    });
    await runScan();
    expect(world.requests).toEqual([TRANSACTIONS_URL, ynabUrl('2026-02-01')]);
  });

  it('year window asks YNAB since 2024-11-02 and drops a 2026 charge', async () => {
    const world = await createScanWorld({
      settings: { year: 2025 },
      transactionPages: [
        buildTransactionsPage([
          { date: 'June 28, 2026', amount: '-$67.39', orderId: ORDER_SPLIT },
          { date: 'March 3, 2025', amount: '-$15.00', orderId: ORDER_SORRY },
        ]),
      ],
      ynab: { transactions: [] },
    });
    await runScan();
    expect(world.requests).toEqual([TRANSACTIONS_URL, ynabUrl('2024-11-02')]);
    const state = await world.readState();
    expect(state.scanDebug).toEqual({
      charges: [
        {
          orderId: ORDER_SORRY,
          date: '2025-03-03',
          amount: 15,
          paymentMethod: 'Prime Visa ****1234',
        },
      ],
      credits: [],
      candidates: [],
    });
  });
});

describe('runScan full scan', () => {
  it('produces the final state, captures and request order', async () => {
    const world = await createScanWorld(fullScanOptions());
    await runScan();

    expect(world.requests).toEqual([
      TRANSACTIONS_URL,
      ynabUrl('2026-02-01'),
      invoiceUrl(ORDER_SORRY),
      invoiceUrl(ORDER_ALREADY_SPLIT),
      invoiceUrl(ORDER_SPLIT),
      invoiceUrl(ORDER_REFUND),
    ]);

    const state = await world.readState();
    expect(state).toEqual({
      status: 'done',
      message: 'Found 4 charges, matched 3 transactions.',
      proposals: FULL_SCAN_PROPOSALS,
      counts: { charges: 4, credits: 1, digitalSkipped: 1, invoicesUnparsed: 1 },
      appliedTxnIds: [],
      lastScanAt: '2026-07-01T15:00:00.000Z',
      debugCaptures: [
        {
          orderId: ORDER_SORRY,
          requestedUrl: invoiceUrl(ORDER_SORRY),
          finalUrl: '',
          status: 200,
          html: unparseableInvoiceHtml,
        },
      ],
      scanDebug: {
        charges: [
          {
            orderId: ORDER_SPLIT,
            date: '2026-06-28',
            amount: 67.39,
            paymentMethod: 'Prime Visa ****1234',
          },
          {
            orderId: ORDER_ALREADY_SPLIT,
            date: '2026-06-27',
            amount: 28.98,
            paymentMethod: 'Prime Visa ****1234',
          },
          {
            orderId: ORDER_DIGITAL,
            date: '2026-06-26',
            amount: 9.99,
            paymentMethod: 'Prime Visa ****1234',
          },
          {
            orderId: ORDER_SORRY,
            date: '2026-06-25',
            amount: 15,
            paymentMethod: 'Prime Visa ****1234',
          },
        ],
        credits: [
          {
            orderId: ORDER_REFUND,
            date: '2026-06-24',
            amount: 20,
            paymentMethod: 'Prime Visa ****1234',
          },
        ],
        candidates: [
          { id: 'txn-a', date: '2026-06-29', amount: -67_390, payee: 'Amazon.com', hasMemo: false },
          { id: 'txn-b', date: '2026-06-27', amount: -28_980, payee: 'AMZN Mktp US', hasMemo: false },
          { id: 'txn-c', date: '2026-06-26', amount: -9_990, payee: 'Amazon Digital', hasMemo: false },
          { id: 'txn-d', date: '2026-06-26', amount: -15_000, payee: 'Amazon.com', hasMemo: false },
          { id: 'txn-r', date: '2026-06-24', amount: 20_000, payee: 'Amazon.com', hasMemo: false },
          { id: 'txn-orig', date: '2026-06-11', amount: -20_000, payee: 'Amazon.com', hasMemo: false },
          { id: 'txn-gift', date: '2026-06-15', amount: -3_000, payee: 'Amazon.com', hasMemo: true },
        ],
      },
    });
  });

  it('writes status and message pairs in order', async () => {
    const world = await createScanWorld(fullScanOptions());
    await runScan();
    expect(
      world.stateWrites.map(({ status, message }) => ({ status, message })),
    ).toEqual([
      { status: 'scanning', message: 'Starting scan…' },
      { status: 'scanning', message: 'Fetching Amazon transactions page 1…' },
      { status: 'scanning', message: 'Fetching YNAB transactions…' },
      { status: 'scanning', message: 'Fetching 4 order invoices…' },
      { status: 'done', message: 'Found 4 charges, matched 3 transactions.' },
    ]);
  });
});

describe('runScan debug captures', () => {
  it('keeps the first three invoice captures in request order, capped at 500000 chars', async () => {
    const orderIds = [
      '113-0000001-0000001',
      '113-0000002-0000002',
      '113-0000003-0000003',
      '113-0000004-0000004',
      '113-0000005-0000005',
    ];
    const hugeSorryPage = `${unparseableInvoiceHtml}${'x'.repeat(600_000)}`;
    const world = await createScanWorld({
      transactionPages: [
        buildTransactionsPage(
          orderIds.map((orderId, index) => ({
            date: `June ${20 - index}, 2026`,
            amount: `-$${index + 1}.00`,
            orderId,
          })),
        ),
      ],
      invoices: Object.fromEntries(
        orderIds.map((orderId, index) => [
          orderId,
          index === 4 ? hugeSorryPage : unparseableInvoiceHtml,
        ]),
      ),
      ynab: {
        transactions: orderIds.map((orderId, index) =>
          ynabTransaction({
            id: `txn-${orderId}`,
            date: `2026-06-${20 - index}`,
            amount: -(index + 1) * 1000,
          }),
        ),
      },
    });
    await runScan();
    const state = await world.readState();

    expect(state.counts).toEqual({
      charges: 5,
      credits: 0,
      digitalSkipped: 0,
      invoicesUnparsed: 5,
    });
    expect(state.debugCaptures.length).toBe(3);
    expect(state.debugCaptures.map((capture) => capture.orderId)).toEqual([
      orderIds[4],
      orderIds[3],
      orderIds[2],
    ]);
    expect(state.debugCaptures[0]?.html.length).toBe(500_000);
    for (const capture of state.debugCaptures) {
      expect(capture.html.length).toBeLessThanOrEqual(500_000);
    }
  });

  it('captures an empty first Transactions page', async () => {
    const emptyPage = '<html><body><p>Nothing here</p></body></html>';
    const world = await createScanWorld({
      transactionPages: [emptyPage],
      ynab: { transactions: [] },
    });
    await runScan();
    const state = await world.readState();

    expect(state.proposals).toEqual([]);
    expect(state.debugCaptures).toEqual([
      {
        orderId: '(transactions page)',
        requestedUrl: TRANSACTIONS_URL,
        finalUrl: '',
        status: 200,
        html: emptyPage,
      },
    ]);
  });
});

describe('runScan failures', () => {
  it('YNAB 401 reports reconnect and removes the token', async () => {
    const world = await createScanWorld({
      transactionPages: [
        buildTransactionsPage([
          { date: 'June 28, 2026', amount: '-$67.39', orderId: ORDER_SPLIT },
        ]),
      ],
      ynab: { status: 401, transactions: [] },
    });
    await runScan();

    expect(await world.readState()).toEqual({
      ...EMPTY_STATE_FIELDS,
      status: 'error',
      message: 'YNAB session expired. Reconnect YNAB in the popup.',
    });
    expect(await world.readToken()).toBeUndefined();
  });

  it('Amazon sign-in page reports not signed in', async () => {
    const world = await createScanWorld({
      transactionPages: ['<html><body><h1>Sign in</h1></body></html>'],
    });
    await runScan();

    expect(await world.readState()).toEqual({
      ...EMPTY_STATE_FIELDS,
      status: 'error',
      message: 'Not signed in to Amazon. Open amazon.com, sign in, then scan again.',
    });
    expect(world.requests).toEqual([TRANSACTIONS_URL]);
  });

  it('missing budget stops before any request', async () => {
    const world = await createScanWorld({
      settings: { budgetId: '' },
      transactionPages: [],
    });
    await runScan();

    expect(await world.readState()).toEqual({
      ...EMPTY_STATE_FIELDS,
      status: 'error',
      message: 'Pick a budget first.',
    });
    expect(world.requests).toEqual([]);
  });
});

describe('runApply', () => {
  it('writes proposals in proposal order and counts the failed PUT', async () => {
    const world = await createScanWorld({
      ...fullScanOptions(),
      putStatuses: { 'txn-r': 500 },
    });
    await runScan();
    world.stateWrites.length = 0;
    world.ynabWrites.length = 0;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await runApply(['txn-r', 'txn-a']);

    expect(world.ynabWrites).toEqual([
      {
        txnId: 'txn-a',
        body: {
          transaction: {
            memo: `${ECHO}, ${CABLE} [${ORDER_SPLIT}]`,
            subtransactions: [
              { amount: -49_990, memo: ECHO },
              { amount: -12_990, memo: CABLE },
              { amount: -4_410, memo: 'Tax & shipping' },
            ],
          },
        },
      },
      {
        txnId: 'txn-r',
        body: {
          transaction: {
            memo: `Refund: ${HOSE} → was: Home & Garden [${ORDER_REFUND}]`,
          },
        },
      },
    ]);
    expect(consoleError).toHaveBeenCalledTimes(1);

    const state = await world.readState();
    expect(state.appliedTxnIds).toEqual(['txn-a']);
    expect(state.status).toBe('done');
    expect(state.message).toBe('Applied 1 memos, 1 failed.');
    expect(
      world.stateWrites.map(({ status, message }) => ({ status, message })),
    ).toEqual([
      { status: 'applying', message: 'Writing 2 memos…' },
      { status: 'applying', message: 'Writing 2 memos…' },
      { status: 'done', message: 'Applied 1 memos, 1 failed.' },
    ]);
  });
});
