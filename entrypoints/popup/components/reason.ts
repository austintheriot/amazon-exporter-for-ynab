import { html, nothing } from 'lit';

export function reasonText(id: string, reason: string | null) {
  return reason ? html`<p class="reason" id=${id}>${reason}</p>` : nothing;
}

export function describedBy(id: string, reason: string | null) {
  return reason ? id : nothing;
}
