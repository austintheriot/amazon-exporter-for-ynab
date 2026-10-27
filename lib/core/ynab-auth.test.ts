import { describe, expect, it } from 'vitest';
import { CONNECT_TIMEOUT_MS, isConnecting, parseYnabAuth } from './ynab-auth';

const STARTED_AT = '2026-10-27T12:00:00.000Z';
const after = (ms: number): string => new Date(Date.parse(STARTED_AT) + ms).toISOString();

describe('parseYnabAuth', () => {
  it('is idle when nothing is stored', () => {
    expect(parseYnabAuth(undefined)).toEqual({ kind: 'idle' });
  });

  it('is idle for an unknown kind', () => {
    expect(parseYnabAuth({ kind: 'bogus' })).toEqual({ kind: 'idle' });
  });

  it('keeps a failed status and its message', () => {
    expect(parseYnabAuth({ kind: 'failed', message: 'nope' })).toEqual({
      kind: 'failed',
      message: 'nope',
    });
  });
});

describe('isConnecting', () => {
  const connecting = { kind: 'connecting', startedAt: STARTED_AT } as const;

  it('is true just under the timeout', () => {
    expect(isConnecting(connecting, after(CONNECT_TIMEOUT_MS - 1000))).toBe(true);
  });

  it('is false at the timeout', () => {
    expect(CONNECT_TIMEOUT_MS).toBe(300_000);
    expect(isConnecting(connecting, after(CONNECT_TIMEOUT_MS))).toBe(false);
  });

  it('is false when idle or failed', () => {
    expect(isConnecting({ kind: 'idle' }, STARTED_AT)).toBe(false);
    expect(isConnecting({ kind: 'failed', message: 'x' }, STARTED_AT)).toBe(false);
  });
});
