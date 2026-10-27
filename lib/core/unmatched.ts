import type { AmazonCharge } from './amazon';
import { claimMatches, isAmazonPayee, withinWindow, type MatchCandidate } from './matcher';
import type { MatchProposal } from './proposal';
import type { ScanDebug } from './state';

const DIGITAL_ORDER_PREFIX = 'D0';
const DAY_MS = 86_400_000;

export type UnmatchedReason =
  | { kind: 'digital' }
  | { kind: 'order-unreadable' }
  | { kind: 'already-has-memo' }
  | { kind: 'taken' }
  | { kind: 'outside-window'; daysAway: number; maxDays: number }
  | { kind: 'no-amount-match'; closest: { amount: number; date: string } | null };

export interface UnmatchedEntry {
  kind: 'charge' | 'refund';
  orderId: string;
  date: string;
  amount: number;
  reason: UnmatchedReason;
}

type EntryKind = UnmatchedEntry['kind'];

const entryKey = (kind: EntryKind, orderId: string, date: string, amount: number): string =>
  `${kind}|${orderId}|${date}|${String(amount)}`;

const daysApart = (from: string, to: string): number =>
  Math.abs(new Date(to).getTime() - new Date(from).getTime()) / DAY_MS;

function countKeys(keys: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}

/** Takes one from `key`'s count; false when none are left. */
function take(counts: Map<string, number>, key: string): boolean {
  const count = counts.get(key) ?? 0;
  if (count === 0) return false;
  counts.set(key, count - 1);
  return true;
}

function closestAmount(
  want: number,
  date: string,
  candidates: MatchCandidate[],
): { amount: number; date: string } | null {
  const [best] = [...candidates].sort(
    (a, b) =>
      Math.abs(a.amount - want) - Math.abs(b.amount - want) ||
      daysApart(date, a.date) - daysApart(date, b.date),
  );
  return best ? { amount: Math.abs(best.amount) / 1000, date: best.date } : null;
}

function reasonWithoutClaim(
  entry: AmazonCharge,
  sign: -1 | 1,
  candidates: MatchCandidate[],
  maxDays: number,
): UnmatchedReason {
  const want = sign * Math.round(entry.amount * 1000);
  const sameSign = candidates.filter(
    (candidate) => Math.sign(candidate.amount) === sign && isAmazonPayee(candidate.payee),
  );
  const sameAmount = sameSign.filter((candidate) => candidate.amount === want);
  if (sameAmount.length === 0) {
    return { kind: 'no-amount-match', closest: closestAmount(want, entry.date, sameSign) };
  }
  const inWindow = sameAmount.filter((candidate) =>
    withinWindow(entry.date, candidate.date, maxDays),
  );
  if (inWindow.length === 0) {
    const daysAway = Math.min(...sameAmount.map((candidate) => daysApart(entry.date, candidate.date)));
    return { kind: 'outside-window', daysAway: Math.round(daysAway), maxDays };
  }
  return inWindow.every((candidate) => candidate.hasMemo)
    ? { kind: 'already-has-memo' }
    : { kind: 'taken' };
}

function explainKind(
  kind: EntryKind,
  entries: AmazonCharge[],
  candidates: MatchCandidate[],
  proposals: MatchProposal[],
  maxDays: number,
): UnmatchedEntry[] {
  const sign = kind === 'charge' ? -1 : 1;
  const keyOf = (entry: AmazonCharge) => entryKey(kind, entry.orderId, entry.date, entry.amount);
  const proposed = countKeys(
    proposals
      .filter((proposal) => proposal.kind === kind)
      .map((proposal) => entryKey(kind, proposal.orderId, proposal.orderDate, proposal.orderTotal)),
  );
  const claimedWithoutProposal = countKeys(
    claimMatches(entries, candidates, maxDays, sign).map(({ charge }) => keyOf(charge)),
  );
  for (const [key, count] of proposed) {
    claimedWithoutProposal.set(key, Math.max(0, (claimedWithoutProposal.get(key) ?? 0) - count));
  }

  const sortedEntries = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  return sortedEntries.flatMap((entry): UnmatchedEntry[] => {
    const key = keyOf(entry);
    if (take(proposed, key)) return [];
    const reason: UnmatchedReason = entry.orderId.startsWith(DIGITAL_ORDER_PREFIX)
      ? { kind: 'digital' }
      : take(claimedWithoutProposal, key)
        ? { kind: 'order-unreadable' }
        : reasonWithoutClaim(entry, sign, candidates, maxDays);
    return [{ kind, orderId: entry.orderId, date: entry.date, amount: entry.amount, reason }];
  });
}

export function explainUnmatched(input: {
  scanDebug: ScanDebug;
  proposals: MatchProposal[];
  maxDays: number;
}): UnmatchedEntry[] {
  const { scanDebug, proposals, maxDays } = input;
  return [
    ...explainKind('charge', scanDebug.charges, scanDebug.candidates, proposals, maxDays),
    ...explainKind('refund', scanDebug.credits, scanDebug.candidates, proposals, maxDays),
  ];
}
