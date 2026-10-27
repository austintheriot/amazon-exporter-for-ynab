import { html } from 'lit';
import { LightElement } from './light-element';
import { emitMsg } from './msg-event';

export class AmexAmazon extends LightElement {
  static override properties = { granted: { type: Boolean } };
  declare granted: boolean;

  constructor() {
    super();
    this.granted = false;
  }

  protected override render() {
    return html`<section aria-labelledby="amazon-heading">
      <h2 id="amazon-heading">Amazon</h2>
      ${this.granted
        ? html`<p>Amazon access granted. <span class="muted">Stay signed in to amazon.com in this browser.</span></p>`
        : html`<p>Allow access to read your Amazon order history.</p>
            <button
              class="primary"
              @click=${() => {
                emitMsg(this, { type: 'connectAmazonPressed' });
              }}
            >
              Connect Amazon
            </button>`}
    </section>`;
  }
}

customElements.define('amex-amazon', AmexAmazon);
