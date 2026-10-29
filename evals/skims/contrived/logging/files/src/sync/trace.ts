import { randomBytes } from 'node:crypto';

/** A short id that ties one run's log lines together. */
export function newTraceId(): string {
  return randomBytes(6).toString('hex');
}

/** Counters a run accumulates, logged once at the end. */
export class RunCounters {
  private readonly counts = new Map<string, number>();

  add(name: string, by = 1): void {
    this.counts.set(name, (this.counts.get(name) ?? 0) + by);
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries([...this.counts.entries()].toSorted());
  }
}
