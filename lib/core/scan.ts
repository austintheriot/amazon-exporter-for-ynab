import type { AmazonCharge, AmazonOrder, DebugCapture, ScanCounts } from './amazon';
import {
  buildMemo,
  buildRefundMemo,
  buildSplits,
  findOriginalTransaction,
  isAmazonPayee,
  matchCharges,
  matchRefunds,
  type ChargeMatch,
  type MatchProposal,
} from './matcher';
import type { ScanDebug, Settings } from './state';
import type { YnabTransaction } from './ynab';

export const RECENT_SCAN_DAYS = 90;
export const YNAB_LOOKBACK_DAYS = 60;
export const MAX_DEBUG_CAPTURES = 3;

const DAY_MS = 86_400_000;
const DIGITAL_ORDER_PREFIX = 'D0';

function daysBefore(date: string, days: number): string {
  return new Date(new Date(`${date}T12:00:00Z`).getTime() - days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export function scanWindow(
  settings: Settings,
  today: string,
): { sinceDate: string; untilDate: string | undefined; ynabSinceDate: string } {
  const sinceDate = settings.year
    ? `${String(settings.year)}-01-01`
    : daysBefore(today, RECENT_SCAN_DAYS);
  const untilDate = settings.year ? `${String(settings.year)}-12-31` : undefined;
  // Look back past the scan window so a refund's original purchase (and its
  // category) is in range even when the return came weeks later.
  return { sinceDate, untilDate, ynabSinceDate: daysBefore(sinceDate, YNAB_LOOKBACK_DAYS) };
}

export interface ScanMatches {
  charges: ChargeMatch[];
  refunds: ChargeMatch[];
  digitalSkipped: number;
  orderIdsToFetch: string[];
  scanDebug: ScanDebug;
}

function isPhysical(match: ChargeMatch): boolean {
  return !match.charge.orderId.startsWith(DIGITAL_ORDER_PREFIX);
}

export function matchScan(input: {
  charges: AmazonCharge[];
  credits: AmazonCharge[];
  transactions: YnabTransaction[];
  maxDays: number;
}): ScanMatches {
  const { charges, credits, transactions, maxDays } = input;
  const scanDebug: ScanDebug = {
    charges,
    credits,
    candidates: transactions
      .filter((transaction) => isAmazonPayee(transaction.payee_name))
      .map((transaction) => ({
        id: transaction.id,
        date: transaction.date,
        amount: transaction.amount,
        payee: transaction.payee_name ?? '',
        hasMemo: !!transaction.memo?.trim(),
      })),
  };

  const chargeMatches = matchCharges(charges, transactions, maxDays);
  const refundMatches = matchRefunds(credits, transactions, maxDays);
  const physicalCharges = chargeMatches.filter(isPhysical);
  const physicalRefunds = refundMatches.filter(isPhysical);

  return {
    charges: physicalCharges,
    refunds: physicalRefunds,
    digitalSkipped:
      chargeMatches.length - physicalCharges.length + (refundMatches.length - physicalRefunds.length),
    orderIdsToFetch: [...physicalCharges, ...physicalRefunds].map((match) => match.charge.orderId),
    scanDebug,
  };
}

function itemNames(order: AmazonOrder): string[] {
  return order.items.map((item) => item.name);
}

function chargeProposal(match: ChargeMatch, order: AmazonOrder): MatchProposal {
  const { charge, txn } = match;
  const alreadySplit = (txn.subtransactions?.length ?? 0) > 0;
  return {
    kind: 'charge',
    orderId: charge.orderId,
    orderDate: charge.date,
    orderTotal: charge.amount,
    items: itemNames(order),
    txnId: txn.id,
    txnDate: txn.date,
    txnPayee: txn.payee_name ?? '',
    memo: buildMemo(itemNames(order), charge.orderId),
    splits: alreadySplit ? undefined : (buildSplits(order, charge.amount) ?? undefined),
  };
}

function refundProposal(
  match: ChargeMatch,
  order: AmazonOrder,
  transactions: YnabTransaction[],
  maxDays: number,
): MatchProposal {
  const { charge: credit, txn } = match;
  const original = findOriginalTransaction(order, transactions, maxDays);
  return {
    kind: 'refund',
    orderId: credit.orderId,
    orderDate: credit.date,
    orderTotal: credit.amount,
    items: itemNames(order),
    txnId: txn.id,
    txnDate: txn.date,
    txnPayee: txn.payee_name ?? '',
    memo: buildRefundMemo(order, credit.amount, original?.category_name ?? null),
  };
}

export function buildScanResult(input: {
  matches: ScanMatches;
  orders: Map<string, AmazonOrder>;
  transactions: YnabTransaction[];
  maxDays: number;
  captures: DebugCapture[];
}): {
  proposals: MatchProposal[];
  counts: ScanCounts;
  message: string;
  debugCaptures: DebugCapture[];
} {
  const { matches, orders, transactions, maxDays, captures } = input;
  const proposals: MatchProposal[] = [];
  for (const match of matches.charges) {
    const order = orders.get(match.charge.orderId);
    if (order) proposals.push(chargeProposal(match, order));
  }
  for (const match of matches.refunds) {
    const order = orders.get(match.charge.orderId);
    if (order) proposals.push(refundProposal(match, order, transactions, maxDays));
  }

  const chargeCount = matches.scanDebug.charges.length;
  return {
    proposals,
    counts: {
      charges: chargeCount,
      credits: matches.scanDebug.credits.length,
      digitalSkipped: matches.digitalSkipped,
      invoicesUnparsed: matches.charges.length + matches.refunds.length - proposals.length,
    },
    message: `Found ${String(chargeCount)} charges, matched ${String(proposals.length)} transactions.`,
    debugCaptures: captures.slice(0, MAX_DEBUG_CAPTURES),
  };
}
