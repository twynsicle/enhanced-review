import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Order } from '../../orders/order.ts';
import type { CaptureRequest, PaymentGateway } from '../../payments/gateway.ts';
import { MemoryQueue } from '../../queue/queue.ts';
import { migrate } from '../../store/migrate.ts';
import { MemoryStore } from '../../store/store.ts';
import { orderRoutes } from '../routes/orders.ts';
import { runChain, type Context } from '../server.ts';

const API_KEY = 'key_test';
const now = new Date('2024-05-03T09:00:00Z');

const order = {
  email: 'ana@example.com',
  lines: [{ sku: 'MUG-01', quantity: 1, unitPrice: 1200 }],
  address: { name: 'Ana', line1: '1 High St', city: 'Leeds', postcode: 'LS1 4AP', country: 'GB' },
  cardToken: 'tok_visa',
};

function context(body: unknown, apiKey = API_KEY): Context {
  return {
    method: 'POST',
    path: '/orders',
    params: {},
    headers: { 'x-api-key': apiKey },
    text: JSON.stringify(body),
    body: undefined,
  };
}

async function post(body: unknown, apiKey?: string) {
  const store = new MemoryStore();
  await migrate(store);
  const captures: CaptureRequest[] = [];
  const gateway: PaymentGateway = {
    capture: (request) => {
      captures.push(request);
      return Promise.resolve({ outcome: 'captured', reference: 'cap_1' });
    },
  };
  const [route] = orderRoutes(API_KEY, { store, gateway, queue: new MemoryQueue(), clock: () => now });
  const reply = await runChain(route!, context(body, apiKey));
  return { reply, store, captures };
}

describe('POST /orders through validateAddressBody', () => {
  it('answers 422 naming the field, before anything is stored or charged', async () => {
    const bad = { ...order, address: { ...order.address, postcode: 'nope' } };
    const { reply, store, captures } = await post(bad);
    assert.equal(reply.status, 422);
    assert.equal((reply.body as { field: string }).field, 'postcode');
    assert.deepEqual(await store.listOrders('placed'), []);
    assert.deepEqual(captures, []);
  });

  it('hands the handler the address with its country and postcode normalised', async () => {
    const lower = { ...order, address: { ...order.address, country: 'gb', postcode: 'ls1 4ap' } };
    const { reply } = await post(lower);
    assert.equal(reply.status, 201);
    const { address } = reply.body as Order;
    assert.equal(address.country, 'GB');
    assert.equal(address.postcode, 'LS1 4AP');
  });

  it('leaves a body with no address to the handler', async () => {
    const { address: _address, ...without } = order;
    const { reply } = await post(without);
    assert.deepEqual(reply, { status: 400, body: { error: 'address is required' } });
  });

  it('runs after the api key check', async () => {
    const bad = { ...order, address: { ...order.address, country: 'AU' } };
    const { reply } = await post(bad, 'wrong');
    assert.equal(reply.status, 401);
  });
});
