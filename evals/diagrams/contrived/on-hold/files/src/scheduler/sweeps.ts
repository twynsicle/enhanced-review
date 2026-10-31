import { log } from '../logger.ts';
import { transition, type Order } from '../orders/order.ts';
import type { Queue } from '../queue/queue.ts';
import type { Store } from '../store/store.ts';

export const ABANDONED_AFTER_MS = 24 * 60 * 60 * 1000;

export const HELD_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export const STUCK_AFTER_MS = 2 * 60 * 60 * 1000;

export async function findAbandoned(store: Store, now: Date): Promise<Order[]> {
  const placed = await store.listOrders('placed');
  return placed.filter((order) => olderThan(order.createdAt, ABANDONED_AFTER_MS, now));
}

/** Held orders the desk has not released in a week, counted from when the hold was put on. */
export async function findHeld(store: Store, now: Date): Promise<Order[]> {
  const held = await store.listOrders('on_hold');
  return held.filter((order) => olderThan(order.updatedAt, HELD_AFTER_MS, now));
}

export async function findStuck(store: Store, now: Date): Promise<Order[]> {
  const packing = await store.listOrders('packing');
  return packing.filter((order) => olderThan(order.updatedAt, STUCK_AFTER_MS, now));
}

/**
 * An order the gateway never answered for is not going to be paid now, and
 * one nobody has released in a week has an address nobody is fixing. The
 * held one was paid, so cancelling it owes the customer a refund, which the
 * desk raises with the gateway by hand: its line is a warning so they see it.
 */
export async function abandonedOrders(store: Store, now: Date): Promise<number> {
  const abandoned = await findAbandoned(store, now);
  for (const order of abandoned) {
    await store.putOrder(transition(order, 'cancelled', now));
    log.info('abandoned order cancelled', { orderId: order.id, placedAt: order.createdAt });
  }
  const held = await findHeld(store, now);
  for (const order of held) {
    await store.putOrder(transition(order, 'cancelled', now));
    log.warn('held order cancelled, refund owed', { orderId: order.id, heldAt: order.updatedAt });
  }
  return abandoned.length + held.length;
}

/**
 * Queues the ship job again for an order that has sat in packing too long.
 * The order is touched as well, so it waits another full period before being
 * offered again rather than on every tick until the carrier answers.
 */
export async function stuckShipments(store: Store, queue: Queue, now: Date): Promise<number> {
  const stuck = await findStuck(store, now);
  for (const order of stuck) {
    await queue.enqueue({ type: 'ship', orderId: order.id });
    await store.putOrder({ ...order, updatedAt: now });
    log.warn('stuck order queued for shipping again', { orderId: order.id });
  }
  return stuck.length;
}

function olderThan(at: Date, ms: number, now: Date): boolean {
  return now.getTime() - at.getTime() > ms;
}
