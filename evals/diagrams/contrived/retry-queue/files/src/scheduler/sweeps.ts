import { errorFields, log } from '../logger.ts';
import { applyCapture, captureRequest, type OrderDeps } from '../orders/create.ts';
import { transition, type Order } from '../orders/order.ts';
import { GatewayError, type CaptureResult } from '../payments/gateway.ts';
import type { Queue } from '../queue/queue.ts';
import { queueRetry } from '../queue/retry.ts';
import type { Store } from '../store/store.ts';

export const ABANDONED_AFTER_MS = 24 * 60 * 60 * 1000;

export const STUCK_AFTER_MS = 2 * 60 * 60 * 1000;

export async function findAbandoned(store: Store, now: Date): Promise<Order[]> {
  const placed = await store.listOrders('placed');
  return placed.filter((order) => olderThan(order.createdAt, ABANDONED_AFTER_MS, now));
}

export async function findStuck(store: Store, now: Date): Promise<Order[]> {
  const packing = await store.listOrders('packing');
  return packing.filter((order) => olderThan(order.updatedAt, STUCK_AFTER_MS, now));
}

/** An order the gateway never answered for is not going to be paid now. */
export async function abandonedOrders(store: Store, now: Date): Promise<number> {
  const abandoned = await findAbandoned(store, now);
  for (const order of abandoned) {
    await store.putOrder(transition(order, 'cancelled', now));
    log.info('abandoned order cancelled', { orderId: order.id, placedAt: order.createdAt });
  }
  return abandoned.length;
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

/**
 * Captures again for every order whose retry has come due. A capture the
 * gateway fails again waits out the next step of the backoff; one it fails
 * on the last step cancels the order, as a decline would.
 */
export async function retryCaptures(deps: OrderDeps, now: Date): Promise<number> {
  const { store, retries } = deps;
  const due = await retries.due(now);
  for (const retry of due) {
    const order = await store.getOrder(retry.orderId);
    // Answered since: by a retry whose removal did not land, or by hand at the desk.
    if (order?.status !== 'placed') {
      await retries.remove(retry.orderId);
      continue;
    }
    let result: CaptureResult;
    try {
      result = await deps.gateway.capture(captureRequest(order, retry.cardToken));
    } catch (error) {
      if (!(error instanceof GatewayError)) throw error;
      const fields = { orderId: order.id, attempt: retry.attempt, ...errorFields(error) };
      const again = { orderId: order.id, cardToken: retry.cardToken, attempt: retry.attempt + 1 };
      if (await queueRetry(retries, again, now)) {
        log.warn('capture failed again, retry queued', fields);
      } else {
        await retries.remove(order.id);
        await store.putOrder(transition(order, 'cancelled', now));
        log.error('capture given up, order cancelled', fields);
      }
      continue;
    }
    await applyCapture(order, result, deps);
    await retries.remove(order.id);
  }
  return due.length;
}

function olderThan(at: Date, ms: number, now: Date): boolean {
  return now.getTime() - at.getTime() > ms;
}
