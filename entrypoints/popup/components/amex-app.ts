import { html } from 'lit';
import type { PopupView } from '@/lib/core/popup/view-model';
import { LightElement } from './light-element';
import './amex-amazon';
import './amex-settings';
import './amex-sync';

const PRIVACY_URL = 'https://github.com/jparavisini/amazon-exporter-for-ynab/blob/main/PRIVACY.md';

export class AmexApp extends LightElement {
  static override properties = { view: { attribute: false } };
  declare view: PopupView;

  constructor() {
    super();
    this.view = { kind: 'booting' };
  }

  private renderBody() {
    const view = this.view;
    switch (view.kind) {
      case 'booting':
        return html`<p class="muted">Loading…</p>`;
      case 'boot-failed':
        return html`<p class="status error">${view.message}</p>`;
      case 'ready':
        return html`<amex-settings .view=${view.ynab}></amex-settings>
          <amex-amazon .granted=${view.amazonGranted}></amex-amazon>
          <amex-sync .view=${view}></amex-sync>`;
    }
  }

  protected override render() {
    return html`<main>
      <h1>Amazon Exporter for YNAB</h1>
      ${this.renderBody()}
      <footer class="muted">
        <p>
          We are not affiliated, associated, or in any way officially connected with YNAB or any of its
          subsidiaries or affiliates.
        </p>
        <a href=${PRIVACY_URL} target="_blank" rel="noopener">Privacy policy</a>
      </footer>
    </main>`;
  }
}

customElements.define('amex-app', AmexApp);
