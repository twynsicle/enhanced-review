import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GatewayError, type CaptureRequest, type CaptureResult } from '../payments/gateway.ts';
import { MemoryQueue } from '../queue/queue.ts';
import { MemoryRetryQueue } from '../queue/retry.ts';
import { migrate } from '../store/migrate.ts';
import { MemoryStore } from '../store/store.ts';
import { AddressError } from './address.ts';
import { createOrder, type CreateOrderInput } from './create.ts';
import type { OrderStatus } from './order.ts';

const input: CreateOrderInput = {
  email: 'ana@example.com',
  lines: [{ sku: 'MUG-01', quantity: 2, unitPrice: 1200 }],
  address: { name: 'Ana', line1: '1 High St', city: 'Leeds', postcode: 'LS1 4AP', country: 'GB' },
  cardToken: 'tok_visa',
};

const clock = () => new Date('2024-05-01T10:00:00Z');

function gateway(answer: CaptureResult | Error) {
  const amounts: number[] = [];
  const capture = (request: CaptureRequest) => {
    amounts.push(request.amount);
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  };
  return { amounts, capture };
}

async function deps(answer: CaptureResult | Error) {
  const store = new MemoryStore();
  await migrate(store);
  const seen: OrderStatus[] = [];
  const putOrder = store.putOrder.bind(store);
  store.putOrder = (order) => {
    seen.push(order.status);
    return putOrder(order);
  };
  const queue = new MemoryQueue();
  return { store, gateway: gateway(answer), queue, retries: new MemoryRetryQueue(), clock, seen };
}

describe('createOrder', () => {
  it('captures the priced total and moves a captured order to paid', async () => {
    const d = await deps({ outcome: 'captured', reference: 'cap_1' });
    const order = await createOrder(input, d);
    assert.equal(order.status, 'paid');
    assert.equal(order.paymentReference, 'cap_1');
    assert.deepEqual(d.gateway.amounts, [2400 + 395]);
    assert.deepEqual(await d.store.getOrder(order.id), order);
  });

  it('stores the order as placed before the gateway is asked', async () => {
    const d = await deps({ outcome: 'captured', reference: 'cap_1' });
    await createOrder(input, d);
    assert.deepEqual(d.seen, ['placed', 'paid']);
  });

  it('queues the pack job and the confirmation once paid', async () => {
    const d = await deps({ outcome: 'captured', reference: 'cap_1' });
    const order = await createOrder(input, d);
    const first = await d.queue.take();
    const second = await d.queue.take();
    assert.deepEqual(first?.job, { type: 'pack', orderId: order.id });
    assert.deepEqual(second?.job, { type: 'email', orderId: order.id, template: 'confirmed' });
  });

  it('cancels a declined order and queues nothing', async () => {
    const d = await deps({ outcome: 'declined', reference: 'cap_2', reason: 'insufficient funds' });
    const order = await createOrder(input, d);
    assert.equal(order.status, 'cancelled');
    assert.equal(await d.queue.size(), 0);
  });

  it('leaves the order placed with a retry queued when the gateway fails', async () => {
    const d = await deps(new GatewayError('cardflow returned 503'));
    const order = await createOrder(input, d);
    assert.equal(order.status, 'placed');
    const [retry] = await d.retries.due(new Date('2024-05-01T10:01:00Z'));
    assert.deepEqual([retry?.orderId, retry?.attempt], [order.id, 1]);
  });

  it('rejects a bad address before anything is stored or charged', async () => {
    const d = await deps({ outcome: 'captured', reference: 'cap_1' });
    const bad = { ...input, address: { ...input.address, postcode: 'nope' } };
    await assert.rejects(createOrder(bad, d), AddressError);
    assert.deepEqual(d.seen, []);
    assert.deepEqual(d.gateway.amounts, []);
  });
});
