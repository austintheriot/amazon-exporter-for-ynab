import { html, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import type { MatchRow, ReadyView } from '@/lib/core/popup/view-model';
import { LightElement } from './light-element';
import { emitMsg } from './msg-event';

export class AmexMatchList extends LightElement {
  static override properties = { rows: { attribute: false }, checkAll: { attribute: false } };
  declare rows: MatchRow[];
  declare checkAll: ReadyView['checkAll'];

  constructor() {
    super();
    this.rows = [];
    this.checkAll = { checked: false, indeterminate: false, disabled: true };
  }

  protected override render() {
    if (this.rows.length === 0) return nothing;
    return html`<label class="check-all">
        <input
          type="checkbox"
          .checked=${live(this.checkAll.checked)}
          .indeterminate=${this.checkAll.indeterminate}
          ?disabled=${this.checkAll.disabled}
          @change=${() => {
            emitMsg(this, { type: 'allToggled' });
          }}
        />
        Check all
      </label>
      <ul class="proposals">
        ${this.rows.map(
          (row) => html`<li class=${row.applied ? 'applied' : ''}>
            <label>
              <input
                type="checkbox"
                .checked=${live(row.checked)}
                ?disabled=${row.applied}
                @change=${() => {
                  emitMsg(this, { type: 'rowToggled', txnId: row.txnId });
                }}
              />
              <span class="proposal-body">
                <span class="proposal-title">${row.amount} ${row.title}</span>
                <span class="proposal-memo">${row.memo}</span>
                ${row.meta ? html`<span class="muted">${row.meta}</span>` : nothing}
              </span>
            </label>
          </li>`,
        )}
      </ul>`;
  }
}

customElements.define('amex-match-list', AmexMatchList);
