import type { MatchProposal } from './proposal';

export function selectProposals(proposals: MatchProposal[], txnIds: string[]): MatchProposal[] {
  const selected = new Set(txnIds);
  return proposals.filter((proposal) => selected.has(proposal.txnId));
}
