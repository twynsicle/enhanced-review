import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Order } from '../orders/order.ts';
import { GatewayError, type CaptureResult } from '../payments/gateway.ts';
import { MemoryQueue } from '../queue/queue.ts';
import { MemoryRetryQueue } from '../queue/retry.ts';
import { migrate } from '../store/migrate.ts';
import { MemoryStore } from '../store/store.ts';
import { retryCaptures } from './sweeps.ts';

const now = new Date('2024-05-02T12:00:00Z');

const minutesAfter = (minutes: number) => new Date(now.getTime() + minutes * 60_000);

const placed: Order = {
  id: 'ord_1',
  status: 'placed',
  email: 'ana@example.com',
  lines: [{ sku: 'MUG-01', quantity: 1, unitPrice: 1200 }],
  address: { name: 'Ana', line1: '1 High St', city: 'Leeds', postcode: 'LS1 4AP', country: 'GB' },
  total: 1595,
  paymentReference: null,
  refundReference: null,
  createdAt: new Date('2024-05-02T11:30:00Z'),
  updatedAt: new Date('2024-05-02T11:30:00Z'),
};

/** The service with the placed order's retry due now and the gateway's next answer set. */
async function deps(answer: CaptureResult | Error, attempt = 1) {
  const store = new MemoryStore();
  await migrate(store);
  await store.putOrder(placed);
  const retries = new MemoryRetryQueue();
  await retries.schedule({ orderId: placed.id, cardToken: 'tok_visa', attempt, dueAt: now });
  const capture = () =>
    answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  return { store, gateway: { capture }, queue: new MemoryQueue(), retries, clock: () => now };
}

describe('retryCaptures', () => {
  it('moves a captured order to paid and queues its pack job and confirmation', async () => {
    const d = await deps({ outcome: 'captured', reference: 'cap_7' });
    assert.equal(await retryCaptures(d, now), 1);
    const order = await d.store.getOrder('ord_1');
    assert.equal(order?.status, 'paid');
    assert.equal(order?.paymentReference, 'cap_7');
    const jobs = [(await d.queue.take())?.job, (await d.queue.take())?.job];
    assert.deepEqual(jobs, [
      { type: 'pack', orderId: 'ord_1' },
      { type: 'email', orderId: 'ord_1', template: 'confirmed' },
    ]);
    assert.deepEqual(await d.retries.due(minutesAfter(60)), []);
  });

  it('cancels a declined order and drops its retry', async () => {
    const d = await deps({ outcome: 'declined', reference: 'cap_8', reason: 'insufficient funds' });
    await retryCaptures(d, now);
    assert.equal((await d.store.getOrder('ord_1'))?.status, 'cancelled');
    assert.deepEqual(await d.retries.due(minutesAfter(60)), []);
  });

  it('waits out the next step of the backoff when the gateway fails again', async () => {
    const d = await deps(new GatewayError('cardflow returned 503'));
    await retryCaptures(d, now);
    assert.equal((await d.store.getOrder('ord_1'))?.status, 'placed');
    assert.deepEqual(await d.retries.due(minutesAfter(4)), []);
    const expected = {
      orderId: 'ord_1',
      cardToken: 'tok_visa',
      attempt: 2,
      dueAt: minutesAfter(5),
    };
    assert.deepEqual(await d.retries.due(minutesAfter(5)), [expected]);
  });

  it('cancels the order once the last attempt fails too', async () => {
    const d = await deps(new GatewayError('cardflow returned 503'), 3);
    await retryCaptures(d, now);
    assert.equal((await d.store.getOrder('ord_1'))?.status, 'cancelled');
    assert.deepEqual(await d.retries.due(minutesAfter(60)), []);
  });

  it('drops the retry of an order no longer placed without asking the gateway', async () => {
    const d = await deps(new Error('the gateway was asked'));
    await d.store.putOrder({ ...placed, status: 'cancelled' });
    assert.equal(await retryCaptures(d, now), 1);
    assert.deepEqual(await d.retries.due(minutesAfter(60)), []);
  });
});
