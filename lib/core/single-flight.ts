export interface SingleFlight {
  /** Starts `job` unless one is running; returns null when refused. */
  run(job: () => Promise<void>): Promise<void> | null;
}

export function createSingleFlight(): SingleFlight {
  let running = false;
  return {
    run: (job) => {
      if (running) return null;
      running = true;
      return job().finally(() => {
        running = false;
      });
    },
  };
}
