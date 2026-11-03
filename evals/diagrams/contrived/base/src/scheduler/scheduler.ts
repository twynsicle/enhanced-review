import { errorFields, log } from '../logger.ts';

export interface Sweep {
  name: string;
  intervalMs: number;
  /** Resolves to how many orders it touched. */
  run(now: Date): Promise<number>;
}

export interface Scheduler {
  stop(): void;
}

/**
 * Each sweep ticks on its own interval. A tick that lands while the previous
 * run of the same sweep is still going is skipped rather than queued, so a
 * slow store cannot pile up runs that would all touch the same orders.
 */
export function startScheduler(sweeps: Sweep[], clock: () => Date): Scheduler {
  const timers = sweeps.map((sweep) => {
    let running = false;
    const tick = async () => {
      if (running) {
        log.warn('sweep still running, tick skipped', { sweep: sweep.name });
        return;
      }
      running = true;
      try {
        const touched = await sweep.run(clock());
        if (touched > 0) log.info('sweep finished', { sweep: sweep.name, touched });
      } catch (error) {
        log.error('sweep failed', { sweep: sweep.name, ...errorFields(error) });
      } finally {
        running = false;
      }
    };
    return setInterval(() => void tick(), sweep.intervalMs);
  });
  return {
    stop: () => {
      for (const timer of timers) clearInterval(timer);
    },
  };
}
