import type { MatchProposal } from './proposal';

export function selectProposals(proposals: MatchProposal[], txnIds: string[]): MatchProposal[] {
  const selected = new Set(txnIds);
  return proposals.filter((proposal) => selected.has(proposal.txnId));
}

export type ApplyBlocker = 'no-scan-budget' | 'budget-changed';

export function applyBlocker(input: {
  selectedBudgetId: string;
  scanBudgetId: string | null;
}): ApplyBlocker | null {
  if (input.scanBudgetId === null) return 'no-scan-budget';
  return input.scanBudgetId === input.selectedBudgetId ? null : 'budget-changed';
}
