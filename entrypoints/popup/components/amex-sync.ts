import { html, nothing } from 'lit';
import type { Control, ReadyView } from '@/lib/core/popup/view-model';
import type { Msg } from '@/lib/core/popup/model';
import { LightElement } from './light-element';
import { emitMsg } from './msg-event';
import { describedBy, reasonText } from './reason';
import './amex-match-list';
import './amex-unmatched-list';

export class AmexSync extends LightElement {
  static override properties = { view: { attribute: false } };
  declare view: ReadyView | null;

  constructor() {
    super();
    this.view = null;
  }

  private controlButton(control: Control, id: string, msg: Msg, primary: boolean) {
    const reasonId = `${id}-reason`;
    return html`<button
      class=${primary ? 'primary' : ''}
      ?disabled=${control.disabled}
      aria-describedby=${describedBy(reasonId, control.reason)}
      @click=${() => {
        emitMsg(this, msg);
      }}
    >
      ${control.label}
    </button>`;
  }

  protected override render() {
    const view = this.view;
    if (!view) return nothing;
    const applyPrimary = !view.apply.disabled;
    return html`<section aria-labelledby="matches-heading">
      <h2 id="matches-heading">Matches</h2>
      <div class="row">
        ${this.controlButton(view.scan, 'scan', { type: 'scanPressed' }, !applyPrimary)}
        ${this.controlButton(view.apply, 'apply', { type: 'applyPressed' }, applyPrimary)}
        ${this.controlButton(view.reset, 'reset', { type: 'resetPressed' }, false)}
      </div>
      ${reasonText('scan-reason', view.scan.reason)} ${reasonText('apply-reason', view.apply.reason)}
      <p role="status" aria-live="polite" class=${view.status.isError ? 'status error' : 'status'}>
        ${view.status.text}
      </p>
      ${view.countsLine ? html`<p class="muted">${view.countsLine}</p>` : nothing}
      ${view.canExport
        ? html`<button
            @click=${() => {
              emitMsg(this, { type: 'exportPressed' });
            }}
          >
            Download debug file
          </button>`
        : nothing}
      <amex-match-list .rows=${view.rows} .checkAll=${view.checkAll}></amex-match-list>
      <amex-unmatched-list .rows=${view.unmatched}></amex-unmatched-list>
    </section>`;
  }
}

customElements.define('amex-sync', AmexSync);
