import { describeJob, type Job } from '../queue/jobs.ts';
import { MemoryQueue } from '../queue/queue.ts';
import { BACKOFF_MS, openRetryQueue, type Retry } from '../queue/retry.ts';
import { findAbandoned, findStuck } from '../scheduler/sweeps.ts';
import { migrate } from '../store/migrate.ts';
import { openStore, requireOrder } from '../store/store.ts';
import type { Order } from '../orders/order.ts';

const USAGE = `usage: packhouse show <id> | reprocess <id> | stuck`;

async function main(argv: string[]): Promise<void> {
  const [command, id] = argv;
  const store = openStore();
  await migrate(store);
  switch (command) {
    case 'show': {
      const order = await requireOrder(store, need(id));
      process.stdout.write(`${JSON.stringify(order, null, 2)}\n`);
      return;
    }
    case 'reprocess': {
      const order = await requireOrder(store, need(id));
      const job = nextJob(order);
      if (!job) throw new Error(`order ${order.id} is ${order.status}; nothing to run for it`);
      await new MemoryQueue().enqueue(job);
      process.stdout.write(`queued ${describeJob(job)}\n`);
      return;
    }
    case 'stuck': {
      const now = new Date();
      for (const order of await findAbandoned(store, now)) line('abandoned', order, now);
      for (const order of await findStuck(store, now)) line('stuck', order, now);
      for (const retry of await openRetryQueue().due(now)) retryLine(retry, now);
      return;
    }
    default:
      throw new Error(USAGE);
  }
}

function need(id: string | undefined): string {
  if (!id) throw new Error(USAGE);
  return id;
}

/** The job the worker would run next for an order, if it has one. */
function nextJob(order: Order): Job | null {
  switch (order.status) {
    case 'paid':
      return { type: 'pack', orderId: order.id };
    case 'packing':
      return { type: 'ship', orderId: order.id };
    default:
      return null;
  }
}

function line(kind: string, order: Order, now: Date): void {
  const hours = ((now.getTime() - order.updatedAt.getTime()) / 3_600_000).toFixed(1);
  process.stdout.write(`${kind}\t${order.id}\t${order.status}\t${hours}h\n`);
}

function retryLine(retry: Retry, now: Date): void {
  const minutes = ((now.getTime() - retry.dueAt.getTime()) / 60_000).toFixed(1);
  const attempt = `attempt ${retry.attempt} of ${BACKOFF_MS.length}`;
  process.stdout.write(`retry\t${retry.orderId}\t${attempt}\t${minutes}m overdue\n`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(1);
});
