import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import type { Order, OrderStatus } from '../../orders/order.ts';
import { describeJob } from '../../queue/jobs.ts';
import { MemoryQueue } from '../../queue/queue.ts';
import { migrate } from '../../store/migrate.ts';
import { MemoryStore } from '../../store/store.ts';
import { runChain } from '../server.ts';
import { webhookRoutes } from './webhooks.ts';

const SECRET = 'whsec_test';
const now = new Date('2024-05-03T09:00:00Z');
const refund = { event: 'refund', merchantReference: 'ord_1', refundReference: 'ref_9' };
const completed = { event: 'capture.completed', merchantReference: 'ord_1' };

const paid: Order = {
  id: 'ord_1',
  status: 'paid',
  email: 'ana@example.com',
  lines: [{ sku: 'MUG-01', quantity: 1, unitPrice: 1200 }],
  address: { name: 'Ana', line1: '1 High St', city: 'Leeds', postcode: 'LS1 4AP', country: 'GB' },
  total: 1595,
  paymentReference: 'cap_1',
  refundReference: null,
  createdAt: now,
  updatedAt: now,
};

function sign(text: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(text).digest('hex');
}

async function post(body: unknown, status: OrderStatus = 'paid', signature?: string) {
  const store = new MemoryStore();
  await migrate(store);
  await store.putOrder({ ...paid, status });
  const queue = new MemoryQueue();
  const [route] = webhookRoutes(SECRET, { store, queue, clock: () => now });
  const text = JSON.stringify(body);
  const headers = { 'x-cardflow-signature': signature ?? sign(text) };
  const ctx = { method: 'POST', path: route!.path, params: {}, headers, text, body: undefined };
  const reply = await runChain(route!, ctx);
  return { reply, order: await store.getOrder('ord_1'), queue };
}

describe('POST /webhooks/payment', () => {
  it('records the refund reference on the order', async () => {
    const { reply, order } = await post(refund);
    assert.deepEqual(reply, { status: 200, body: { handled: true } });
    assert.equal(order?.refundReference, 'ref_9');
  });

  it('moves a placed order to paid when its capture completes, and queues its jobs', async () => {
    const { order, queue } = await post(completed, 'placed');
    assert.equal(order?.status, 'paid');
    const jobs = [(await queue.take())!.job, (await queue.take())!.job];
    assert.deepEqual(jobs.map(describeJob), ['pack ord_1', 'email:confirmed ord_1']);
  });

  it('cancels a placed order when its capture is declined', async () => {
    const notice = { event: 'capture.declined', merchantReference: 'ord_1', reason: 'expired' };
    const { order, queue } = await post(notice, 'placed');
    assert.equal(order?.status, 'cancelled');
    assert.equal(await queue.size(), 0);
  });

  it('acknowledges a capture notice sent again for an order already settled', async () => {
    const { reply, order, queue } = await post(completed);
    assert.deepEqual(reply, { status: 200, body: { handled: true } });
    assert.equal(order?.status, 'paid');
    assert.equal(await queue.size(), 0);
  });

  it('refuses a body signed with the wrong secret before reading it', async () => {
    const { reply, order } = await post(refund, 'paid', sign(JSON.stringify(refund), 'other'));
    assert.equal(reply.status, 401);
    assert.equal(order?.refundReference, null);
  });

  it('answers 404 for an order it has never seen', async () => {
    const { reply } = await post({ ...completed, merchantReference: 'ord_x' });
    assert.equal(reply.status, 404);
  });

  it('acknowledges an event it does not handle', async () => {
    const { reply } = await post({ event: 'dispute.opened', merchantReference: 'ord_1' });
    assert.deepEqual(reply, { status: 200, body: { handled: false } });
  });
});
