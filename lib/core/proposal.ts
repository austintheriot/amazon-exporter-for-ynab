import { z } from 'zod/mini';

export const matchProposalSchema = z.object({
  kind: z.enum(['charge', 'refund']),
  orderId: z.string(),
  /** Charge or credit date */
  orderDate: z.string(),
  /** Charge or credit amount */
  orderTotal: z.number(),
  items: z.array(z.string()),
  txnId: z.string(),
  txnDate: z.string(),
  txnPayee: z.string(),
  memo: z.string(),
  /** When present, applying also turns the transaction into a split */
  splits: z.optional(z.array(z.object({ amount: z.number(), memo: z.string() }))),
});

export type MatchProposal = z.infer<typeof matchProposalSchema>;
