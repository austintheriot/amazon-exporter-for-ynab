import { z } from 'zod/mini';

export class YnabResponseError extends Error {}

const budgetSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export type YnabBudget = z.infer<typeof budgetSchema>;

const transactionSchema = z.object({
  id: z.string(),
  /** YYYY-MM-DD */
  date: z.string(),
  /** Milliunits, outflow negative */
  amount: z.number(),
  payee_name: z.nullable(z.string()),
  memo: z.nullable(z.string()),
  category_name: z.nullable(z.string()),
  /** Present on split transactions; splits cannot be updated again */
  subtransactions: z.optional(z.array(z.object({ id: z.string() }))),
});

export type YnabTransaction = z.infer<typeof transactionSchema>;

const budgetsResponseSchema = z.object({
  data: z.object({ budgets: z.array(budgetSchema) }),
});

const transactionsResponseSchema = z.object({
  data: z.object({ transactions: z.array(transactionSchema) }),
});

const englishErrors = z.locales.en().localeError;

function parseResponse<Output>(
  schema: z.ZodMiniType<Output>,
  endpoint: string,
  raw: unknown,
): Output {
  const result = schema.safeParse(raw, { error: englishErrors });
  if (result.success) return result.data;
  const [issue] = result.error.issues;
  const path = issue?.path.map(String).join('.') ?? '';
  const message = issue?.message ?? result.error.message;
  throw new YnabResponseError(`YNAB ${endpoint} response invalid at ${path}: ${message}`);
}

export function parseBudgetsResponse(raw: unknown): YnabBudget[] {
  return parseResponse(budgetsResponseSchema, '/budgets', raw).data.budgets;
}

export function parseTransactionsResponse(raw: unknown): YnabTransaction[] {
  return parseResponse(transactionsResponseSchema, '/transactions', raw).data.transactions;
}

/** A subtransaction to create when turning a transaction into a split.
 * Amounts are milliunits and must sum to the transaction amount. */
export interface YnabSplit {
  amount: number;
  memo: string;
}

/** Convert a positive dollar amount to YNAB outflow milliunits (negative). */
export function dollarsToOutflowMilliunits(dollars: number): number {
  return -Math.round(dollars * 1000);
}
