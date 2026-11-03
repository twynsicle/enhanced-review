import type { TemplateName } from '../notify/templates.ts';
import type { OrderStatus } from '../orders/order.ts';

/**
 * Every job names the order it is about and nothing else the handler could
 * read from the store instead, so a job replayed hours later acts on the
 * order as it is then, not as it was when the job was queued. A status job
 * is the exception: it reports a move that has already happened, and by the
 * time it runs the order may have moved again.
 */
export type Job =
  | { type: 'pack'; orderId: string }
  | { type: 'ship'; orderId: string }
  | { type: 'email'; orderId: string; template: TemplateName }
  | { type: 'status'; orderId: string; status: OrderStatus; at: string };

export type JobType = Job['type'];

export type JobOf<T extends JobType> = Extract<Job, { type: T }>;

export function describeJob(job: Job): string {
  const kind =
    job.type === 'email'
      ? `email:${job.template}`
      : job.type === 'status'
        ? `status:${job.status}`
        : job.type;
  return `${kind} ${job.orderId}`;
}
