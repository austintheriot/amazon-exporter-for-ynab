import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS, DEFAULT_STATE } from '../core/state';
import { isConnected } from './oauth';
import {
  getSettings,
  getState,
  resetState,
  saveSettings,
  setState,
  setStateIfCurrent,
  getYnabAuth,
  setYnabAuth,
} from './storage';

describe('resetState', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('replaces a finished scan with the default state', async () => {
    await setState({
      status: 'done',
      message: 'Found 1 match',
      appliedTxnIds: ['txn-1'],
      lastScanAt: '2026-10-27T12:00:00.000Z',
      counts: { charges: 1, credits: 0, digitalSkipped: 0, invoicesUnparsed: 0 },
    });

    await resetState();

    expect(await getState()).toEqual(DEFAULT_STATE);
  });

  it('clears the budget the scan ran against', async () => {
    await setState({ scanBudgetId: 'b1', scanBudgetName: 'Household' });

    await resetState();

    const state = await getState();
    expect(state.scanBudgetId).toBeNull();
    expect(state.scanBudgetName).toBeNull();
  });

  it('clears a status stuck at scanning', async () => {
    await setState({ status: 'scanning', message: 'Fetching YNAB transactions…' });

    await resetState();

    expect((await getState()).status).toBe('idle');
  });

  it('keeps settings', async () => {
    const settings = { ...DEFAULT_SETTINGS, budgetId: 'budget-1', budgetName: 'Home' };
    await saveSettings(settings);

    await resetState();

    expect(await getSettings()).toEqual(settings);
  });

  it('keeps the YNAB connection', async () => {
    await browser.storage.local.set({
      oauthToken: { accessToken: 'secret', expiresAt: Number.MAX_SAFE_INTEGER },
    });

    await resetState();

    expect(await isConnected()).toBe(true);
  });
});

describe('setStateIfCurrent', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('writes the patch while the run is current', async () => {
    await setStateIfCurrent(() => true, { message: 'Fetching YNAB transactions…' });

    expect((await getState()).message).toBe('Fetching YNAB transactions…');
  });

  it('skips the write when the run was cancelled before the call', async () => {
    await setStateIfCurrent(() => false, { status: 'scanning' });

    expect(await getState()).toEqual(DEFAULT_STATE);
  });

  it('skips the write when the run is cancelled while the state is being read', async () => {
    let current = true;
    const write = setStateIfCurrent(() => current, { status: 'scanning' });
    current = false;
    await resetState();
    await write;

    expect(await getState()).toEqual(DEFAULT_STATE);
  });
});

describe('ynabAuth storage', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('is idle before anything is written', async () => {
    expect(await getYnabAuth()).toEqual({ kind: 'idle' });
  });

  it('round-trips a connecting status', async () => {
    const status = { kind: 'connecting', startedAt: '2026-10-27T12:00:00.000Z' } as const;
    await setYnabAuth(status);
    expect(await getYnabAuth()).toEqual(status);
  });
});
