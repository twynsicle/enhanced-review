import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import type { Order } from '../../orders/order.ts';
import { migrate } from '../../store/migrate.ts';
import { MemoryStore } from '../../store/store.ts';
import { runChain, type Context } from '../server.ts';
import { webhookRoutes } from './webhooks.ts';

const SECRET = 'whsec_test';
const now = new Date('2024-05-03T09:00:00Z');
const later = new Date('2024-05-03T09:30:00Z');

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

function context(text: string, signature: string): Context {
  return {
    method: 'POST',
    path: '/webhooks/payment',
    params: {},
    headers: { 'x-cardflow-signature': signature },
    text,
    body: undefined,
  };
}

async function post(body: unknown, signature?: string) {
  const store = new MemoryStore();
  await migrate(store);
  await store.putOrder(paid);
  const [route] = webhookRoutes(SECRET, store, () => later);
  const text = JSON.stringify(body);
  const reply = await runChain(route!, context(text, signature ?? sign(text)));
  return { reply, store };
}

describe('POST /webhooks/payment', () => {
  it('records the refund reference on the order', async () => {
    const notice = { event: 'refund', merchantReference: 'ord_1', refundReference: 'ref_9' };
    const { reply, store } = await post(notice);
    assert.deepEqual(reply, { status: 200, body: { handled: true } });
    assert.equal((await store.getOrder('ord_1'))?.refundReference, 'ref_9');
    assert.equal((await store.getOrder('ord_1'))?.updatedAt, later);
  });

  it('refuses a body signed with the wrong secret before reading it', async () => {
    const notice = { event: 'refund', merchantReference: 'ord_1', refundReference: 'ref_9' };
    const { reply, store } = await post(notice, sign(JSON.stringify(notice), 'other'));
    assert.equal(reply.status, 401);
    assert.equal((await store.getOrder('ord_1'))?.refundReference, null);
    assert.equal((await store.getOrder('ord_1'))?.updatedAt, now);
  });

  it('answers 404 for an order it has never seen', async () => {
    const notice = { event: 'refund', merchantReference: 'ord_x', refundReference: 'ref_9' };
    const { reply } = await post(notice);
    assert.equal(reply.status, 404);
  });

  it('acknowledges an event it does not handle', async () => {
    const { reply } = await post({ event: 'dispute.opened', merchantReference: 'ord_1' });
    assert.deepEqual(reply, { status: 200, body: { handled: false } });
  });
});
