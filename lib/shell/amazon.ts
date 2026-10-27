import { load } from 'cheerio/slim';
import {
  buildNextPageBody,
  DEBUG_HTML_MAX,
  isOrderNotFoundPage,
  isSignInPage,
  MAX_TRANSACTION_PAGES,
  ORDER_DETAILS_URL,
  parseInvoice,
  parseTransactionsPage,
  TRANSACTIONS_URL,
  type AmazonCharge,
  type AmazonOrder,
  type DebugCapture,
} from '../core/amazon';
import { AmazonSessionError } from '../core/errors';

const FETCH_TIMEOUT_MS = 10_000;
const DETAIL_CONCURRENCY = 4;

interface FetchedPage {
  text: string;
  finalUrl: string;
  status: number;
}

async function fetchPage(url: string, init?: RequestInit): Promise<FetchedPage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      credentials: 'include',
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      throw new AmazonSessionError('Amazon session expired');
    }
    if (res.status !== 200) {
      throw new Error(`Amazon returned status ${res.status}`);
    }
    return { text: await res.text(), finalUrl: res.url, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

export interface FetchChargesOptions {
  /** Stop paginating once charges are older than this ISO date */
  sinceDate: string;
  /** Only keep charges on or before this ISO date */
  untilDate?: string;
  limit: number;
  onProgress?: (message: string) => void;
}

export async function fetchAmazonCharges({
  sinceDate,
  untilDate,
  limit,
  onProgress,
}: FetchChargesOptions): Promise<{
  charges: AmazonCharge[];
  credits: AmazonCharge[];
  captures: DebugCapture[];
}> {
  const all: AmazonCharge[] = [];
  const allCredits: AmazonCharge[] = [];
  const captures: DebugCapture[] = [];
  let postBody: string | null = null;

  for (let page = 1; page <= MAX_TRANSACTION_PAGES; page++) {
    onProgress?.(`Fetching Amazon transactions page ${page}…`);
    const fetched = await fetchPage(
      TRANSACTIONS_URL,
      postBody === null
        ? undefined
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: postBody,
          },
    );
    const $ = load(fetched.text);
    if (isSignInPage($)) {
      throw new AmazonSessionError('Sign in to Amazon required');
    }

    const parsed = parseTransactionsPage($);
    if (parsed.charges.length === 0 && parsed.credits.length === 0 && page === 1) {
      captures.push({
        orderId: '(transactions page)',
        requestedUrl: TRANSACTIONS_URL,
        finalUrl: fetched.finalUrl,
        status: fetched.status,
        html: fetched.text.slice(0, DEBUG_HTML_MAX),
      });
      break;
    }
    all.push(...parsed.charges);
    allCredits.push(...parsed.credits);

    const pastCutoff = [...parsed.charges, ...parsed.credits].some(
      (c) => c.date < sinceDate,
    );
    if (pastCutoff || all.length >= limit) break;
    postBody = buildNextPageBody($);
    if (!postBody) break;
  }

  const inWindow = (c: AmazonCharge) =>
    c.date >= sinceDate && (!untilDate || c.date <= untilDate);
  const charges = all.filter(inWindow).slice(0, limit);
  const credits = allCredits.filter(inWindow);
  return { charges, credits, captures };
}

// --- Order invoice (item names for the memo) ---

async function fetchInvoice(
  orderId: string,
): Promise<{ order: AmazonOrder | null; capture: DebugCapture | null }> {
  const requestedUrl = `${ORDER_DETAILS_URL}?orderID=${orderId}`;
  const page = await fetchPage(requestedUrl);
  const $ = load(page.text);
  const order = isOrderNotFoundPage($) ? null : parseInvoice(page.text, orderId);
  const capture: DebugCapture | null = order
    ? null
    : {
        orderId,
        requestedUrl,
        finalUrl: page.finalUrl,
        status: page.status,
        html: page.text.slice(0, DEBUG_HTML_MAX),
      };
  return { order, capture };
}

async function mapWithConcurrency<T, R>(
  inputs: T[],
  limit: number,
  fn: (input: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(inputs.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, inputs.length) },
    async () => {
      while (next < inputs.length) {
        const i = next++;
        results[i] = await fn(inputs[i]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/** Fetch and parse invoices for the given order IDs. Returns a map of
 * orderId → order (absent when unparseable) plus debug captures for
 * failures. */
export async function fetchOrderDetails(
  orderIds: string[],
  onProgress?: (message: string) => void,
): Promise<{ orders: Map<string, AmazonOrder>; captures: DebugCapture[] }> {
  const unique = [...new Set(orderIds)];
  onProgress?.(`Fetching ${unique.length} order invoices…`);
  const results = await mapWithConcurrency(unique, DETAIL_CONCURRENCY, (id) =>
    fetchInvoice(id).catch(() => ({ order: null, capture: null })),
  );
  const orders = new Map<string, AmazonOrder>();
  const captures: DebugCapture[] = [];
  for (const r of results) {
    if (r.order) orders.set(r.order.id, r.order);
    else if (r.capture) captures.push(r.capture);
  }
  return { orders, captures };
}
