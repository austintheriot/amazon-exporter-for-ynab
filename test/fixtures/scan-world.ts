import { fakeBrowser } from 'wxt/testing/fake-browser';
import { vi } from 'vitest';
import type { Settings, SyncState } from '@/lib/core/state';
import type { YnabTransaction } from '@/lib/core/ynab';

const TRANSACTIONS_URL = 'https://www.amazon.com/cpe/yourpayments/transactions';
const INVOICE_URL = 'https://www.amazon.com/gp/css/summary/print.html';
const YNAB_BASE_URL = 'https://api.ynab.com/v1';
const FAR_FUTURE_MS = 4_102_444_800_000;

export interface TransactionRow {
  date: string;
  amount: string;
  orderId: string;
}

export function buildTransactionsPage(rows: TransactionRow[]): string {
  let currentDate = '';
  const markup = rows
    .map((row) => {
      const dateMarkup =
        row.date === currentDate
          ? ''
          : `<div class="apx-transaction-date-container"><span>${row.date}</span></div>`;
      currentDate = row.date;
      return `${dateMarkup}
  <div class="apx-transactions-line-item-component-container">
    <div class="a-row"><span>Prime Visa ****1234</span><span>${row.amount}</span></div>
    <div class="a-row"><a href="#">Order #${row.orderId}</a></div>
  </div>`;
    })
    .join('\n');
  return `<html><body>${markup}</body></html>`;
}

export interface InvoiceItem {
  name: string;
  price: number;
}

export function buildLegacyInvoice(
  placed: string,
  items: InvoiceItem[],
  total: number,
): string {
  const rows = items
    .map(
      (item) =>
        `<tr><td><i>${item.name}</i></td><td>$${item.price.toFixed(2)}</td></tr>`,
    )
    .join('');
  return `<html><body><b>Order Placed:</b> ${placed}<br/><table>${rows}</table><table><tr><td><b>Grand Total:</b></td><td><b>$${total.toFixed(2)}</b></td></tr></table></body></html>`;
}

export function ynabTransaction(
  fields: Pick<YnabTransaction, 'id' | 'date' | 'amount'> &
    Partial<YnabTransaction>,
): YnabTransaction {
  return {
    payee_name: 'Amazon.com',
    memo: null,
    cleared: 'cleared',
    approved: true,
    category_name: null,
    ...fields,
  };
}

export interface HttpReply {
  status?: number;
  body: string;
}

export interface ScanWorldOptions {
  settings?: Partial<Settings>;
  hasToken?: boolean;
  transactionPages: string[];
  invoices?: Record<string, string | HttpReply>;
  ynab?: { status?: number; transactions: YnabTransaction[] };
  putStatuses?: Record<string, number>;
}

export interface YnabWrite {
  txnId: string;
  body: unknown;
}

export interface ScanWorld {
  stateWrites: SyncState[];
  requests: string[];
  ynabWrites: YnabWrite[];
  readState(): Promise<SyncState>;
  readToken(): Promise<unknown>;
}

function toReply(reply: string | HttpReply): HttpReply {
  return typeof reply === 'string' ? { body: reply } : reply;
}

export async function createScanWorld(
  options: ScanWorldOptions,
): Promise<ScanWorld> {
  const settings: Settings = {
    budgetId: 'budget-1',
    budgetName: 'Main budget',
    year: null,
    maxDays: 7,
    orderLimit: 50,
    ...options.settings,
  };
  await fakeBrowser.storage.local.set({ settings });
  if (options.hasToken ?? true) {
    await fakeBrowser.storage.local.set({
      oauthToken: { accessToken: 'tok', expiresAt: FAR_FUTURE_MS },
    });
  }

  const stateWrites: SyncState[] = [];
  const requests: string[] = [];
  const ynabWrites: YnabWrite[] = [];

  const originalSet = fakeBrowser.storage.local.set.bind(
    fakeBrowser.storage.local,
  );
  vi.spyOn(fakeBrowser.storage.local, 'set').mockImplementation(
    async (items) => {
      if ('syncState' in items) {
        stateWrites.push(structuredClone(items['syncState'] as SyncState));
      }
      return originalSet(items);
    },
  );

  let transactionsPageIndex = 0;
  const ynabTransactionsUrl = `${YNAB_BASE_URL}/budgets/${settings.budgetId}/transactions`;
  const ynabPutPrefix = `${ynabTransactionsUrl}/`;

  vi.stubGlobal(
    'fetch',
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      requests.push(url);

      if (url === TRANSACTIONS_URL) {
        const page = options.transactionPages[transactionsPageIndex];
        transactionsPageIndex++;
        if (page === undefined) throw new Error(`No fake page for ${method} ${url}`);
        return new Response(page, { status: 200 });
      }
      if (url.startsWith(`${INVOICE_URL}?orderID=`)) {
        const orderId = url.slice(`${INVOICE_URL}?orderID=`.length);
        const reply = options.invoices?.[orderId];
        if (reply === undefined) throw new Error(`No fake invoice for ${orderId}`);
        const { status = 200, body } = toReply(reply);
        return new Response(body, { status });
      }
      if (method === 'GET' && url.startsWith(`${ynabTransactionsUrl}?since_date=`)) {
        const ynab = options.ynab;
        if (!ynab) throw new Error(`No fake YNAB data for ${url}`);
        if (ynab.status && ynab.status !== 200) {
          return new Response('ynab failure', { status: ynab.status });
        }
        return new Response(
          JSON.stringify({ data: { transactions: ynab.transactions } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (method === 'PUT' && url.startsWith(ynabPutPrefix)) {
        const txnId = url.slice(ynabPutPrefix.length);
        ynabWrites.push({ txnId, body: JSON.parse(String(init?.body)) });
        const status = options.putStatuses?.[txnId] ?? 200;
        return new Response(JSON.stringify({ data: {} }), { status });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    },
  );

  return {
    stateWrites,
    requests,
    ynabWrites,
    async readState() {
      const stored = await fakeBrowser.storage.local.get('syncState');
      return stored['syncState'] as SyncState;
    },
    async readToken() {
      const stored = await fakeBrowser.storage.local.get('oauthToken');
      return stored['oauthToken'];
    },
  };
}
