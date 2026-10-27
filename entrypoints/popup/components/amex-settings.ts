import { html, nothing } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import { YNAB_SIGN_IN_OPEN } from '@/lib/core/copy';
import type { YnabView } from '@/lib/core/popup/view-model';
import { LightElement } from './light-element';
import { emitMsg } from './msg-event';
import { describedBy, reasonText } from './reason';

export class AmexSettings extends LightElement {
  static override properties = { view: { attribute: false } };
  declare view: YnabView;

  constructor() {
    super();
    this.view = { kind: 'not-configured' };
  }

  protected override render() {
    return html`<section aria-labelledby="ynab-heading">
      <h2 id="ynab-heading">YNAB</h2>
      ${this.renderBody()}
    </section>`;
  }

  private renderBody() {
    const view = this.view;
    switch (view.kind) {
      case 'not-configured':
        return html`<p class="status error">OAuth client ID is not configured. See the README.</p>`;
      case 'disconnected': {
        const reason = view.connecting ? YNAB_SIGN_IN_OPEN : null;
        return html`<p>Authorize read and write access to your YNAB budget.</p>
          <button
            class="primary"
            ?disabled=${view.connecting}
            aria-describedby=${describedBy('connect-reason', reason)}
            @click=${() => {
              emitMsg(this, { type: 'connectYnabPressed' });
            }}
          >
            Connect YNAB
          </button>
          ${reasonText('connect-reason', reason)}
          ${view.error ? html`<p class="status error">${view.error}</p>` : nothing}`;
      }
      case 'connected':
        return html`${view.budgetError ? html`<p class="status error">${view.budgetError}</p>` : nothing}
          <label
            >Budget
            <select
              @change=${(event: Event) => {
                emitMsg(this, { type: 'budgetPicked', budgetId: (event.target as HTMLSelectElement).value });
              }}
            >
              <option value="" ?selected=${!view.budgetOptions.some((option) => option.selected)}>
                Select budget…
              </option>
              ${view.budgetOptions.map(
                (option) => html`<option value=${option.id} ?selected=${option.selected}>${option.name}</option>`,
              )}
            </select>
          </label>
          <div class="row">
            <label
              >Orders from
              <select
                @change=${(event: Event) => {
                  const value = (event.target as HTMLSelectElement).value;
                  emitMsg(this, { type: 'yearPicked', year: value ? Number(value) : null });
                }}
              >
                ${view.yearOptions.map(
                  (option) =>
                    html`<option value=${option.value === null ? '' : String(option.value)} ?selected=${option.selected}>
                      ${option.label}
                    </option>`,
                )}
              </select>
            </label>
            <label
              >Max orders
              <input
                type="number"
                min="1"
                max="200"
                .value=${String(view.orderLimit)}
                aria-describedby=${ifDefined(view.orderLimitHint ? 'limit-hint' : undefined)}
                @change=${(event: Event) => {
                  emitMsg(this, { type: 'orderLimitEntered', raw: (event.target as HTMLInputElement).value });
                }}
              />
            </label>
          </div>
          ${reasonText('limit-hint', view.orderLimitHint)}
          <button
            @click=${() => {
              emitMsg(this, { type: 'disconnectYnabPressed' });
            }}
          >
            Disconnect YNAB
          </button>`;
    }
  }
}

customElements.define('amex-settings', AmexSettings);
