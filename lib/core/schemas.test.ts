import { load } from 'cheerio/slim';
import { describe, expect, it } from 'vitest';
import { invoiceCapturesSchema, parseTransactionsPage } from './amazon';
import { parseStoredToken } from './oauth';
import {
  DEFAULT_SETTINGS,
  DEFAULT_STATE,
  parseMessage,
  parseSettings,
  parseSyncState,
} from './state';
import {
  parseBudgetsResponse,
  parseTransactionsResponse,
  YnabResponseError,
} from './ynab';

function wireTransaction(id: string, amount: unknown) {
  return {
    id,
    date: '2026-06-28',
    amount,
    memo: null,
    cleared: 'cleared',
    approved: true,
    flag_color: null,
    account_id: 'acct-1',
    payee_name: 'Amazon.com',
    category_name: null,
    subtransactions: [],
  };
}

describe('parseBudgetsResponse', () => {
  it('returns id and name for each budget and drops extra fields', () => {
    const raw = {
      data: {
        budgets: [
          { id: 'b-1', name: 'Main', last_modified_on: '2026-06-01T00:00:00Z' },
          { id: 'b-2', name: 'Side', currency_format: { iso_code: 'USD' } },
        ],
        default_budget: null,
      },
    };
    expect(parseBudgetsResponse(raw)).toEqual([
      { id: 'b-1', name: 'Main' },
      { id: 'b-2', name: 'Side' },
    ]);
  });

  it('throws YnabResponseError naming the endpoint and path of a wrong-typed field', () => {
    const raw = { data: { budgets: [{ id: 'b-1', name: 42 }] } };
    expect(() => parseBudgetsResponse(raw)).toThrow(YnabResponseError);
    expect(() => parseBudgetsResponse(raw)).toThrow(
      /^YNAB \/budgets response invalid at data\.budgets\.0\.name: /,
    );
  });
});

describe('parseTransactionsResponse', () => {
  it('keeps only the fields the code reads', () => {
    const raw = {
      data: {
        transactions: [
          wireTransaction('t-1', -12_000),
          {
            ...wireTransaction('t-2', -28_980),
            memo: 'gift',
            category_name: 'Home',
            subtransactions: [{ id: 'sub-1', amount: -1_000 }],
          },
        ],
        server_knowledge: 7,
      },
    };
    expect(parseTransactionsResponse(raw)).toEqual([
      {
        id: 't-1',
        date: '2026-06-28',
        amount: -12_000,
        payee_name: 'Amazon.com',
        memo: null,
        category_name: null,
        subtransactions: [],
      },
      {
        id: 't-2',
        date: '2026-06-28',
        amount: -28_980,
        payee_name: 'Amazon.com',
        memo: 'gift',
        category_name: 'Home',
        subtransactions: [{ id: 'sub-1' }],
      },
    ]);
  });

  it('accepts a transaction without subtransactions', () => {
    const row = Object.fromEntries(
      Object.entries(wireTransaction('t-1', -1)).filter(([key]) => key !== 'subtransactions'),
    );
    expect(parseTransactionsResponse({ data: { transactions: [row] } })).toEqual([
      {
        id: 't-1',
        date: '2026-06-28',
        amount: -1,
        payee_name: 'Amazon.com',
        memo: null,
        category_name: null,
      },
    ]);
  });

  it('throws at the path of a string amount', () => {
    const raw = {
      data: {
        transactions: [
          wireTransaction('t-0', -1),
          wireTransaction('t-1', -2),
          wireTransaction('t-2', -3),
          wireTransaction('t-3', '12'),
        ],
      },
    };
    expect(() => parseTransactionsResponse(raw)).toThrow(YnabResponseError);
    expect(() => parseTransactionsResponse(raw)).toThrow(
      /^YNAB \/transactions response invalid at data\.transactions\.3\.amount: .+/,
    );
  });
});

