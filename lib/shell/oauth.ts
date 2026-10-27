import {
  YNAB_OAUTH_CLIENT_ID,
  buildAuthorizeUrl,
  isTokenUsable,
  oauthConfigured,
  parseAuthRedirect,
  type StoredToken,
} from '@/lib/core/oauth';

/** YNAB OAuth (implicit grant). Fully client-side: the access token comes
 * back in the redirect fragment and is stored in extension local storage.
 * Tokens expire after ~2 hours; renewal is attempted silently and falls back
 * to an interactive prompt from the popup. */

const TOKEN_KEY = 'oauthToken';

export function oauthRedirectUri(): string {
  return browser.identity.getRedirectURL();
}

async function readStored(): Promise<string | null> {
  const stored = await browser.storage.local.get(TOKEN_KEY);
  const token = stored[TOKEN_KEY] as StoredToken | undefined;
  if (!token || !isTokenUsable(token, Date.now())) return null;
  return token.accessToken;
}

/** Run the OAuth flow. Non-interactive succeeds only when YNAB can redirect
 * without showing UI (active session, previously approved). Returns null on
 * any failure — never throws. */
export async function authorize(interactive: boolean): Promise<string | null> {
  if (!oauthConfigured()) return null;
  const url = buildAuthorizeUrl(YNAB_OAUTH_CLIENT_ID, oauthRedirectUri());
  let redirect: string | undefined;
  try {
    redirect = await browser.identity.launchWebAuthFlow({ url, interactive });
  } catch {
    return null;
  }
  if (!redirect) return null;
  const token = parseAuthRedirect(redirect, Date.now());
  if (!token) return null;
  await browser.storage.local.set({ [TOKEN_KEY]: token });
  return token.accessToken;
}

/** Valid stored token, or a silent renewal; null means the user must
 * reconnect interactively from the popup. */
export async function getAccessToken(): Promise<string | null> {
  return (await readStored()) ?? authorize(false);
}

export async function isConnected(): Promise<boolean> {
  return (await readStored()) !== null;
}

export async function disconnect(): Promise<void> {
  await browser.storage.local.remove(TOKEN_KEY);
}
