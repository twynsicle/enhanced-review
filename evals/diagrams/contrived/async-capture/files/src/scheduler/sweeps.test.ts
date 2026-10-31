import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Order, OrderStatus } from '../orders/order.ts';
import { MemoryQueue } from '../queue/queue.ts';
import { migrate } from '../store/migrate.ts';
import { MemoryStore } from '../store/store.ts';
import { abandonedOrders, findAbandoned, stuckShipments, unansweredCaptures } from './sweeps.ts';

const now = new Date('2024-05-02T12:00:00Z');

const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000);

function order(id: string, status: OrderStatus, at: Date, reference: string | null = null): Order {
  return {
    id,
    status,
    email: 'ana@example.com',
    lines: [{ sku: 'MUG-01', quantity: 1, unitPrice: 1200 }],
    address: { name: 'Ana', line1: '1 High St', city: 'Leeds', postcode: 'LS1 4AP', country: 'GB' },
    total: 1595,
    paymentReference: status === 'placed' ? reference : 'cap_1',
    refundReference: null,
    createdAt: at,
    updatedAt: at,
  };
}

async function store(...orders: Order[]): Promise<MemoryStore> {
  const s = new MemoryStore();
  await migrate(s);
  for (const o of orders) await s.putOrder(o);
  return s;
}

describe('abandonedOrders', () => {
  it('cancels an order left placed for over a day', async () => {
    const old = order('old', 'placed', hoursAgo(30));
    const recent = order('new', 'placed', hoursAgo(1));
    const s = await store(old, recent);
    assert.equal(await abandonedOrders(s, now), 1);
    assert.equal((await s.getOrder('old'))?.status, 'cancelled');
    assert.equal((await s.getOrder('new'))?.status, 'placed');
  });

  it('leaves a paid order alone however old it is', async () => {
    const s = await store(order('paid', 'paid', hoursAgo(72)));
    assert.deepEqual(await findAbandoned(s, now), []);
  });

  it('leaves an order with a pending capture to the unanswered sweep', async () => {
    const s = await store(order('pending', 'placed', hoursAgo(30), 'cap_1'));
    assert.deepEqual(await findAbandoned(s, now), []);
  });
});

describe('unansweredCaptures', () => {
  it('cancels an order whose capture has had no answer for over an hour', async () => {
    const quiet = order('quiet', 'placed', hoursAgo(2), 'cap_1');
    const recent = order('recent', 'placed', hoursAgo(0.5), 'cap_1');
    const unasked = order('unasked', 'placed', hoursAgo(2));
    const s = await store(quiet, recent, unasked);
    assert.equal(await unansweredCaptures(s, now), 1);
    assert.equal((await s.getOrder('quiet'))?.status, 'cancelled');
    assert.equal((await s.getOrder('recent'))?.status, 'placed');
    assert.equal((await s.getOrder('unasked'))?.status, 'placed');
  });
});

describe('stuckShipments', () => {
  it('queues the ship job again for an order packing for over two hours', async () => {
    const stuck = order('stuck', 'packing', hoursAgo(3));
    const fresh = order('fresh', 'packing', hoursAgo(1));
    const s = await store(stuck, fresh);
    const queue = new MemoryQueue();
    assert.equal(await stuckShipments(s, queue, now), 1);
    assert.deepEqual((await queue.take())?.job, { type: 'ship', orderId: 'stuck' });
    assert.equal(await queue.take(), null);
  });

  it('touches the order so the next tick does not queue it a second time', async () => {
    const s = await store(order('stuck', 'packing', hoursAgo(3)));
    const queue = new MemoryQueue();
    await stuckShipments(s, queue, now);
    assert.equal(await stuckShipments(s, queue, now), 0);
    assert.equal((await s.getOrder('stuck'))?.updatedAt, now);
    assert.equal((await s.getOrder('stuck'))?.status, 'packing');
  });
});
