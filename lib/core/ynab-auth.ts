import { z } from 'zod/mini';

const ynabAuthSchema = z.catch(
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('idle') }),
    z.object({ kind: z.literal('connecting'), startedAt: z.string() }),
    z.object({ kind: z.literal('failed'), message: z.string() }),
  ]),
  () => ({ kind: 'idle' as const }),
);

export type YnabAuthStatus = z.infer<typeof ynabAuthSchema>;

/** A service-worker restart kills the sign-in flow without writing a
 * result, so an old `connecting` value counts as idle. */
export const CONNECT_TIMEOUT_MS = 300_000;

export function parseYnabAuth(raw: unknown): YnabAuthStatus {
  return ynabAuthSchema.parse(raw);
}

export function isConnecting(status: YnabAuthStatus, nowIso: string): boolean {
  if (status.kind !== 'connecting') return false;
  return Date.parse(nowIso) - Date.parse(status.startedAt) < CONNECT_TIMEOUT_MS;
}
