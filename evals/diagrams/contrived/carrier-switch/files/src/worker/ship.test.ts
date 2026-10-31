import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Address, Order } from '../orders/order.ts';
import { MemoryQueue } from '../queue/queue.ts';
import { CarrierError, type Carrier, type Reach } from '../shipping/carrier.ts';
import { migrate } from '../store/migrate.ts';
import { MemoryStore } from '../store/store.ts';
import { shipHandler } from './ship.ts';

const now = new Date('2024-05-02T12:00:00Z');
const leeds = {
  name: 'Ana',
  line1: '1 High St',
  city: 'Leeds',
  postcode: 'LS1 4AP',
  country: 'GB',
};
const berlin = { ...leeds, city: 'Berlin', postcode: '10117', country: 'DE' };

function packing(address: Address): Order {
  return {
    id: 'ord_1',
    status: 'packing',
    email: 'ana@example.com',
    lines: [{ sku: 'MUG-01', quantity: 2, unitPrice: 1200 }],
    address,
    total: 2795,
    paymentReference: 'cap_1',
    refundReference: null,
    createdAt: now,
    updatedAt: now,
  };
}

function carrier(name: string, reach: Reach): Carrier & { booked: number[] } {
  const booked: number[] = [];
  return {
    name,
    reach,
    booked,
    book: (request) => {
      booked.push(request.pieces);
      return Promise.resolve(`${name}-1`);
    },
  };
}

async function ship(order: Order, carriers: Carrier[]) {
  const store = new MemoryStore();
  await migrate(store);
  await store.putOrder(order);
  const queue = new MemoryQueue();
  const handler = shipHandler({ store, queue, carriers, homeCountry: 'GB', clock: () => now });
  return { store, queue, run: () => handler({ type: 'ship', orderId: order.id }) };
}

describe('shipHandler', () => {
  it('books a home-country order with the domestic carrier and moves it on', async () => {
    const northpost = carrier('northpost', 'domestic');
    const parcelnet = carrier('parcelnet', 'international');
    const { store, queue, run } = await ship(packing(leeds), [northpost, parcelnet]);
    await run();
    assert.deepEqual(parcelnet.booked, []);
    assert.deepEqual(northpost.booked, [2]);
    const shipment = { orderId: 'ord_1', carrier: 'northpost', trackingNumber: 'northpost-1' };
    assert.deepEqual(await store.getShipment('ord_1'), { ...shipment, bookedAt: now });
    assert.equal((await store.getOrder('ord_1'))?.status, 'shipped');
    const email = { type: 'email', orderId: 'ord_1', template: 'shipped' };
    assert.deepEqual((await queue.take())?.job, email);
  });

  it('reuses a stored shipment instead of booking again', async () => {
    const northpost = carrier('northpost', 'domestic');
    const { store, run } = await ship(packing(leeds), [northpost]);
    const booked = { orderId: 'ord_1', carrier: 'northpost', trackingNumber: 'NP9', bookedAt: now };
    await store.putShipment(booked);
    await run();
    assert.deepEqual(northpost.booked, []);
    assert.equal((await store.getOrder('ord_1'))?.status, 'shipped');
  });

  it('fails the job and leaves the order packing when no carrier goes there', async () => {
    const { store, queue, run } = await ship(packing(berlin), [carrier('northpost', 'domestic')]);
    await assert.rejects(run, CarrierError);
    assert.equal(await store.getShipment('ord_1'), null);
    assert.equal((await store.getOrder('ord_1'))?.status, 'packing');
    assert.equal(await queue.size(), 0);
  });
});