describe('parseSettings', () => {
  it('returns stored settings and drops extra fields', () => {
    const stored = {
      budgetId: 'b-1',
      budgetName: 'Main',
      year: 2025,
      maxDays: 3,
      orderLimit: 20,
      theme: 'dark',
    };
    expect(parseSettings(stored)).toEqual({
      budgetId: 'b-1',
      budgetName: 'Main',
      year: 2025,
      maxDays: 3,
      orderLimit: 20,
    });
  });

  it('falls back to the default for each wrong-typed or missing field', () => {
    expect(parseSettings({ maxDays: 'x', year: 2025 })).toEqual({
      ...DEFAULT_SETTINGS,
      maxDays: 7,
      year: 2025,
    });
  });

  it('returns the defaults when nothing is stored', () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });
});

const STATE_0_1_1 = {
  status: 'done',
  message: 'Found 2 matches.',
  proposals: [
    {
      kind: 'charge',
      orderId: '113-1111111-1111111',
      orderDate: '2026-06-28',
      orderTotal: 67.39,
      items: ['Echo Dot', 'USB-C Cable'],
      txnId: 'txn-a',
      txnDate: '2026-06-29',
      txnPayee: 'Amazon.com',
      memo: 'Echo Dot, USB-C Cable [113-1111111-1111111]',
      splits: [
        { amount: -49_990, memo: 'Echo Dot' },
        { amount: -12_990, memo: 'USB-C Cable' },
        { amount: -4_410, memo: 'Tax & shipping' },
      ],
    },
    {
      kind: 'refund',
      orderId: '113-5555555-5555555',
      orderDate: '2026-06-24',
      orderTotal: 20,
      items: ['Garden Hose'],
      txnId: 'txn-r',
      txnDate: '2026-06-24',
      txnPayee: 'Amazon.com',
      memo: 'Refund: Garden Hose [113-5555555-5555555]',
    },
  ],
  counts: { charges: 4, credits: 1, digitalSkipped: 1, invoicesUnparsed: 1 },
  appliedTxnIds: ['txn-a'],
  lastScanAt: '2026-07-01T15:00:00.000Z',
  debugCaptures: [
    {
      orderId: '113-4444444-4444444',
      requestedUrl:
        'https://www.amazon.com/gp/css/summary/print.html?orderID=113-4444444-4444444',
      finalUrl:
        'https://www.amazon.com/gp/css/summary/print.html?orderID=113-4444444-4444444',
      status: 200,
      html: '<html><body>We are sorry</body></html>',
    },
  ],
  scanDebug: {
    charges: [
      {
        orderId: '113-1111111-1111111',
        date: '2026-06-28',
        amount: 67.39,
        paymentMethod: 'Prime Visa ****1234',
      },
    ],
    credits: [
      {
        orderId: '113-5555555-5555555',
        date: '2026-06-24',
        amount: 20,
        paymentMethod: '',
      },
    ],
    candidates: [
      {
        id: 'txn-a',
        date: '2026-06-29',
        amount: -67_390,
        payee: 'Amazon.com',
        hasMemo: false,
      },
    ],
  },
};

describe('parseSyncState', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(parseSyncState(undefined)).toEqual(DEFAULT_STATE);
  });

  it('round-trips a state written by 0.1.1', () => {
    expect(parseSyncState(structuredClone(STATE_0_1_1))).toEqual(STATE_0_1_1);
  });

  it('accepts a proposal whose splits key is undefined', () => {
    const [charge] = STATE_0_1_1.proposals;
    const proposal = { ...charge, splits: undefined };
    expect(parseSyncState({ proposals: [proposal] }).proposals).toEqual([proposal]);
  });

  it('drops extra fields', () => {
    const state = parseSyncState({ ...STATE_0_1_1, legacyFlag: true });
    expect(state).toEqual(STATE_0_1_1);
    expect(state).not.toHaveProperty('legacyFlag');
  });

  it('falls back to the default for each wrong-typed field and keeps the rest', () => {
    expect(
      parseSyncState({
        ...STATE_0_1_1,
        status: 'exploded',
        counts: { charges: 'four' },
        appliedTxnIds: [1, 2],
      }),
    ).toEqual({
      ...STATE_0_1_1,
      status: 'idle',
      counts: null,
      appliedTxnIds: [],
    });
  });

  it('returns fresh default arrays on every call', () => {
    const first = parseSyncState(undefined);
    first.appliedTxnIds.push('txn-x');
    expect(parseSyncState(undefined).appliedTxnIds).toEqual([]);
  });
});

