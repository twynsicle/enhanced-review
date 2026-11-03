import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { transition, type Order } from '../orders/order.ts';
import type { Job } from '../queue/jobs.ts';
import { MemoryQueue } from '../queue/queue.ts';
import { migrate } from '../store/migrate.ts';
import { MemoryStore } from '../store/store.ts';
import { statusHandler } from './status-job.ts';
import { withStatusFeed } from './status-feed.ts';
import type { StatusEvent } from './warehouse.ts';

const placed: Order = {
  id: 'ord_1',
  status: 'placed',
  email: 'ana@example.com',
  lines: [{ sku: 'MUG-01', quantity: 1, unitPrice: 1200 }],
  address: { name: 'Ana', line1: '1 High St', city: 'Leeds', postcode: 'LS1 4AP', country: 'GB' },
  total: 1200,
  paymentReference: null,
  refundReference: null,
  createdAt: new Date('2024-05-01T10:00:00Z'),
  updatedAt: new Date('2024-05-01T10:00:00Z'),
};

async function fed() {
  const inner = new MemoryStore();
  await migrate(inner);
  const queue = new MemoryQueue();
  return { store: withStatusFeed(inner, queue), inner, queue };
}

async function queued(queue: MemoryQueue): Promise<Job[]> {
  const jobs: Job[] = [];
  for (let envelope = await queue.take(); envelope; envelope = await queue.take()) {
    jobs.push(envelope.job);
  }
  return jobs;
}

describe('withStatusFeed', () => {
  it('queues the first status of a new order and every move after it', async () => {
    const { store, queue } = await fed();
    await store.putOrder(placed);
    const paid = transition(placed, 'paid', new Date('2024-05-01T10:00:02Z'));
    await store.putOrder(paid);
    await store.putOrder(transition(paid, 'packing', new Date('2024-05-01T10:05:00Z')));
    assert.deepEqual(await queued(queue), [
      { type: 'status', orderId: 'ord_1', status: 'placed', at: '2024-05-01T10:00:00.000Z' },
      { type: 'status', orderId: 'ord_1', status: 'paid', at: '2024-05-01T10:00:02.000Z' },
      { type: 'status', orderId: 'ord_1', status: 'packing', at: '2024-05-01T10:05:00.000Z' },
    ]);
  });

  it('queues nothing for a write that leaves the status alone', async () => {
    const { store, queue } = await fed();
    await store.putOrder(placed);
    await queued(queue);
    await store.putOrder({ ...placed, refundReference: 're_1' });
    assert.deepEqual(await queued(queue), []);
  });

  it('stores the order whatever it queues', async () => {
    const { store, inner } = await fed();
    await store.putOrder(placed);
    assert.equal((await inner.getOrder('ord_1'))?.status, 'placed');
  });
});

describe('statusHandler', () => {
  it('sends the move the job carries, not the order as it is now', async () => {
    const sent: StatusEvent[] = [];
    const handle = statusHandler({
      warehouse: {
        send: (event) => {
          sent.push(event);
          return Promise.resolve();
        },
      },
    });
    await handle({ type: 'status', orderId: 'ord_1', status: 'paid', at: '2024-05-01T10:00:02.000Z' });
    assert.deepEqual(sent, [{ orderId: 'ord_1', status: 'paid', at: '2024-05-01T10:00:02.000Z' }]);
  });
});
