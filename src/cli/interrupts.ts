/**
 * Cleanup that must run if `er` is interrupted: the stages register it here,
 * and `er.ts`, the only place that installs signal handlers, runs it on
 * SIGINT (Ctrl+C) or SIGTERM before exiting 130 or 143. Each cleanup is
 * synchronous, because the process exits straight after.
 */
const cleanups = new Set<() => void>();

/** Registers a cleanup; the returned function unregisters it. */
export function onInterrupt(cleanup: () => void): () => void {
  cleanups.add(cleanup);
  return () => {
    cleanups.delete(cleanup);
  };
}

/** Runs every registered cleanup once, each on its own so one failure cannot skip the rest. */
export function runInterruptCleanups(): void {
  // Deleting the entry being visited is safe while iterating a Set.
  for (const cleanup of cleanups) {
    cleanups.delete(cleanup);
    try {
      cleanup();
    } catch {
      // Best effort: the next run's sweep catches what this missed.
    }
  }
}
