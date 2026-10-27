import { selectProposals } from '@/lib/core/apply';
import {
  applyStartMessage,
  applySummary,
  errorMessage,
  missingSetupMessage,
  RECONNECT_MESSAGE,
} from '@/lib/core/copy';
import { YnabAuthError } from '@/lib/core/errors';
import { createRunGuard } from '@/lib/core/run-guard';
import { buildScanResult, matchScan, scanWindow } from '@/lib/core/scan';
import { parseMessage, type SyncState } from '@/lib/core/state';
import { fetchAmazonCharges, fetchOrderDetails } from '@/lib/shell/amazon';
import { disconnect, getAccessToken } from '@/lib/shell/oauth';
import { getSettings, getState, resetState, setStateIfCurrent } from '@/lib/shell/storage';
import { getTransactions, updateTransactionMemo } from '@/lib/shell/ynab';

const runGuard = createRunGuard();

function startRun() {
  const run = runGuard.start();
  const isCurrent = () => runGuard.isCurrent(run);
  const setState = (patch: Partial<SyncState>) => setStateIfCurrent(isCurrent, patch);
  return { isCurrent, setState, signal: runGuard.signal(run) };
}

async function runScan(): Promise<void> {
  const { isCurrent, setState, signal } = startRun();
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
      signal,
    });

    await setState({ message: 'Reading YNAB transactions…' });
    const transactions = await getTransactions(
      accessToken,
      settings.budgetId,
      ynabSinceDate,
      signal,
    );

    const matches = matchScan({ charges, credits, transactions, maxDays: settings.maxDays });
    const { orders, captures: invoiceCaptures } = await fetchOrderDetails(
      matches.orderIdsToFetch,
      onProgress,
      signal,
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
    if (!isCurrent()) return;
    console.error('Scan failed', err);
    if (err instanceof YnabAuthError) await disconnect();
    await setState({ status: 'error', message: errorMessage(err) });
  }
}

async function runApply(txnIds: string[]): Promise<void> {
  const { isCurrent, setState, signal } = startRun();
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
    if (!isCurrent()) return;
    try {
      await updateTransactionMemo(
        accessToken,
        settings.budgetId,
        proposal.txnId,
        proposal.memo,
        proposal.splits,
        signal,
      );
      applied.push(proposal.txnId);
      await setState({ appliedTxnIds: applied });
    } catch (err) {
      if (!isCurrent()) return;
      failures++;
      console.error('Failed to update memo', proposal.txnId, err);
    }
  }

  await setState({ status: 'done', message: applySummary(toApply.length, failures) });
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((raw: unknown) => {
    const message = parseMessage(raw);
    if (!message) return false;
    switch (message.type) {
      case 'scan':
        void runScan();
        break;
      case 'apply':
        void runApply(message.txnIds);
        break;
      case 'reset':
        runGuard.cancelAll();
        void resetState();
        break;
    }
    return false;
  });
});
