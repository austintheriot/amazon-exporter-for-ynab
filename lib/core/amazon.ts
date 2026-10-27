import { load, type CheerioAPI } from 'cheerio/slim';

export const TRANSACTIONS_URL =
  'https://www.amazon.com/cpe/yourpayments/transactions';
export const ORDER_DETAILS_URL =
  'https://www.amazon.com/gp/css/summary/print.html';
export const MAX_TRANSACTION_PAGES = 25;
export const DEBUG_HTML_MAX = 500_000;

export const AMAZON_ORIGINS = [
  'https://www.amazon.com/*',
  'https://amazon.com/*',
];
export const AMAZON_LOGIN_URL = 'https://www.amazon.com/orders';

/** A card charge from the Your Payments → Transactions page. One order can
 * produce several charges (split shipments); amounts are what actually hit
 * the card. */
export interface AmazonCharge {
  orderId: string;
  /** ISO date (YYYY-MM-DD) the charge posted */
  date: string;
  /** Dollars, positive = money out */
  amount: number;
  paymentMethod: string;
}

export interface AmazonItem {
  name: string;
  /** Item price in dollars when the invoice shows one */
  price: number | null;
}

export interface AmazonOrder {
  id: string;
  date: string;
  total: number;
  items: AmazonItem[];
}

export interface ScanCounts {
  /** Card charges found on the transactions page */
  charges: number;
  /** Refund credits found on the transactions page */
  credits: number;
  /** Matched charges dropped because the order is digital */
  digitalSkipped: number;
  /** Matched charges dropped because the invoice could not be parsed */
  invoicesUnparsed: number;
}

/** Raw evidence of a page that could not be parsed, for debugging. */
export interface DebugCapture {
  orderId: string;
  requestedUrl: string;
  finalUrl: string;
  status: number;
  html: string;
}

const LONG_DATE_PATTERN = /([A-Za-z]+ \d{1,2}, \d{4})/;

