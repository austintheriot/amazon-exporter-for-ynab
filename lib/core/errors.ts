export class AmazonSessionError extends Error {}

export class YnabAuthError extends Error {}

export const RECONNECT_MESSAGE = 'YNAB session expired. Reconnect YNAB in the popup.';

export function errorMessage(err: unknown): string {
  if (err instanceof AmazonSessionError) {
    return 'Not signed in to Amazon. Open amazon.com, sign in, then scan again.';
  }
  if (err instanceof YnabAuthError) {
    return RECONNECT_MESSAGE;
  }
  return err instanceof Error ? err.message : String(err);
}

export function missingSetupMessage(hasToken: boolean): string {
  return hasToken ? 'Pick a budget first.' : 'Connect YNAB in the popup first.';
}
