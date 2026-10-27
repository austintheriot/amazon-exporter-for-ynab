import { html, nothing } from 'lit';
import type { UnmatchedRow } from '@/lib/core/popup/view-model';
import { LightElement } from './light-element';

export class AmexUnmatchedList extends LightElement {
  static override properties = { rows: { attribute: false } };
  declare rows: UnmatchedRow[] | null;

  constructor() {
    super();
    this.rows = null;
  }

  protected override render() {
    if (!this.rows || this.rows.length === 0) return nothing;
    return html`<details class="unmatched">
      <summary>Not matched (${this.rows.length})</summary>
      <ul>
        ${this.rows.map(
          (row) => html`<li>
            <span class="proposal-title">${row.amount} ${row.title}</span>
            <span class="muted">${row.reason}</span>
          </li>`,
        )}
      </ul>
    </details>`;
  }
}

customElements.define('amex-unmatched-list', AmexUnmatchedList);
