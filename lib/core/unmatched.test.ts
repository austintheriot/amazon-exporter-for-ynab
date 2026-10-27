import { describe, expect, it } from 'vitest';
import type { AmazonCharge } from './amazon';
import type { MatchProposal } from './proposal';
import type { ScanDebug } from './state';
import { explainUnmatched, type UnmatchedEntry } from './unmatched';

type Candidate = ScanDebug['candidates'][number];

const charge = (overrides: Partial<AmazonCharge> = {}): AmazonCharge => ({
  orderId: '111-0000000-0000001',
  date: '2026-06-10',
  amount: 67.38,
  paymentMethod: 'Visa ****1234',
  ...overrides,
});

const candidate = (overrides: Partial<Candidate> = {}): Candidate => ({
  id: 'txn-1',
  date: '2026-06-11',
  amount: -67_380,
  payee: 'Amazon.com',
  hasMemo: false,
  ...overrides,
});

const proposalFor = (entry: AmazonCharge, kind: 'charge' | 'refund' = 'charge'): MatchProposal => ({
  kind,
  orderId: entry.orderId,
  orderDate: entry.date,
  orderTotal: entry.amount,
  items: ['Item'],
  txnId: 'txn-1',
  txnDate: entry.date,
  txnPayee: 'Amazon.com',
  memo: 'Item',
});

const explain = (input: {
  charges?: AmazonCharge[];
  credits?: AmazonCharge[];
  candidates?: Candidate[];
  proposals?: MatchProposal[];
  maxDays?: number;
}): UnmatchedEntry[] =>
  explainUnmatched({
    scanDebug: {
      charges: input.charges ?? [],
      credits: input.credits ?? [],
      candidates: input.candidates ?? [],
    },
    proposals: input.proposals ?? [],
    maxDays: input.maxDays ?? 7,
  });

const reasons = (entries: UnmatchedEntry[]) => entries.map((entry) => entry.reason);

describe('explainUnmatched', () => {
  it('returns nothing when every entry has a proposal', () => {
    const entry = charge();
    expect(explain({ charges: [entry], candidates: [candidate()], proposals: [proposalFor(entry)] })).toEqual([]);
  });

  it('marks a digital order', () => {
    expect(reasons(explain({ charges: [charge({ orderId: 'D01-0000000-0000001' })] }))).toEqual([
      { kind: 'digital' },
    ]);
  });

  it('marks a matched charge whose order page could not be read', () => {
    expect(reasons(explain({ charges: [charge()], candidates: [candidate()] }))).toEqual([
      { kind: 'order-unreadable' },
    ]);
  });

  it('names the closest amount when no amount matches', () => {
    expect(reasons(explain({ charges: [charge()], candidates: [candidate({ amount: -67_390 })] }))).toEqual([
      { kind: 'no-amount-match', closest: { amount: 67.39, date: '2026-06-11' } },
    ]);
  });

  it('has no closest amount when there are no candidates', () => {
    expect(reasons(explain({ charges: [charge()] }))).toEqual([
      { kind: 'no-amount-match', closest: null },
    ]);
  });

  it('ignores candidates of the other sign when naming the closest amount', () => {
    expect(reasons(explain({ charges: [charge()], candidates: [candidate({ amount: 67_380 })] }))).toEqual([
      { kind: 'no-amount-match', closest: null },
    ]);
  });

  it('reports how far away an out-of-window amount match is', () => {
    expect(
      reasons(explain({ charges: [charge()], candidates: [candidate({ date: '2026-06-20' })], maxDays: 7 })),
    ).toEqual([{ kind: 'outside-window', daysAway: 10, maxDays: 7 }]);
  });

  it('reports a match that already has a memo', () => {
    expect(reasons(explain({ charges: [charge()], candidates: [candidate({ hasMemo: true })] }))).toEqual([
      { kind: 'already-has-memo' },
    ]);
  });

  it('treats two identical split-shipment charges as two entries', () => {
    const first = charge();
    const second = charge();
    const entries = explain({
      charges: [first, second],
      candidates: [candidate()],
      proposals: [proposalFor(first)],
    });
    expect(reasons(entries)).toEqual([{ kind: 'taken' }]);
  });

  it('explains an unmatched refund', () => {
    const entries = explain({ credits: [charge({ amount: 5 })] });
    expect(entries).toEqual([
      {
        kind: 'refund',
        orderId: '111-0000000-0000001',
        date: '2026-06-10',
        amount: 5,
        reason: { kind: 'no-amount-match', closest: null },
      },
    ]);
  });

  it('lists charges by date, then refunds', () => {
    const entries = explain({
      charges: [charge({ date: '2026-06-12' }), charge({ date: '2026-06-01' })],
      credits: [charge({ date: '2026-05-01', amount: 2 })],
    });
    expect(entries.map((entry) => [entry.kind, entry.date])).toEqual([
      ['charge', '2026-06-01'],
      ['charge', '2026-06-12'],
      ['refund', '2026-05-01'],
    ]);
  });
});
