import { YnabAuthError } from '../core/errors';
import {
  buildMemoUpdateBody,
  parseBudgetsResponse,
  parseTransactionsResponse,
  type YnabBudget,
  type YnabSplit,
  type YnabTransaction,
} from '../core/ynab';

const BASE_URL = 'https://api.ynab.com/v1';

async function request(
  accessToken: string,
  path: string,
  init?: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> },
): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  if (res.status === 401) {
    throw new YnabAuthError('YNAB token rejected (401)');
  }
  if (!res.ok) {
    throw new Error(`YNAB API error ${String(res.status)}: ${await res.text()}`);
  }
  const body: unknown = await res.json();
  return body;
}

export async function getBudgets(accessToken: string): Promise<YnabBudget[]> {
  return parseBudgetsResponse(await request(accessToken, '/budgets'));
}

export async function getTransactions(
  accessToken: string,
  budgetId: string,
  sinceDate: string,
  signal?: AbortSignal,
): Promise<YnabTransaction[]> {
  return parseTransactionsResponse(
    await request(accessToken, `/budgets/${budgetId}/transactions?since_date=${sinceDate}`, {
      signal: signal ?? null,
    }),
  );
}

export async function updateTransactionMemo(
  accessToken: string,
  budgetId: string,
  transactionId: string,
  memo: string,
  splits?: YnabSplit[],
  signal?: AbortSignal,
): Promise<void> {
  await request(accessToken, `/budgets/${budgetId}/transactions/${transactionId}`, {
    method: 'PUT',
    signal: signal ?? null,
    body: JSON.stringify(buildMemoUpdateBody(memo, splits)),
  });
}
