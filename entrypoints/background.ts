import { applyBlocker, selectProposals } from '@/lib/core/apply';
import {
  applyStartMessage,
  applySummary,
  budgetMismatchMessage,
  errorMessage,
  missingSetupMessage,
  RECONNECT_MESSAGE,
  YNAB_SIGN_IN_FAILED,
} from '@/lib/core/copy';
import { YnabAuthError } from '@/lib/core/errors';
import { createRunGuard } from '@/lib/core/run-guard';
import { createSingleFlight } from '@/lib/core/single-flight';
import { buildScanResult, matchScan, scanWindow } from '@/lib/core/scan';
import { parseMessage, type SyncState } from '@/lib/core/state';
import { fetchAmazonCharges, fetchOrderDetails } from '@/lib/shell/amazon';
import { isConnecting } from '@/lib/core/ynab-auth';
import { authorize, disconnect, getAccessToken } from '@/lib/shell/oauth';
import {
  getSettings,
  getState,
  getYnabAuth,
  resetState,
  setStateIfCurrent,
  setYnabAuth,
} from '@/lib/shell/storage';
import { getTransactions, updateTransactionMemo } from '@/lib/shell/ynab';

const runGuard = createRunGuard();
const runFlight = createSingleFlight();
const connectFlight = createSingleFlight();

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
  const scanBudget = { scanBudgetId: settings.budgetId, scanBudgetName: settings.budgetName };

  await setState({
    status: 'scanning',
    message: 'Starting scan…',
    proposals: [],
    counts: null,
    debugCaptures: [],
    scanDebug: null,
    scanBudgetId: null,
    scanBudgetName: null,
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
      ...scanBudget,
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
  if (applyBlocker({ selectedBudgetId: settings.budgetId, scanBudgetId: state.scanBudgetId })) {
    await setState({
      status: 'error',
      message: budgetMismatchMessage(state.scanBudgetName, settings.budgetName),
    });
    return;
  }
  const toApply = selectProposals(state.proposals, txnIds, state.appliedTxnIds);

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

async function connectYnab(): Promise<void> {
  if (isConnecting(await getYnabAuth(), new Date().toISOString())) return;
  await setYnabAuth({ kind: 'connecting', startedAt: new Date().toISOString() });
  try {
    const token = await authorize(true);
    await setYnabAuth(token ? { kind: 'idle' } : { kind: 'failed', message: YNAB_SIGN_IN_FAILED });
  } catch (err) {
    console.error('YNAB sign-in failed', err);
    await setYnabAuth({ kind: 'failed', message: YNAB_SIGN_IN_FAILED });
  }
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((raw: unknown) => {
    const message = parseMessage(raw);
    if (!message) return false;
    switch (message.type) {
      case 'scan':
        void runFlight.run(runScan);
        break;
      case 'apply':
        void runFlight.run(() => runApply(message.txnIds));
        break;
      case 'connectYnab':
        void connectFlight.run(connectYnab);
        break;
      case 'reset':
        runGuard.cancelAll();
        void resetState();
        break;
    }
    return false;
  });
});
