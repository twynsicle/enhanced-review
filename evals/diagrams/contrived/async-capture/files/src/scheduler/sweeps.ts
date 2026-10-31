import { log } from '../logger.ts';
import { transition, type Order } from '../orders/order.ts';
import type { Queue } from '../queue/queue.ts';
import type { Store } from '../store/store.ts';

export const ABANDONED_AFTER_MS = 24 * 60 * 60 * 1000;

export const UNANSWERED_AFTER_MS = 60 * 60 * 1000;

export const STUCK_AFTER_MS = 2 * 60 * 60 * 1000;

export async function findAbandoned(store: Store, now: Date): Promise<Order[]> {
  const placed = await store.listOrders('placed');
  return placed.filter(
    (order) =>
      order.paymentReference === null && olderThan(order.createdAt, ABANDONED_AFTER_MS, now),
  );
}

export async function findUnanswered(store: Store, now: Date): Promise<Order[]> {
  const placed = await store.listOrders('placed');
  return placed.filter(
    (order) =>
      order.paymentReference !== null && olderThan(order.updatedAt, UNANSWERED_AFTER_MS, now),
  );
}

export async function findStuck(store: Store, now: Date): Promise<Order[]> {
  const packing = await store.listOrders('packing');
  return packing.filter((order) => olderThan(order.updatedAt, STUCK_AFTER_MS, now));
}

/** No capture reference after a day: the gateway was never reached, and the card never charged. */
export async function abandonedOrders(store: Store, now: Date): Promise<number> {
  const abandoned = await findAbandoned(store, now);
  for (const order of abandoned) {
    await store.putOrder(transition(order, 'cancelled', now));
    log.info('abandoned order cancelled', { orderId: order.id, placedAt: order.createdAt });
  }
  return abandoned.length;
}

/**
 * Cardflow settles a pending capture within minutes. One it has said nothing
 * about for an hour is not going to settle, and the hold on the customer's
 * card should not outlive the order.
 */
export async function unansweredCaptures(store: Store, now: Date): Promise<number> {
  const unanswered = await findUnanswered(store, now);
  for (const order of unanswered) {
    await store.putOrder(transition(order, 'cancelled', now));
    log.warn('unanswered capture cancelled', {
      orderId: order.id,
      paymentReference: order.paymentReference,
    });
  }
  return unanswered.length;
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
