// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { Msg, ReadyModel } from '@/lib/core/popup/model';
import { readyModel, scannedSync } from '@/lib/core/popup/test-model';
import { pendingIds } from '@/lib/core/popup/update';
import { viewModel, type PopupView } from '@/lib/core/popup/view-model';
import { MSG_EVENT } from './msg-event';
import './amex-app';

type Updatable = Element & { updateComplete?: Promise<unknown> };

async function settle(root: Element): Promise<void> {
  for (let pass = 0; pass < 3; pass++) {
    const elements: Updatable[] = [root, ...root.querySelectorAll('*')];
    await Promise.all(elements.map((element) => element.updateComplete ?? Promise.resolve()));
  }
}

function scannedView(overrides: Partial<ReadyModel> = {}): PopupView {
  const sync = overrides.sync ?? scannedSync();
  return viewModel(
    readyModel({ selection: new Set(pendingIds(sync)), selectionScanAt: sync.lastScanAt, ...overrides, sync }),
  );
}

async function mount(view: PopupView) {
  const app = document.createElement('amex-app') as HTMLElement & { view: PopupView };
  app.view = view;
  const msgs: Msg[] = [];
  app.addEventListener(MSG_EVENT, (event) => {
    msgs.push((event as CustomEvent<Msg>).detail);
  });
  document.body.replaceChildren(app);
  await settle(app);
  return { app, msgs };
}

function checkbox(root: Element, labelText: string): HTMLInputElement {
  const label = [...root.querySelectorAll('label')].find((candidate) =>
    candidate.textContent.includes(labelText),
  );
  const input = label?.querySelector('input[type="checkbox"]');
  if (!(input instanceof HTMLInputElement)) throw new Error(`no checkbox labelled ${labelText}`);
  return input;
}

function button(root: Element, text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find((candidate) => candidate.textContent.includes(text));
  if (!found) throw new Error(`no button ${text}`);
  return found;
}

describe('<amex-app>', () => {
  it('check all emits allToggled', async () => {
    const { app, msgs } = await mount(scannedView());
    checkbox(app, 'Check all').click();
    expect(msgs).toContainEqual({ type: 'allToggled' });
  });

  it('check all shows indeterminate when some rows are checked', async () => {
    const { app } = await mount(scannedView({ selection: new Set(['txn-1']) }));
    const input = checkbox(app, 'Check all');
    expect(input.indeterminate).toBe(true);
    expect(input.checked).toBe(false);
  });

  it('a row checkbox emits rowToggled with its YNAB transaction ID', async () => {
    const { app, msgs } = await mount(scannedView());
    const rows = app.querySelectorAll('ul.proposals input[type="checkbox"]');
    const second = rows[1];
    if (!(second instanceof HTMLInputElement)) throw new Error('expected two row checkboxes');
    second.click();
    expect(msgs).toContainEqual({ type: 'rowToggled', txnId: 'txn-2' });
  });

  it('the status element is the same node after a view update', async () => {
    const { app } = await mount(scannedView());
    const status = app.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    app.view = scannedView({
      sync: scannedSync({ status: 'applying', message: 'Writing 2 memos to YNAB…' }),
    });
    await settle(app);
    const after = app.querySelector('[role="status"]');
    expect(after).toBe(status);
    expect(after?.textContent).toContain('Writing 2 memos to YNAB…');
  });

  it('a disabled Apply shows its reason', async () => {
    const { app } = await mount(
      scannedView({ settings: { ...readyModel().settings, budgetId: 'b2', budgetName: 'Personal' } }),
    );
    const apply = button(app, 'Apply');
    expect(apply.disabled).toBe(true);
    const describedBy = apply.getAttribute('aria-describedby') ?? '';
    const reason = describedBy ? app.querySelector(`#${describedBy}`) : null;
    expect(reason?.textContent).toContain('These matches are from budget Household.');
  });

  it('the unmatched list is absent when unmatched is null', async () => {
    const { app } = await mount(scannedView());
    expect(app.querySelector('details')).toBeNull();
  });

  it('lists unmatched charges with their reasons', async () => {
    const scanDebug = {
      charges: [{ orderId: '111-0000000-0000009', date: '2026-10-15', amount: 67.38, paymentMethod: 'Visa' }],
      credits: [],
      candidates: [],
    };
    const { app } = await mount(scannedView({ sync: scannedSync({ scanDebug }) }));
    expect(app.querySelector('details summary')?.textContent).toContain('Not matched (1)');
    expect(app.querySelector('details')?.textContent).toContain('No Amazon YNAB transaction for this amount.');
  });

  it('Scan emits scanPressed', async () => {
    const { app, msgs } = await mount(scannedView());
    button(app, 'Scan').click();
    expect(msgs).toContainEqual({ type: 'scanPressed' });
  });
});
