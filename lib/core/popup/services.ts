import type { Message, Settings } from '../state';
import type { YnabBudget } from '../ynab';
import type { BootSnapshot, Msg } from './model';

/** Every IO the popup performs. The runtime is the only caller. */
export interface Services {
  clock: { nowIso(): string };
  boot: { read(): Promise<Omit<BootSnapshot, 'now'>> };
  /** Emits syncStateChanged, settingsChanged, tokenChanged, ynabAuthChanged. */
  watch(onMsg: (msg: Msg) => void): () => void;
  settings: { patch(patch: Partial<Settings>): Promise<void> };
  ynab: { loadBudgets(): Promise<YnabBudget[]>; disconnect(): Promise<void> };
  amazon: { requestPermission(): Promise<boolean>; openLogin(): Promise<void> };
  background: { send(message: Message): Promise<void> };
  files: { download(name: string, json: string): void };
  logger: { error(context: string, detail: string): void };
  ticker: { every(ms: number, onTick: () => void): () => void };
}
