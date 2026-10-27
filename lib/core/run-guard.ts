export interface RunToken {
  readonly generation: number;
}

export interface RunGuard {
  start(): RunToken;
  cancelAll(): void;
  isCurrent(run: RunToken): boolean;
}

export function createRunGuard(): RunGuard {
  let generation = 0;
  return {
    start: () => ({ generation }),
    cancelAll: () => {
      generation++;
    },
    isCurrent: (run) => run.generation === generation,
  };
}
