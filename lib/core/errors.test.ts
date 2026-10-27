import { describe, expect, it } from 'vitest';
import {
  AmazonSessionError,
  errorMessage,
  missingSetupMessage,
  RECONNECT_MESSAGE,
  YnabAuthError,
} from './errors';
import { YnabResponseError } from './ynab';

describe('errorMessage', () => {
  it('maps AmazonSessionError to the sign-in message', () => {
    expect(errorMessage(new AmazonSessionError('x'))).toBe(
      'Not signed in to Amazon. Open amazon.com, sign in, then scan again.',
    );
  });

  it('returns the YnabResponseError message as is', () => {
    const message = 'YNAB /transactions response invalid at data.transactions.3.amount: bad';
    expect(errorMessage(new YnabResponseError(message))).toBe(message);
  });

  it('maps YnabAuthError to the reconnect message', () => {
    expect(errorMessage(new YnabAuthError('x'))).toBe(RECONNECT_MESSAGE);
    expect(RECONNECT_MESSAGE).toBe('YNAB session expired. Reconnect YNAB in the popup.');
  });

  it('uses the message of a generic Error', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('stringifies a non-Error value', () => {
    expect(errorMessage('plain')).toBe('plain');
    expect(errorMessage(42)).toBe('42');
  });
});

describe('missingSetupMessage', () => {
  it('asks for a budget when a token exists', () => {
    expect(missingSetupMessage(true)).toBe('Pick a budget first.');
  });

  it('asks to connect YNAB when no token exists', () => {
    expect(missingSetupMessage(false)).toBe('Connect YNAB in the popup first.');
  });
});
