import { YnabAuthError } from '../core/errors';
import type {
  YnabBudget,
  YnabSplit,
  YnabTransaction,
} from '../core/ynab';

const BASE_URL = 'https://api.ynab.com/v1';

async function request<T>(
  accessToken: string,
  path: string,
  init?: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> },
): Promise<T> {
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
  const body = (await res.json()) as { data: T };
  return body.data;
}

export async function getBudgets(accessToken: string): Promise<YnabBudget[]> {
  const data = await request<{ budgets: YnabBudget[] }>(accessToken, '/budgets');
  return data.budgets.map(({ id, name }) => ({ id, name }));
}

export async function getTransactions(
  accessToken: string,
  budgetId: string,
  sinceDate: string,
): Promise<YnabTransaction[]> {
  const data = await request<{ transactions: YnabTransaction[] }>(
    accessToken,
    `/budgets/${budgetId}/transactions?since_date=${sinceDate}`,
  );
  return data.transactions;
}

export async function updateTransactionMemo(
  accessToken: string,
  budgetId: string,
  transactionId: string,
  memo: string,
  splits?: YnabSplit[],
): Promise<void> {
  await request(accessToken, `/budgets/${budgetId}/transactions/${transactionId}`, {
    method: 'PUT',
    body: JSON.stringify({
      transaction: splits?.length ? { memo, subtransactions: splits } : { memo },
    }),
  });
}
