import { AmazonSessionError, YnabAuthError } from '@/lib/core/errors';
import {
  buildMemo,
  buildRefundMemo,
  buildSplits,
  findOriginalTransaction,
  matchCharges,
  matchRefunds,
  type MatchProposal,
} from '@/lib/core/matcher';
import type { Message } from '@/lib/core/state';
import { fetchAmazonCharges, fetchOrderDetails } from '@/lib/shell/amazon';
import { disconnect, getAccessToken } from '@/lib/shell/oauth';
import { getSettings, getState, setState } from '@/lib/shell/storage';
import { getTransactions, updateTransactionMemo } from '@/lib/shell/ynab';

const RECONNECT_MESSAGE = 'YNAB session expired. Reconnect YNAB in the popup.';

function errorMessage(err: unknown): string {
  if (err instanceof AmazonSessionError) {
    return 'Not signed in to Amazon. Open amazon.com, sign in, then scan again.';
  }
  if (err instanceof YnabAuthError) {
    return RECONNECT_MESSAGE;
  }
  return err instanceof Error ? err.message : String(err);
}

export async function runScan(): Promise<void> {
  const settings = await getSettings();
  const accessToken = await getAccessToken();
  if (!accessToken || !settings.budgetId) {
    await setState({
      status: 'error',
      message: accessToken
        ? 'Pick a budget first.'
        : 'Connect YNAB in the popup first.',
    });
    return;
  }

  await setState({
    status: 'scanning',
    message: 'Starting scan…',
    proposals: [],
    counts: null,
    debugCaptures: [],
  });
  try {
    const onProgress = (message: string) => void setState({ message });
    const sinceDate = settings.year
      ? `${settings.year}-01-01`
      : new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
    const untilDate = settings.year ? `${settings.year}-12-31` : undefined;

    const { charges, credits, captures } = await fetchAmazonCharges({
      sinceDate,
      untilDate,
      limit: settings.orderLimit,
      onProgress,
    });

    await setState({ message: 'Fetching YNAB transactions…' });
    // Look back past the scan window so a refund's original purchase (and its
    // category) is in range even when the return came weeks later.
    const ynabSince = new Date(
      new Date(`${sinceDate}T12:00:00Z`).getTime() - 60 * 86_400_000,
    )
      .toISOString()
      .slice(0, 10);
    const transactions = await getTransactions(
      accessToken,
      settings.budgetId,
      ynabSince,
    );

    const scanDebug = {
      charges,
      credits,
      candidates: transactions
        .filter((t) => /amazon|amzn/i.test(t.payee_name ?? ''))
        .map((t) => ({
          id: t.id,
          date: t.date,
          amount: t.amount,
          payee: t.payee_name ?? '',
          hasMemo: !!t.memo?.trim(),
        })),
    };

    const matches = matchCharges(charges, transactions, settings.maxDays);
    const refundMatches = matchRefunds(credits, transactions, settings.maxDays);
    const nonDigital = matches.filter((m) => !m.charge.orderId.startsWith('D0'));
    const refundsNonDigital = refundMatches.filter(
      (m) => !m.charge.orderId.startsWith('D0'),
    );
    const digitalSkipped =
      matches.length - nonDigital.length +
      (refundMatches.length - refundsNonDigital.length);

    const { orders, captures: invoiceCaptures } = await fetchOrderDetails(
      [...nonDigital, ...refundsNonDigital].map((m) => m.charge.orderId),
      onProgress,
    );

    const proposals: MatchProposal[] = [];
    for (const { charge, txn } of nonDigital) {
      const order = orders.get(charge.orderId);
      if (!order) continue;
      const alreadySplit = (txn.subtransactions?.length ?? 0) > 0;
      proposals.push({
        kind: 'charge',
        orderId: charge.orderId,
        orderDate: charge.date,
        orderTotal: charge.amount,
        items: order.items.map((i) => i.name),
        txnId: txn.id,
        txnDate: txn.date,
        txnPayee: txn.payee_name ?? '',
        memo: buildMemo(order.items.map((i) => i.name), charge.orderId),
        splits: alreadySplit
          ? undefined
          : buildSplits(order, charge.amount) ?? undefined,
      });
    }
    for (const { charge: credit, txn } of refundsNonDigital) {
      const order = orders.get(credit.orderId);
      if (!order) continue;
      const original = findOriginalTransaction(
        order,
        transactions,
        settings.maxDays,
      );
      proposals.push({
        kind: 'refund',
        orderId: credit.orderId,
        orderDate: credit.date,
        orderTotal: credit.amount,
        items: order.items.map((i) => i.name),
        txnId: txn.id,
        txnDate: txn.date,
        txnPayee: txn.payee_name ?? '',
        memo: buildRefundMemo(order, credit.amount, original?.category_name ?? null),
      });
    }
    const invoicesUnparsed =
      nonDigital.length + refundsNonDigital.length - proposals.length;

    await setState({
      status: 'done',
      message: `Found ${charges.length} charges, matched ${proposals.length} transactions.`,
      proposals,
      counts: {
        charges: charges.length,
        credits: credits.length,
        digitalSkipped,
        invoicesUnparsed,
      },
      debugCaptures: [...captures, ...invoiceCaptures].slice(0, 3),
      scanDebug,
      lastScanAt: new Date().toISOString(),
    });
  } catch (err) {
    if (err instanceof YnabAuthError) await disconnect();
    await setState({ status: 'error', message: errorMessage(err) });
  }
}

export async function runApply(txnIds: string[]): Promise<void> {
  const settings = await getSettings();
  const accessToken = await getAccessToken();
  if (!accessToken) {
    await setState({ status: 'error', message: RECONNECT_MESSAGE });
    return;
  }
  const state = await getState();
  const toApply = state.proposals.filter((p) => txnIds.includes(p.txnId));

  await setState({ status: 'applying', message: `Writing ${toApply.length} memos…` });
  const applied: string[] = [...state.appliedTxnIds];
  let failures = 0;

  for (const proposal of toApply) {
    try {
      await updateTransactionMemo(
        accessToken,
        settings.budgetId,
        proposal.txnId,
        proposal.memo,
        proposal.splits,
      );
      applied.push(proposal.txnId);
      await setState({ appliedTxnIds: applied });
    } catch (err) {
      failures++;
      console.error('Failed to update memo', proposal.txnId, err);
    }
  }

  await setState({
    status: 'done',
    message: failures
      ? `Applied ${toApply.length - failures} memos, ${failures} failed.`
      : `Applied ${toApply.length} memos.`,
  });
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: Message) => {
    if (message.type === 'scan') {
      void runScan();
    } else if (message.type === 'apply') {
      void runApply(message.txnIds);
    }
    return false;
  });
});
