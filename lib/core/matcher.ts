import type { AmazonCharge, AmazonItem, AmazonOrder } from './amazon';
import {
  dollarsToOutflowMilliunits,
  type YnabSplit,
  type YnabTransaction,
} from './ynab';

const MEMO_MAX_LENGTH = 480;
const AMAZON_PAYEE_PATTERN = /amazon|amzn/i;
/** Max sales tax assumed when attributing a partial refund to one item */
const MAX_TAX_RATE = 0.12;

export function isAmazonPayee(name: string | null | undefined): boolean {
  return AMAZON_PAYEE_PATTERN.test(name ?? '');
}

export interface ChargeMatch {
  charge: AmazonCharge;
  txn: YnabTransaction;
}

/** Append the order ID and cap at YNAB's memo length, truncating the body
 * (never the order ID) when over. */
function withOrderId(body: string, orderId: string): string {
  const suffix = ` [${orderId}]`;
  const max = MEMO_MAX_LENGTH - suffix.length;
  if (body.length > max) {
    body = body.slice(0, max - 1) + '…';
  }
  return body + suffix;
}

export function buildMemo(items: string[], orderId: string): string {
  return withOrderId(items.join(', '), orderId);
}

/** Memo for a refund credit. Names the returned item when the refund covers
 * the whole order or the amount singles out one item (price plus up to
 * MAX_TAX_RATE tax); otherwise lists the order's items so the category is
 * still recoverable. */
export function buildRefundMemo(
  order: AmazonOrder,
  refundAmount: number,
  originalCategory: string | null,
): string {
  const names = order.items.map((i) => i.name);
  let body: string;
  if (Math.abs(refundAmount - order.total) <= 0.01) {
    body = `Refund: ${names.join(', ')}`;
  } else {
    const priced = order.items.filter(
      (i) =>
        i.price !== null &&
        refundAmount >= i.price - 0.01 &&
        refundAmount <= i.price * (1 + MAX_TAX_RATE) + 0.02,
    );
    const [onlyPriced] = priced;
    body =
      priced.length === 1 && onlyPriced
        ? `Refund: ${onlyPriced.name}`
        : `Partial refund of $${order.total.toFixed(2)} order: ${names.join(', ')}`;
  }
  if (originalCategory) {
    body += ` → was: ${originalCategory}`;
  }
  return withOrderId(body, order.id);
}

function hasPrice(item: AmazonItem): item is AmazonItem & { price: number } {
  return item.price !== null;
}

/** Per-item splits for a charge, plus a tax/shipping remainder. Only when the
 * charge covers the whole order and every item has a parsed price; returns
 * null otherwise (split shipments and unpriced invoices stay memo-only). */
export function buildSplits(
  order: AmazonOrder,
  chargeAmount: number,
): YnabSplit[] | null {
  if (order.items.length < 2) return null;
  if (Math.abs(chargeAmount - order.total) > 0.01) return null;
  const pricedItems = order.items.filter(hasPrice);
  if (pricedItems.length !== order.items.length) return null;

  const splits: YnabSplit[] = pricedItems.map((item) => ({
    amount: dollarsToOutflowMilliunits(item.price),
    memo: item.name.length > MEMO_MAX_LENGTH ? item.name.slice(0, MEMO_MAX_LENGTH) : item.name,
  }));
  const remainder =
    dollarsToOutflowMilliunits(chargeAmount) -
    splits.reduce((sum, s) => sum + s.amount, 0);
  if (remainder > 0) return null; // item prices exceed the charge: discount/promo, don't guess
  if (remainder < 0) splits.push({ amount: remainder, memo: 'Tax & shipping' });
  return splits;
}

function daysBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;
}

export interface MatchCandidate {
  id: string;
  date: string;
  amount: number;
  payee: string;
  hasMemo: boolean;
}

export function toMatchCandidate(transaction: YnabTransaction): MatchCandidate {
  return {
    id: transaction.id,
    date: transaction.date,
    amount: transaction.amount,
    payee: transaction.payee_name ?? '',
    hasMemo: !!transaction.memo?.trim(),
  };
}

