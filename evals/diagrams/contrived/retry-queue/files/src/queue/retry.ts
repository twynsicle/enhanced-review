/**
 * The wait before each capture attempt after the one the request itself
 * made; an order gets as many attempts as there are entries, then it is
 * cancelled. Short at first, since most gateway trouble is a blip, and long
 * enough at the end to ride out an outage without the queue filling up.
 */
export const BACKOFF_MS: readonly number[] = [60_000, 5 * 60_000, 30 * 60_000];

export interface Retry {
  orderId: string;
  /** Kept here rather than on the order, so it is gone once the gateway has answered. */
  cardToken: string;
  /** 1 for the first retry; the capture the request made is not counted. */
  attempt: number;
  dueAt: Date;
}

export interface RetryQueue {
  /** One retry per order: scheduling an order again replaces the retry it had. */
  schedule(retry: Retry): Promise<void>;
  /** Every retry due by `now`, earliest first; each stays queued until it is removed. */
  due(now: Date): Promise<Retry[]>;
  remove(orderId: string): Promise<void>;
}

export class MemoryRetryQueue implements RetryQueue {
  private readonly retries = new Map<string, Retry>();

  schedule(retry: Retry): Promise<void> {
    this.retries.set(retry.orderId, retry);
    return Promise.resolve();
  }

  due(now: Date): Promise<Retry[]> {
    const due = [...this.retries.values()].filter((retry) => retry.dueAt <= now);
    return Promise.resolve(due.toSorted((a, b) => a.dueAt.getTime() - b.dueAt.getTime()));
  }

  remove(orderId: string): Promise<void> {
    this.retries.delete(orderId);
    return Promise.resolve();
  }
}

/** Queues attempt `attempt` for the order; false when the backoff has no attempt that late. */
export async function queueRetry(
  retries: RetryQueue,
  retry: Omit<Retry, 'dueAt'>,
  now: Date,
): Promise<boolean> {
  const wait = BACKOFF_MS[retry.attempt - 1];
  if (wait === undefined) return false;
  await retries.schedule({ ...retry, dueAt: new Date(now.getTime() + wait) });
  return true;
}

/** The one retry queue the service and the CLI open. */
export function openRetryQueue(): RetryQueue {
  return new MemoryRetryQueue();
}