function toIsoDate(longDate: string): string | null {
  const parsed = new Date(`${longDate} 12:00:00 UTC`);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

export function isSignInPage($: CheerioAPI): boolean {
  return $('h1:contains("Sign in")').length > 0;
}

export function isOrderNotFoundPage($: CheerioAPI): boolean {
  return $('h2:contains("We\'re sorry!")').length > 0;
}

// --- Transactions page ---

/** Amazon serves two Transactions pages, chosen per account. The classic one
 * renders rows as markup; the redesigned one embeds them as JSON in
 * __NEXT_DATA__ and pages client-side, so only its first page is readable. */
export function parseTransactionsPage($: CheerioAPI): {
  charges: AmazonCharge[];
  credits: AmazonCharge[];
} {
  return $('.apx-transactions-line-item-component-container').length > 0
    ? parseTransactionsMarkup($)
    : parseTransactionsJson($('script#__NEXT_DATA__').first().text() || '{}');
}

interface NextDataJson {
  props?: {
    pageProps?: {
      state?: {
        transactionResponseState?: {
          visibleTransactionResponse?: { transactionList?: TransactionJson[] };
        };
      };
    };
  };
}

interface TransactionJson {
  formattedAmount?: string;
  formattedDate?: string;
  orderData?: { orderDisplayString?: string }[];
  statusInfo?: { amountDetailsStatusType?: string };
  paymentMethodDisplayStringData?: {
    paymentMethodName?: string;
    paymentMethodNumber?: { lastDigits?: string };
  };
}

function parseTransactionsJson(nextData: string): {
  charges: AmazonCharge[];
  credits: AmazonCharge[];
} {
  const charges: AmazonCharge[] = [];
  const credits: AmazonCharge[] = [];
  const parsed = JSON.parse(nextData) as NextDataJson | null;
  const list =
    parsed?.props?.pageProps?.state?.transactionResponseState
      ?.visibleTransactionResponse?.transactionList ?? [];
  for (const t of list) {
    const amount = t.formattedAmount?.match(/\$([\d,]+\.\d{2})/)?.[1];
    const dateText = t.formattedDate?.match(LONG_DATE_PATTERN)?.[1];
    const date = dateText ? toIsoDate(dateText) : null;
    const orderId = t.orderData?.[0]?.orderDisplayString?.match(
      /((?:D\d{2}|\d{3})-\d{7}-\d{7})/,
    )?.[1];
    if (!amount || !date || !orderId) continue;
    const card = t.paymentMethodDisplayStringData;
    const digits = card?.paymentMethodNumber?.lastDigits;
    (t.statusInfo?.amountDetailsStatusType === 'Refund' ? credits : charges).push({
      orderId,
      date,
      amount: parseFloat(amount.replace(/,/g, '')),
      paymentMethod: digits ? `${card.paymentMethodName ?? 'Card'} ****${digits}` : '',
    });
  }
  return { charges, credits };
}

function parseTransactionsMarkup($: CheerioAPI): {
  charges: AmazonCharge[];
  credits: AmazonCharge[];
} {
  const charges: AmazonCharge[] = [];
  const credits: AmazonCharge[] = [];
  let currentDate: string | null = null;

  $(
    '.apx-transaction-date-container, .apx-transactions-line-item-component-container',
  ).each((_, el) => {
    const $el = $(el);
    if ($el.hasClass('apx-transaction-date-container')) {
      const dateText = LONG_DATE_PATTERN.exec($el.text())?.[1];
      if (dateText) currentDate = toIsoDate(dateText) ?? currentDate;
      return;
    }

    const text = $el.text().replace(/\s+/g, ' ');
    const amountMatch = /(-?)\s*\$([\d,]+\.\d{2})/.exec(text);
    const amountText = amountMatch?.[2];
    // Amazon order IDs are 3-7-7 digit groups ("D01-…" for digital orders).
    const orderId =
      /Order\s+#\s*((?:D\d{2}|\d{3})-\d{7}-\d{7})/i.exec(text)?.[1] ??
      $el
        .find('a[href*="orderID="]')
        .attr('href')
        ?.match(/orderID=((?:D\d{2}|\d{3})-\d{7}-\d{7})/)?.[1];
    if (!currentDate || !amountText || !orderId) return;
    (amountMatch[1] === '-' ? charges : credits).push({
      orderId,
      date: currentDate,
      amount: parseFloat(amountText.replace(/,/g, '')),
      paymentMethod: /([A-Za-z][A-Za-z ]*\*{3,4}\s?\d{4})/.exec(text)?.[1] ?? '',
    });
  });

  return { charges, credits };
}

/** Serialize the widget form that drives the transaction page's "Next page"
 * button into a POST body. Returns null on the last page. */
export function buildNextPageBody($: CheerioAPI): string | null {
  const eventInput = $(
    'input[name^="ppw-widgetEvent:DefaultNextPageNavigationEvent"]',
  ).first();
  if (eventInput.length === 0) return null;
  const eventName = eventInput.attr('name');
  if (eventName === undefined) return null;
  const form = eventInput.closest('form');
  if (form.length === 0) return null;

  const params = new URLSearchParams();
  form.find('input[type="hidden"]').each((_, el) => {
    const name = $(el).attr('name');
    if (name) params.append(name, $(el).attr('value') ?? '');
  });
  params.append(eventName, eventInput.attr('value') ?? '');
  return params.toString();
}

// --- Order invoice (item names for the memo) ---

/** Parse the invoice / Order Details page into a structured order. Handles
 * both the modern data-component page and the legacy print invoice. Returns
 * null when any required field can't be confidently extracted. */
export function parseInvoice(html: string, orderId: string): AmazonOrder | null {
  const $ = load(html);
  const text = $('body').text().replace(/\s+/g, ' ');

  const dateText =
    LONG_DATE_PATTERN.exec($('[data-component="orderDate"]').first().text())?.[1] ??
    new RegExp(`Order [Pp]laced:?\\s*${LONG_DATE_PATTERN.source}`).exec(text)?.[1];
  if (!dateText) return null;
  const date = toIsoDate(dateText);
  if (!date) return null;

  const totalText = /Grand Total:\s*\$([\d,]+\.\d{2})/.exec(text)?.[1];
  if (!totalText) return null;
  const total = parseFloat(totalText.replace(/,/g, ''));
  if (!Number.isFinite(total) || total < 0) return null;

  const items: AmazonItem[] = [];
  const seen = new Set<string>();
  const pushItem = (raw: string, price: number | null = null) => {
    const name = raw.replace(/\s+/g, ' ').trim();
    if (name.length > 2 && !seen.has(name)) {
      seen.add(name);
      items.push({ name, price });
    }
  };
  const parsePrice = (raw: string): number | null => {
    const priceText = /\$([\d,]+\.\d{2})/.exec(raw)?.[1];
    return priceText ? parseFloat(priceText.replace(/,/g, '')) : null;
  };
  // Modern page: one data-component="itemTitle" per line item; unitPrice
  // components pair up by index when both lists are the same length.
  const titles = $('[data-component="itemTitle"]');
  const prices = $('[data-component="unitPrice"]');
  titles.each((i, el) => {
    pushItem(
      $(el).text(),
      titles.length === prices.length ? parsePrice($(prices[i]).text()) : null,
    );
  });
  // Legacy print page: italicized titles in the Items Ordered table, price in
  // the row's last cell.
  if (items.length === 0) {
    $('td i').each((_, el) => {
      pushItem(
        $(el).text(),
        parsePrice($(el).closest('tr').find('td').last().text()),
      );
    });
  }
  if (items.length === 0) {
    $('a[href*="/gp/product/"], a[href*="/dp/"]').each((_, el) => {
      pushItem($(el).text());
    });
  }
  if (items.length === 0) return null;

  return { id: orderId, date, total, items };
}
