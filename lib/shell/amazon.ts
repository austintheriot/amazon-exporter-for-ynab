import { load } from 'cheerio/slim';
import {
  buildNextPageBody,
  buildDebugCapture,
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
import { countOf } from '../core/copy';
import { AmazonSessionError } from '../core/errors';
import { decideAfterPage, finalizeCharges, oldestDate } from '../core/paging';

const FETCH_TIMEOUT_MS = 10_000;
const DETAIL_CONCURRENCY = 4;

interface FetchedPage {
  text: string;
  finalUrl: string;
  status: number;
}

async function fetchPage(
  url: string,
  init?: RequestInit,
  cancel?: AbortSignal,
): Promise<FetchedPage> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      credentials: 'include',
      signal: cancel ? AbortSignal.any([controller.signal, cancel]) : controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      throw new AmazonSessionError('Amazon session expired');
    }
    if (res.status !== 200) {
      throw new Error(`Amazon returned status ${String(res.status)}`);
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
  untilDate?: string | undefined;
  limit: number;
  onProgress?: (message: string) => void;
  signal?: AbortSignal | undefined;
}

export async function fetchAmazonCharges({
  sinceDate,
  untilDate,
  limit,
  onProgress,
  signal,
}: FetchChargesOptions): Promise<{
  charges: AmazonCharge[];
  credits: AmazonCharge[];
  captures: DebugCapture[];
}> {
  const all: AmazonCharge[] = [];
  const allCredits: AmazonCharge[] = [];
  const captures: DebugCapture[] = [];
  let postBody: string | null = null;

  for (let page = 1; ; page++) {
    onProgress?.(`Reading Amazon charges, page ${String(page)}…`);
    const fetched = await fetchPage(
      TRANSACTIONS_URL,
      postBody === null
        ? undefined
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: postBody,
          },
      signal,
    );
    const $ = load(fetched.text);
    if (isSignInPage($)) {
      throw new AmazonSessionError('Sign in to Amazon required');
    }

    const parsed = parseTransactionsPage($);
    const decision = decideAfterPage({
      page,
      pageCharges: parsed.charges.length,
      pageCredits: parsed.credits.length,
      oldestDateOnPage: oldestDate([...parsed.charges, ...parsed.credits]),
      chargesSoFar: all.length + parsed.charges.length,
      sinceDate,
      limit,
      nextPageBody: buildNextPageBody($),
      maxPages: MAX_TRANSACTION_PAGES,
    });
    if (decision.kind === 'stop' && decision.reason === 'empty-first-page') {
      captures.push(
        buildDebugCapture({
          source: { kind: 'transactions-page' },
          finalUrl: fetched.finalUrl,
          status: fetched.status,
          html: fetched.text,
        }),
      );
      break;
    }
    all.push(...parsed.charges);
    allCredits.push(...parsed.credits);
    if (decision.kind === 'stop') break;
    postBody = decision.body;
  }

  const { charges, credits } = finalizeCharges(all, allCredits, {
    sinceDate,
    untilDate,
    limit,
  });
  return { charges, credits, captures };
}

// --- Order invoice (item names for the memo) ---

async function fetchInvoice(
  orderId: string,
  signal?: AbortSignal,
): Promise<{ order: AmazonOrder | null; capture: DebugCapture | null }> {
  const requestedUrl = `${ORDER_DETAILS_URL}?orderID=${orderId}`;
  const page = await fetchPage(requestedUrl, undefined, signal);
  const $ = load(page.text);
  const order = isOrderNotFoundPage($) ? null : parseInvoice(page.text, orderId);
  const capture: DebugCapture | null = order
    ? null
    : buildDebugCapture({
        source: { kind: 'invoice', orderId, requestedUrl },
        finalUrl: page.finalUrl,
        status: page.status,
        html: page.text,
      });
  return { order, capture };
}

async function mapWithConcurrency<T, R>(
  inputs: T[],
  limit: number,
  fn: (input: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(inputs.length);
  const queue = inputs.entries();
  const workers = Array.from(
    { length: Math.min(limit, inputs.length) },
    async () => {
      for (const [i, input] of queue) {
        results[i] = await fn(input);
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
  signal?: AbortSignal,
): Promise<{ orders: Map<string, AmazonOrder>; captures: DebugCapture[] }> {
  const unique = [...new Set(orderIds)];
  onProgress?.(`Reading ${countOf(unique.length, 'Amazon order', 'Amazon orders')}…`);
  const results = await mapWithConcurrency(unique, DETAIL_CONCURRENCY, (id) =>
    fetchInvoice(id, signal).catch(() => ({ order: null, capture: null })),
  );
  const orders = new Map<string, AmazonOrder>();
  const captures: DebugCapture[] = [];
  for (const r of results) {
    if (r.order) orders.set(r.order.id, r.order);
    else if (r.capture) captures.push(r.capture);
  }
  return { orders, captures };
}
