import type { TemplateName } from '../notify/templates.ts';

/**
 * Every job names the order it is about and nothing else the handler could
 * read from the store instead, so a job replayed hours later acts on the
 * order as it is then, not as it was when the job was queued.
 */
export type Job =
  | { type: 'pack'; orderId: string }
  | { type: 'ship'; orderId: string }
  | { type: 'email'; orderId: string; template: TemplateName };

export type JobType = Job['type'];

export type JobOf<T extends JobType> = Extract<Job, { type: T }>;

export function describeJob(job: Job): string {
  const kind = job.type === 'email' ? `email:${job.template}` : job.type;
  return `${kind} ${job.orderId}`;
}
