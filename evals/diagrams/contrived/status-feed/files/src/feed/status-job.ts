import type { JobOf } from '../queue/jobs.ts';
import type { Warehouse } from './warehouse.ts';

export interface StatusDeps {
  warehouse: Warehouse;
}

export function statusHandler({ warehouse }: StatusDeps): (job: JobOf<'status'>) => Promise<void> {
  return (job) => warehouse.send({ orderId: job.orderId, status: job.status, at: job.at });
}
