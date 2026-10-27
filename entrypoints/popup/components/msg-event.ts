import type { Msg } from '@/lib/core/popup/model';

export const MSG_EVENT = 'msg';

export function emitMsg(host: HTMLElement, msg: Msg): void {
  host.dispatchEvent(new CustomEvent<Msg>(MSG_EVENT, { detail: msg, bubbles: true, composed: true }));
}
