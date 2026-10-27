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

/** Convert a positive dollar amount to YNAB outflow milliunits (negative). */
export function dollarsToOutflowMilliunits(dollars: number): number {
  return -Math.round(dollars * 1000);
}
