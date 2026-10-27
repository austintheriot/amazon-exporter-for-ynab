import { AMAZON_LOGIN_URL, AMAZON_ORIGINS } from '@/lib/core/amazon';
import {
  authorize,
  disconnect,
  getAccessToken,
  isConnected,
} from '@/lib/shell/oauth';
import { oauthConfigured } from '@/lib/core/oauth';
import type { Settings, SyncState } from '@/lib/core/state';
import type { YnabBudget } from '@/lib/core/ynab';
import { getSettings, getState, saveSettings } from '@/lib/shell/storage';
import { getBudgets } from '@/lib/shell/ynab';

const PRIVACY_URL =
  'https://github.com/jparavisini/amazon-exporter-for-ynab/blob/main/PRIVACY.md';

const app = requireElement('app');

let settings: Settings;
let state: SyncState;
let budgets: YnabBudget[] = [];
let ynabConnected = false;
let amazonGranted = false;
let budgetError = '';

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Popup markup has no #${id} element`);
  return element;
}

function runAsync(handler: () => Promise<void>): () => void {
  return () => {
    void handler();
  };
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

async function loadBudgets(): Promise<void> {
  budgetError = '';
  budgets = [];
  const accessToken = await getAccessToken();
  ynabConnected = accessToken !== null;
  if (!accessToken) return;
  try {
    budgets = await getBudgets(accessToken);
  } catch {
    budgetError = 'Could not load budgets. Try reconnecting YNAB.';
  }
}

function renderSettings(): HTMLElement {
  if (!ynabConnected) {
    if (!oauthConfigured()) {
      return el('section', {}, [
        el('div', { className: 'status error' }, [
          'OAuth client ID is not configured. See the README.',
        ]),
      ]);
    }
    const connectBtn = el('button', {
      className: 'primary',
      textContent: 'Connect YNAB',
    });
    connectBtn.addEventListener('click', runAsync(async () => {
      const token = await authorize(true);
      if (token) {
        await loadBudgets();
      } else {
        budgetError = 'YNAB authorization failed or was cancelled.';
      }
      render();
    }));
    return el('section', {}, [
      el('div', {}, ['Authorize read/write access to your YNAB budget.']),
      connectBtn,
      ...(budgetError
        ? [el('div', { className: 'status error' }, [budgetError])]
        : []),
    ]);
  }

  const disconnectBtn = el('button', { textContent: 'Disconnect YNAB' });
  disconnectBtn.addEventListener('click', runAsync(async () => {
    await disconnect();
    ynabConnected = false;
    budgets = [];
    render();
  }));

  const budgetSelect = el('select');
  budgetSelect.append(el('option', { value: '', textContent: 'Select budget…' }));
  for (const b of budgets) {
    budgetSelect.append(
      el('option', {
        value: b.id,
        textContent: b.name,
        selected: b.id === settings.budgetId,
      }),
    );
  }
  if (settings.budgetId && !budgets.some((b) => b.id === settings.budgetId)) {
    budgetSelect.append(
      el('option', {
        value: settings.budgetId,
        textContent: settings.budgetName || settings.budgetId,
        selected: true,
      }),
    );
  }
  budgetSelect.addEventListener('change', runAsync(async () => {
    settings.budgetId = budgetSelect.value;
    settings.budgetName =
      budgets.find((b) => b.id === budgetSelect.value)?.name ?? '';
    await saveSettings(settings);
    render();
  }));

  const currentYear = new Date().getFullYear();
  const yearSelect = el('select');
  yearSelect.append(
    el('option', { value: '', textContent: 'Recent orders', selected: settings.year === null }),
  );
  for (let y = currentYear; y >= currentYear - 4; y--) {
    yearSelect.append(
      el('option', {
        value: String(y),
        textContent: String(y),
        selected: settings.year === y,
      }),
    );
  }
  yearSelect.addEventListener('change', runAsync(async () => {
    settings.year = yearSelect.value ? Number(yearSelect.value) : null;
    await saveSettings(settings);
  }));

  const limitInput = el('input', {
    type: 'number',
    min: '1',
    max: '200',
    value: String(settings.orderLimit),
  });
  limitInput.addEventListener('change', runAsync(async () => {
    const n = parseInt(limitInput.value, 10);
    if (Number.isFinite(n) && n > 0) {
      settings.orderLimit = Math.min(n, 200);
      await saveSettings(settings);
    }
  }));

  return el('section', {}, [
    ...(budgetError ? [el('div', { className: 'status error' }, [budgetError])] : []),
    el('label', {}, ['Budget', budgetSelect]),
    el('div', { className: 'row' }, [
      el('label', {}, ['Orders from', yearSelect]),
      el('label', {}, ['Max orders', limitInput]),
    ]),
    disconnectBtn,
  ]);
}

function renderAmazon(): HTMLElement {
  if (amazonGranted) {
    return el('section', {}, [
      el('div', {}, [
        'Amazon access granted. ',
        el('span', { className: 'muted' }, [
          'Stay signed in to amazon.com in this browser.',
        ]),
      ]),
    ]);
  }
  const connectBtn = el('button', { className: 'primary', textContent: 'Connect Amazon' });
  connectBtn.addEventListener('click', runAsync(async () => {
    amazonGranted = await browser.permissions.request({
      origins: AMAZON_ORIGINS,
    });
    if (amazonGranted) {
      await browser.tabs.create({ url: AMAZON_LOGIN_URL });
    }
    render();
  }));
  return el('section', {}, [
    el('div', {}, ['Grant access to read your Amazon order history.']),
    connectBtn,
  ]);
}

function renderSync(): HTMLElement {
  const busy = state.status === 'scanning' || state.status === 'applying';
  const ready = amazonGranted && ynabConnected && !!settings.budgetId;

  const scanBtn = el('button', {
    className: 'primary',
    textContent: busy ? 'Working…' : 'Scan (dry run)',
    disabled: busy || !ready,
  });
  scanBtn.addEventListener('click', () => {
    void browser.runtime.sendMessage({ type: 'scan' });
  });

  const pending = state.proposals.filter(
    (p) => !state.appliedTxnIds.includes(p.txnId),
  );
  const applyBtn = el('button', {
    textContent: `Apply ${String(pending.length)} memo${pending.length === 1 ? '' : 's'} to YNAB`,
    disabled: busy || pending.length === 0,
  });
  applyBtn.addEventListener('click', () => {
    void browser.runtime.sendMessage({
      type: 'apply',
      txnIds: pending.map((p) => p.txnId),
    });
  });

  const children: (Node | string)[] = [
    el('div', { className: 'row' }, [scanBtn, applyBtn]),
  ];

  if (state.message) {
    children.push(
      el('div', {
        className: `status${state.status === 'error' ? ' error' : ''}`,
        textContent: state.message,
      }),
    );
  }

  if (state.counts) {
    const { charges, credits, digitalSkipped, invoicesUnparsed } = state.counts;
    const parts = [`${String(charges)} card charges found`];
    if (credits) parts.push(`${String(credits)} refunds found`);
    if (digitalSkipped) parts.push(`${String(digitalSkipped)} digital orders skipped`);
    if (invoicesUnparsed)
      parts.push(`${String(invoicesUnparsed)} invoices could not be parsed`);
    children.push(el('div', { className: 'muted' }, [parts.join(' · ')]));
  }

  if (state.debugCaptures.length > 0 || state.scanDebug) {
    const exportBtn = el('button', {
      textContent: 'Export scan debug data',
    });
    exportBtn.addEventListener('click', () => {
      const payload = {
        captures: state.debugCaptures,
        scanDebug: state.scanDebug,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'ynab-amazon-debug.json';
      a.click();
      URL.revokeObjectURL(a.href);
    });
    children.push(exportBtn);
  }

  if (state.proposals.length > 0) {
    const list = el('ul', { className: 'proposals' });
    for (const p of state.proposals) {
      const applied = state.appliedTxnIds.includes(p.txnId);
      list.append(
        el('li', { className: applied ? 'applied' : '' }, [
          el('div', { className: 'proposal-body' }, [
            el('div', { className: 'proposal-title' }, [
              `$${p.orderTotal.toFixed(2)} · ${p.kind === 'refund' ? 'refunded' : 'charged'} ${p.orderDate} → txn ${p.txnDate}${p.splits ? ` · split ×${String(p.splits.length)}` : ''}${applied ? ' · applied ✓' : ''}`,
            ]),
            el('div', { className: 'proposal-memo' }, [p.memo]),
          ]),
        ]),
      );
    }
    children.push(list);
  }

  return el('section', {}, children);
}

function renderFooter(): HTMLElement {
  return el('footer', { className: 'muted' }, [
    el('div', {}, [
      'We are not affiliated, associated, or in any way officially connected with YNAB or any of its subsidiaries or affiliates.',
    ]),
    el('a', { href: PRIVACY_URL, target: '_blank', textContent: 'Privacy policy' }),
  ]);
}

function render(): void {
  app.replaceChildren(
    el('h1', { textContent: 'Amazon Exporter for YNAB' }),
    renderSettings(),
    renderAmazon(),
    renderSync(),
    renderFooter(),
  );
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes['syncState']) {
    void (async () => {
      state = await getState();
      render();
    })();
  }
});

void (async () => {
  [settings, state, amazonGranted, ynabConnected] = await Promise.all([
    getSettings(),
    getState(),
    browser.permissions.contains({ origins: AMAZON_ORIGINS }),
    isConnected(),
  ]);
  render();
  await loadBudgets();
  render();
})();