export function isEligible(candidate: MatchCandidate, sign: -1 | 1): boolean {
  return (
    Math.sign(candidate.amount) === sign && isAmazonPayee(candidate.payee) && !candidate.hasMemo
  );
}

export function withinWindow(entryDate: string, candidateDate: string, maxDaysAfter: number): boolean {
  const diff = daysBetween(entryDate, candidateDate);
  return diff >= -1 && diff <= maxDaysAfter;
}

/**
 * One-to-one matching of Amazon amounts to YNAB transactions by exact amount
 * within a date window. Transactions that already have a memo are left
 * alone. Ambiguity resolves to the closest date; each transaction is claimed
 * once. `sign` selects outflows (-1, charges) or inflows (1, refunds).
 */
export function claimMatches(
  entries: AmazonCharge[],
  candidates: MatchCandidate[],
  maxDaysAfter: number,
  sign: -1 | 1,
): { charge: AmazonCharge; candidateId: string }[] {
  const eligible = candidates.filter((candidate) => isEligible(candidate, sign));
  const claimed = new Set<string>();
  const matches: { charge: AmazonCharge; candidateId: string }[] = [];

  for (const entry of [...entries].sort((a, b) =>
    a.date.localeCompare(b.date),
  )) {
    const wantAmount = sign * Math.round(entry.amount * 1000);
    const found = eligible
      .filter(
        (candidate) =>
          !claimed.has(candidate.id) &&
          candidate.amount === wantAmount &&
          withinWindow(entry.date, candidate.date, maxDaysAfter),
      )
      .sort(
        (a, b) =>
          Math.abs(daysBetween(entry.date, a.date)) -
          Math.abs(daysBetween(entry.date, b.date)),
      );

    const best = found[0];
    if (!best) continue;
    claimed.add(best.id);
    matches.push({ charge: entry, candidateId: best.id });
  }

  return matches;
}

function matchByAmount(
  entries: AmazonCharge[],
  transactions: YnabTransaction[],
  maxDaysAfter: number,
  sign: -1 | 1,
): ChargeMatch[] {
  const byId = new Map(
    [...transactions].reverse().map((transaction) => [transaction.id, transaction]),
  );
  return claimMatches(entries, transactions.map(toMatchCandidate), maxDaysAfter, sign).flatMap(
    ({ charge, candidateId }) => {
      const txn = byId.get(candidateId);
      return txn ? [{ charge, txn }] : [];
    },
  );
}

export function matchCharges(
  charges: AmazonCharge[],
  transactions: YnabTransaction[],
  maxDaysAfterCharge = 7,
): ChargeMatch[] {
  return matchByAmount(charges, transactions, maxDaysAfterCharge, -1);
}

export function matchRefunds(
  credits: AmazonCharge[],
  transactions: YnabTransaction[],
  maxDaysAfterCredit = 7,
): ChargeMatch[] {
  return matchByAmount(credits, transactions, maxDaysAfterCredit, 1);
}

/** Find the YNAB transaction for the original purchase of an order, to
 * recover its category for a refund memo. Prefers a memo containing the
 * order ID (memos we write include it); falls back to exact order-total
 * amount near the order date. */
export function findOriginalTransaction(
  order: AmazonOrder,
  transactions: YnabTransaction[],
  maxDaysAfterCharge = 7,
): YnabTransaction | null {
  const outflows = transactions.filter((t) => t.amount < 0);
  const byMemo = outflows.find((t) => t.memo?.includes(order.id));
  if (byMemo) return byMemo;

  const wantAmount = dollarsToOutflowMilliunits(order.total);
  const byAmount = outflows
    .filter((t) => {
      if (t.amount !== wantAmount) return false;
      if (!isAmazonPayee(t.payee_name)) return false;
      const diff = daysBetween(order.date, t.date);
      return diff >= -1 && diff <= maxDaysAfterCharge;
    })
    .sort(
      (a, b) =>
        Math.abs(daysBetween(order.date, a.date)) -
        Math.abs(daysBetween(order.date, b.date)),
    );
  return byAmount[0] ?? null;
}
