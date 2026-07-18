/** YNAB OAuth (implicit grant). Fully client-side: the access token comes
 * back in the redirect fragment and is stored in extension local storage.
 * Tokens expire after ~2 hours; renewal is attempted silently and falls back
 * to an interactive prompt from the popup. */

/** OAuth client ID from app.ynab.com → Account Settings → Developer Settings.
 * The registered redirect URI must match oauthRedirectUri(), which is stable
 * because the extension ID is pinned via the manifest `key`. */
export const YNAB_OAUTH_CLIENT_ID =
  'REPLACE_WITH_YNAB_OAUTH_CLIENT_ID';

const AUTHORIZE_URL = 'https://app.ynab.com/oauth/authorize';
const TOKEN_KEY = 'oauthToken';
/** Renew this long before actual expiry so a token never dies mid-scan */
const EXPIRY_MARGIN_MS = 5 * 60_000;

interface StoredToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

export function oauthRedirectUri(): string {
  return browser.identity.getRedirectURL();
}

export function oauthConfigured(): boolean {
  return !YNAB_OAUTH_CLIENT_ID.startsWith('REPLACE_');
}

async function readStored(): Promise<string | null> {
  const stored = await browser.storage.local.get(TOKEN_KEY);
  const token = stored[TOKEN_KEY] as StoredToken | undefined;
  if (!token || Date.now() >= token.expiresAt - EXPIRY_MARGIN_MS) return null;
  return token.accessToken;
}

/** Run the OAuth flow. Non-interactive succeeds only when YNAB can redirect
 * without showing UI (active session, previously approved). Returns null on
 * any failure — never throws. */
export async function authorize(interactive: boolean): Promise<string | null> {
  if (!oauthConfigured()) return null;
  const url =
    `${AUTHORIZE_URL}?client_id=${encodeURIComponent(YNAB_OAUTH_CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(oauthRedirectUri())}` +
    `&response_type=token`;
  let redirect: string | undefined;
  try {
    redirect = await browser.identity.launchWebAuthFlow({ url, interactive });
  } catch {
    return null;
  }
  if (!redirect) return null;
  const params = new URLSearchParams(new URL(redirect).hash.slice(1));
  const accessToken = params.get('access_token');
  const expiresIn = Number(params.get('expires_in'));
  if (!accessToken || !Number.isFinite(expiresIn)) return null;
  const token: StoredToken = {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };
  await browser.storage.local.set({ [TOKEN_KEY]: token });
  return accessToken;
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
