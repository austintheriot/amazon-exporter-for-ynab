const BASE_URL = 'https://api.ynab.com/v1';

export class YnabAuthError extends Error {}

export interface YnabBudget {
  id: string;
  name: string;
}

export interface YnabTransaction {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number; // milliunits, outflow negative
  payee_name: string | null;
  memo: string | null;
  cleared: string;
  approved: boolean;
  category_name: string | null;
  /** Present on split transactions; splits cannot be updated again */
  subtransactions?: { id: string }[];
}

/** A subtransaction to create when turning a transaction into a split.
 * Amounts are milliunits and must sum to the transaction amount. */
export interface YnabSplit {
  amount: number;
  memo: string;
}

async function request<T>(
  accessToken: string,
  path: string,
  init?: RequestInit,
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
    throw new Error(`YNAB API error ${res.status}: ${await res.text()}`);
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

/** Convert a positive dollar amount to YNAB outflow milliunits (negative). */
export function dollarsToOutflowMilliunits(dollars: number): number {
  return -Math.round(dollars * 1000);
}