describe('parseMessage', () => {
  it('accepts a scan message', () => {
    expect(parseMessage({ type: 'scan' })).toEqual({ type: 'scan' });
  });

  it('accepts an apply message and drops extra fields', () => {
    expect(parseMessage({ type: 'apply', txnIds: ['a', 'b'], from: 'popup' })).toEqual({
      type: 'apply',
      txnIds: ['a', 'b'],
    });
  });

  it('is null for an unknown type', () => {
    expect(parseMessage({ type: 'nope' })).toBeNull();
  });

  it('is null for an apply message with wrong-typed ids', () => {
    expect(parseMessage({ type: 'apply', txnIds: 'a' })).toBeNull();
  });

  it('is null for a non-object', () => {
    expect(parseMessage('scan')).toBeNull();
  });
});

describe('parseStoredToken', () => {
  it('returns the token and drops extra fields', () => {
    expect(
      parseStoredToken({ accessToken: 'abc', expiresAt: 1_000, scope: 'read' }),
    ).toEqual({ accessToken: 'abc', expiresAt: 1_000 });
  });

  it('is null for a wrong-typed field', () => {
    expect(parseStoredToken({ accessToken: 'abc', expiresAt: '1000' })).toBeNull();
  });

  it('is null when nothing is stored', () => {
    expect(parseStoredToken(undefined)).toBeNull();
  });
});

function nextDataPage(transactionList: unknown[]): string {
  const data = {
    props: {
      pageProps: {
        state: {
          transactionResponseState: {
            visibleTransactionResponse: { transactionList },
          },
        },
      },
    },
  };
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`;
}

function nextDataRow(formattedAmount: unknown, orderId: string) {
  return {
    formattedAmount,
    formattedDate: 'June 28, 2026',
    orderData: [{ orderDisplayString: `Order #${orderId}` }],
    statusInfo: {},
    paymentMethodDisplayStringData: {
      paymentMethodName: 'Prime Visa',
      paymentMethodNumber: { lastDigits: '1234' },
    },
    unusedField: { nested: true },
  };
}

describe('parseTransactionsPage (__NEXT_DATA__ rows)', () => {
  it('skips a row with a numeric formattedAmount and keeps the others', () => {
    const html = nextDataPage([
      nextDataRow('-$10.00', '113-1111111-1111111'),
      nextDataRow(-20, '113-2222222-2222222'),
      nextDataRow('-$30.00', '113-3333333-3333333'),
    ]);
    expect(parseTransactionsPage(load(html))).toEqual({
      charges: [
        {
          orderId: '113-1111111-1111111',
          date: '2026-06-28',
          amount: 10,
          paymentMethod: 'Prime Visa ****1234',
        },
        {
          orderId: '113-3333333-3333333',
          date: '2026-06-28',
          amount: 30,
          paymentMethod: 'Prime Visa ****1234',
        },
      ],
      credits: [],
    });
  });

  it('gives empty lists when the transaction list is not an array', () => {
    const html = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
      { props: { pageProps: { state: { transactionResponseState: { visibleTransactionResponse: { transactionList: 'x' } } } } } },
    )}</script></body></html>`;
    expect(parseTransactionsPage(load(html))).toEqual({ charges: [], credits: [] });
  });

  it('still throws on invalid JSON', () => {
    const html =
      '<html><body><script id="__NEXT_DATA__" type="application/json">{not json</script></body></html>';
    expect(() => parseTransactionsPage(load(html))).toThrow(SyntaxError);
  });
});

describe('invoiceCapturesSchema', () => {
  it('accepts a list of captures', () => {
    const captures = [{ orderId: '113-1', html: '<html></html>', status: 200 }];
    expect(invoiceCapturesSchema.parse(captures)).toEqual([
      { orderId: '113-1', html: '<html></html>' },
    ]);
  });

  it('rejects a capture without html', () => {
    expect(invoiceCapturesSchema.safeParse([{ orderId: '113-1' }]).success).toBe(false);
  });
});
