import {
  parseSettings,
  parseSyncState,
  type Settings,
  type SyncState,
} from '../core/state';

const SETTINGS_KEY = 'settings';
const STATE_KEY = 'syncState';

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
