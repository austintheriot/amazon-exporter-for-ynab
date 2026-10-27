import { LitElement } from 'lit';

/** Renders into light DOM so the popup's one stylesheet and ARIA id
 * references reach every component. */
export class LightElement extends LitElement {
  protected override createRenderRoot(): HTMLElement {
    return this;
  }
}
