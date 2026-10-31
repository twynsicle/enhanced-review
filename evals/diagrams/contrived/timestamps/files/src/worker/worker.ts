import { errorFields, log } from '../logger.ts';
import { describeJob, type Job, type JobOf, type JobType } from '../queue/jobs.ts';
import type { Queue } from '../queue/queue.ts';

export type Handlers = { [T in JobType]: (job: JobOf<T>) => Promise<void> };

export const MAX_ATTEMPTS = 2;

/** Takes one job and runs it; false when the queue had nothing to take. */
export async function processOne(queue: Queue, handlers: Handlers): Promise<boolean> {
  const envelope = await queue.take();
  if (!envelope) return false;
  const { job, attempts } = envelope;
  const handler = handlers[job.type] as (job: Job) => Promise<void>;
  try {
    await handler(job);
    await queue.ack(envelope.id);
  } catch (error) {
    const fields = {
      job: describeJob(job),
      orderId: job.orderId,
      attempt: attempts,
      ...errorFields(error),
    };
    if (attempts < MAX_ATTEMPTS) {
      log.warn('job failed, queued again', fields);
      await queue.release(envelope.id);
    } else {
      log.error('job dropped', fields);
      await queue.ack(envelope.id);
    }
  }
  return true;
}

export interface Worker {
  /** Resolves once the job in hand, if any, has finished. */
  stop(): Promise<void>;
}

export function startWorker(queue: Queue, handlers: Handlers, idleMs: number): Worker {
  let running = true;
  const loop = (async () => {
    while (running) {
      const worked = await processOne(queue, handlers);
      if (!worked) await new Promise((resolve) => setTimeout(resolve, idleMs));
    }
  })();
  return {
    stop: () => {
      running = false;
      return loop;
    },
  };
}
