import { AMAZON_LOGIN_URL, AMAZON_ORIGINS } from '../core/amazon-config';
import { oauthConfigured } from '../core/oauth';
import type { Msg } from '../core/popup/model';
import type { Services } from '../core/popup/services';
import { parseSettings, parseSyncState } from '../core/state';
import { parseYnabAuth } from '../core/ynab-auth';
import { disconnect, getAccessToken, isConnected } from './oauth';
import { getSettings, getState, getYnabAuth, saveSettings, YNAB_AUTH_KEY } from './storage';
import { getBudgets } from './ynab';

const OBJECT_URL_LIFETIME_MS = 60_000;

type StorageChanges = Record<string, { newValue?: unknown }>;

function changesToMsgs(changes: StorageChanges): Msg[] {
  const msgs: Msg[] = [];
  const { syncState, settings, oauthToken } = changes;
  const ynabAuth = changes[YNAB_AUTH_KEY];
  if (syncState) msgs.push({ type: 'syncStateChanged', sync: parseSyncState(syncState.newValue) });
  if (settings) msgs.push({ type: 'settingsChanged', settings: parseSettings(settings.newValue) });
  if (ynabAuth) msgs.push({ type: 'ynabAuthChanged', auth: parseYnabAuth(ynabAuth.newValue) });
  if (oauthToken) msgs.push({ type: 'tokenChanged', connected: oauthToken.newValue !== undefined });
  return msgs;
}

export function createPopupServices(): Services {
  return {
    clock: { nowIso: () => new Date().toISOString() },
    boot: {
      read: async () => {
        const [settings, sync, ynabConnected, ynabAuth, amazonGranted] = await Promise.all([
          getSettings(),
          getState(),
          isConnected(),
          getYnabAuth(),
          browser.permissions.contains({ origins: AMAZON_ORIGINS }),
        ]);
        return { settings, sync, ynabConnected, ynabAuth, amazonGranted, oauthConfigured: oauthConfigured() };
      },
    },
    watch: (onMsg) => {
      const listener = (changes: StorageChanges, area: string) => {
        if (area !== 'local') return;
        for (const msg of changesToMsgs(changes)) onMsg(msg);
      };
      browser.storage.onChanged.addListener(listener);
      return () => {
        browser.storage.onChanged.removeListener(listener);
      };
    },
    settings: {
      patch: async (patch) => {
        await saveSettings({ ...(await getSettings()), ...patch });
      },
    },
    ynab: {
      loadBudgets: async () => {
        const token = await getAccessToken();
        if (!token) throw new Error('No YNAB token while loading budgets');
        return getBudgets(token);
      },
      disconnect,
    },
    amazon: {
      requestPermission: () => browser.permissions.request({ origins: AMAZON_ORIGINS }),
      openLogin: async () => {
        await browser.tabs.create({ url: AMAZON_LOGIN_URL });
      },
    },
    background: {
      send: async (message) => {
        await browser.runtime.sendMessage(message);
      },
    },
    files: {
      download: (name, json) => {
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = name;
        anchor.click();
        setTimeout(() => {
          URL.revokeObjectURL(url);
        }, OBJECT_URL_LIFETIME_MS);
      },
    },
    logger: {
      error: (context, detail) => {
        console.error(context, detail);
      },
    },
    ticker: {
      every: (ms, onTick) => {
        const handle = setInterval(onTick, ms);
        return () => {
          clearInterval(handle);
        };
      },
    },
  };
}
