export interface RunToken {
  readonly generation: number;
}

export interface RunGuard {
  start(): RunToken;
  cancelAll(): void;
  isCurrent(run: RunToken): boolean;
  signal(run: RunToken): AbortSignal;
}

export function createRunGuard(): RunGuard {
  let generation = 0;
  let controller = new AbortController();
  const isCurrent = (run: RunToken) => run.generation === generation;
  return {
    start: () => ({ generation }),
    cancelAll: () => {
      generation++;
      controller.abort();
      controller = new AbortController();
    },
    isCurrent,
    signal: (run) => (isCurrent(run) ? controller.signal : AbortSignal.abort()),
  };
}
