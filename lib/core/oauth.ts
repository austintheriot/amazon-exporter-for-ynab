import { z } from 'zod/mini';

/** OAuth client ID from app.ynab.com → Account Settings → Developer Settings.
 * The registered redirect URI must match oauthRedirectUri(), which is stable
 * because the extension ID is pinned via the manifest `key`. */
export const YNAB_OAUTH_CLIENT_ID =
  'FVvJ6kFZO-Dt-Tg3byToriLOkCWtfTqjQo5w8PnoJpU';

const AUTHORIZE_URL = 'https://app.ynab.com/oauth/authorize';

/** Renew this long before actual expiry so a token never dies mid-scan */
export const EXPIRY_MARGIN_MS = 5 * 60_000;

const storedTokenSchema = z.object({
  accessToken: z.string(),
  /** Epoch ms */
  expiresAt: z.number(),
});

export type StoredToken = z.infer<typeof storedTokenSchema>;

export function parseStoredToken(raw: unknown): StoredToken | null {
  const result = storedTokenSchema.safeParse(raw);
  return result.success ? result.data : null;
}

const redirectParamsSchema = z.object({
  access_token: z.string().check(z.minLength(1)),
  expires_in: z.pipe(
    z.nullable(z.string()),
    z.pipe(
      z.transform((value: string | null) => Number(value)),
      z.number(),
    ),
  ),
});

export function oauthConfigured(clientId: string = YNAB_OAUTH_CLIENT_ID): boolean {
  return !clientId.startsWith('REPLACE_');
}

export function buildAuthorizeUrl(clientId: string, redirectUri: string): string {
  return (
    `${AUTHORIZE_URL}?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=token`
  );
}

export function parseAuthRedirect(
  redirectUrl: string,
  nowMs: number,
): StoredToken | null {
  let hash: string;
  try {
    hash = new URL(redirectUrl).hash;
  } catch {
    return null;
  }
  const params = new URLSearchParams(hash.slice(1));
  const result = redirectParamsSchema.safeParse({
    access_token: params.get('access_token'),
    expires_in: params.get('expires_in'),
  });
  if (!result.success) return null;
  const { access_token: accessToken, expires_in: expiresIn } = result.data;
  return { accessToken, expiresAt: nowMs + expiresIn * 1000 };
}

export function isTokenUsable(
  token: StoredToken | undefined,
  nowMs: number,
): boolean {
  return token !== undefined && nowMs < token.expiresAt - EXPIRY_MARGIN_MS;
}
