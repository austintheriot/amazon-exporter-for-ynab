import { applyStartMessage, applySummary, selectProposals } from '@/lib/core/apply';
import {
  errorMessage,
  missingSetupMessage,
  RECONNECT_MESSAGE,
  YnabAuthError,
} from '@/lib/core/errors';
import { buildScanResult, matchScan, scanWindow } from '@/lib/core/scan';
import type { Message } from '@/lib/core/state';
import { fetchAmazonCharges, fetchOrderDetails } from '@/lib/shell/amazon';
import { disconnect, getAccessToken } from '@/lib/shell/oauth';
import { getSettings, getState, setState } from '@/lib/shell/storage';
import { getTransactions, updateTransactionMemo } from '@/lib/shell/ynab';

export async function runScan(): Promise<void> {
  const settings = await getSettings();
  const accessToken = await getAccessToken();
  if (!accessToken || !settings.budgetId) {
    await setState({ status: 'error', message: missingSetupMessage(!!accessToken) });
    return;
  }
  const now = new Date().toISOString();

  await setState({
    status: 'scanning',
    message: 'Starting scan…',
    proposals: [],
    counts: null,
    debugCaptures: [],
  });
  try {
    const onProgress = (message: string) => void setState({ message });
    const { sinceDate, untilDate, ynabSinceDate } = scanWindow(settings, now.slice(0, 10));

    const { charges, credits, captures } = await fetchAmazonCharges({
      sinceDate,
      untilDate,
      limit: settings.orderLimit,
      onProgress,
    });

    await setState({ message: 'Fetching YNAB transactions…' });
    const transactions = await getTransactions(accessToken, settings.budgetId, ynabSinceDate);

    const matches = matchScan({ charges, credits, transactions, maxDays: settings.maxDays });
    const { orders, captures: invoiceCaptures } = await fetchOrderDetails(
      matches.orderIdsToFetch,
      onProgress,
    );
    const result = buildScanResult({
      matches,
      orders,
      transactions,
      maxDays: settings.maxDays,
      captures: [...captures, ...invoiceCaptures],
    });

    await setState({
      status: 'done',
      message: result.message,
      proposals: result.proposals,
      counts: result.counts,
      debugCaptures: result.debugCaptures,
      scanDebug: matches.scanDebug,
      lastScanAt: now,
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
  const toApply = selectProposals(state.proposals, txnIds);

  await setState({ status: 'applying', message: applyStartMessage(toApply.length) });
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

  await setState({ status: 'done', message: applySummary(toApply.length, failures) });
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: Message) => {
    switch (message.type) {
      case 'scan':
        void runScan();
        break;
      case 'apply':
        void runApply(message.txnIds);
        break;
    }
    return false;
  });
});
