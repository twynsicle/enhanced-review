/**
 * In-process registry of running jobs: one AbortController per job so the
 * cancel action, the timeout and process shutdown can stop it. Lives on
 * `globalThis` under a `Symbol.for` key because Vite evaluates its own
 * instance of this module in development and the Express bootstrap in
 * `server/index.ts` runs natively outside that graph: both must see the same
 * map. The bootstrap reaches it through `JOBS_REGISTRY_KEY` to abort and
 * drain on SIGTERM/SIGINT.
 *
 * Sized for a handful of concurrent jobs in one Node process — the reason
 * the server must never run under a forking manager.
 */
export type AbortReason = 'cancel' | 'timeout' | 'shutdown';

export interface JobRegistry {
  register(jobId: string, controller: AbortController): void;
  /** Attach the runner's completion promise so `drain` can wait for it. */
  track(jobId: string, done: Promise<unknown>): void;
  /** Abort one job; false when it is not running in this process. */
  signal(jobId: string, reason: AbortReason): boolean;
  unregister(jobId: string): void;
  /** Abort every running job; returns how many were signalled. */
  abortAll(reason: AbortReason): number;
  /** Resolve once every tracked runner has settled, or after `timeoutMs`. */
  drain(timeoutMs: number): Promise<void>;
  size(): number;
}

/** What `server/index.ts` needs at shutdown; kept narrow on purpose. */
export type JobRegistryHandle = Pick<JobRegistry, 'abortAll' | 'drain' | 'size'>;

export const JOBS_REGISTRY_KEY: unique symbol = Symbol.for('enhanced-review.jobs.registry');

interface Entry {
  controller: AbortController;
  done: Promise<unknown> | null;
}

export function createRegistry(): JobRegistry {
  const entries = new Map<string, Entry>();
  return {
    register(jobId, controller) {
      entries.set(jobId, { controller, done: null });
    },
    track(jobId, done) {
      const entry = entries.get(jobId);
      if (entry) entry.done = done;
    },
    signal(jobId, reason) {
      const entry = entries.get(jobId);
      if (!entry) return false;
      entry.controller.abort(reason);
      return true;
    },
    unregister(jobId) {
      entries.delete(jobId);
    },
    abortAll(reason) {
      let count = 0;
      for (const entry of entries.values()) {
        if (entry.controller.signal.aborted) continue;
        entry.controller.abort(reason);
        count += 1;
      }
      return count;
    },
    async drain(timeoutMs) {
      const pending = [...entries.values()].flatMap((e) => (e.done ? [e.done] : []));
      if (pending.length === 0) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      });
      try {
        await Promise.race([Promise.allSettled(pending), timeout]);
      } finally {
        clearTimeout(timer);
      }
    },
    size() {
      return entries.size;
    },
  };
}

const globalSlot = globalThis as unknown as Record<
  typeof JOBS_REGISTRY_KEY,
  JobRegistry | undefined
>;

/** The process-wide registry. */
export const registry: JobRegistry = (globalSlot[JOBS_REGISTRY_KEY] ??= createRegistry());
