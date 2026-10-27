import { describe, expect, it } from 'vitest';
import {
  EXPIRY_MARGIN_MS,
  buildAuthorizeUrl,
  isTokenUsable,
  oauthConfigured,
  parseAuthRedirect,
} from './oauth';

describe('buildAuthorizeUrl', () => {
  it('encodes the client id and redirect uri in the established order', () => {
    expect(buildAuthorizeUrl('client id/1', 'https://x.chromiumapp.org/')).toBe(
      'https://app.ynab.com/oauth/authorize?client_id=client%20id%2F1' +
        '&redirect_uri=https%3A%2F%2Fx.chromiumapp.org%2F' +
        '&response_type=token',
    );
  });
});

describe('parseAuthRedirect', () => {
  it('reads the token and computes the expiry from nowMs', () => {
    expect(
      parseAuthRedirect(
        'https://x.chromiumapp.org/#access_token=abc&expires_in=7200',
        1_000,
      ),
    ).toEqual({ accessToken: 'abc', expiresAt: 7_201_000 });
  });

  it('returns null when the access token is missing', () => {
    expect(
      parseAuthRedirect('https://x.chromiumapp.org/#expires_in=7200', 1_000),
    ).toBeNull();
  });

  it('returns null when expires_in is not a number', () => {
    expect(
      parseAuthRedirect(
        'https://x.chromiumapp.org/#access_token=abc&expires_in=abc',
        1_000,
      ),
    ).toBeNull();
  });

  it('returns null for an invalid URL', () => {
    expect(parseAuthRedirect('not a url', 1_000)).toBeNull();
  });
});

describe('isTokenUsable', () => {
  const token = { accessToken: 'abc', expiresAt: 10_000_000 };

  it('is false without a token', () => {
    expect(isTokenUsable(undefined, 0)).toBe(false);
  });

  it('is true one millisecond before the renewal margin', () => {
    expect(isTokenUsable(token, token.expiresAt - EXPIRY_MARGIN_MS - 1)).toBe(
      true,
    );
  });

  it('is false at exactly the renewal margin', () => {
    expect(isTokenUsable(token, token.expiresAt - EXPIRY_MARGIN_MS)).toBe(
      false,
    );
  });
});

describe('oauthConfigured', () => {
  it('is false for a placeholder id', () => {
    expect(oauthConfigured('REPLACE_ME')).toBe(false);
  });

  it('is true for a real id', () => {
    expect(oauthConfigured('abc')).toBe(true);
  });

  it('is true for the bundled id', () => {
    expect(oauthConfigured()).toBe(true);
  });
});
