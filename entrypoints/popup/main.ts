import type { Msg } from '@/lib/core/popup/model';
import { viewModel } from '@/lib/core/popup/view-model';
import { createPopupServices } from '@/lib/shell/popup-services';
import type { AmexApp } from './components/amex-app';
import { MSG_EVENT } from './components/msg-event';
import { createPopupRuntime } from './runtime';
import './components/amex-app';

const mount = document.getElementById('app');
if (!mount) throw new Error('Popup markup has no #app element');

const app = document.createElement('amex-app') as AmexApp;
mount.replaceChildren(app);

const runtime = createPopupRuntime(createPopupServices());
app.addEventListener(MSG_EVENT, (event) => {
  runtime.dispatch((event as CustomEvent<Msg>).detail);
});
runtime.subscribe((model) => {
  app.view = viewModel(model);
});
app.view = viewModel(runtime.getModel());
addEventListener('pagehide', () => {
  runtime.dispose();
});
