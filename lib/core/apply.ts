import type { MatchProposal } from './proposal';

export function selectProposals(proposals: MatchProposal[], txnIds: string[]): MatchProposal[] {
  const selected = new Set(txnIds);
  return proposals.filter((proposal) => selected.has(proposal.txnId));
}

export function applyStartMessage(count: number): string {
  return `Writing ${String(count)} memos…`;
}

export function applySummary(total: number, failures: number): string {
  return failures
    ? `Applied ${String(total - failures)} memos, ${String(failures)} failed.`
    : `Applied ${String(total)} memos.`;
}
