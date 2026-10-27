import {
  DEFAULT_STATE,
  parseSettings,
  parseSyncState,
  type Settings,
  type SyncState,
} from '../core/state';
import { parseYnabAuth, type YnabAuthStatus } from '../core/ynab-auth';

const SETTINGS_KEY = 'settings';
const STATE_KEY = 'syncState';
export const YNAB_AUTH_KEY = 'ynabAuth';

export async function getSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  return parseSettings(stored[SETTINGS_KEY]);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function getState(): Promise<SyncState> {
  const stored = await browser.storage.local.get(STATE_KEY);
  return parseSyncState(stored[STATE_KEY]);
}

export async function setState(patch: Partial<SyncState>): Promise<SyncState> {
  const next = { ...(await getState()), ...patch };
  await browser.storage.local.set({ [STATE_KEY]: next });
  return next;
}

export async function resetState(): Promise<void> {
  await browser.storage.local.set({ [STATE_KEY]: DEFAULT_STATE });
}

/** Rechecks after the read: a reset that lands while the read is pending
 * must not be overwritten by a cancelled run's stale snapshot. */
export async function setStateIfCurrent(
  isCurrent: () => boolean,
  patch: Partial<SyncState>,
): Promise<void> {
  if (!isCurrent()) return;
  const stored = await getState();
  if (!isCurrent()) return;
  await browser.storage.local.set({ [STATE_KEY]: { ...stored, ...patch } });
}

export async function getYnabAuth(): Promise<YnabAuthStatus> {
  const stored = await browser.storage.local.get(YNAB_AUTH_KEY);
  return parseYnabAuth(stored[YNAB_AUTH_KEY]);
}

export async function setYnabAuth(status: YnabAuthStatus): Promise<void> {
  await browser.storage.local.set({ [YNAB_AUTH_KEY]: status });
}
