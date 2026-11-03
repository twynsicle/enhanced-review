import { log } from '../logger.ts';
import { transition } from '../orders/order.ts';
import type { JobOf } from '../queue/jobs.ts';
import type { Queue } from '../queue/queue.ts';
import { requireOrder, type Store } from '../store/store.ts';

export interface PackDeps {
  store: Store;
  queue: Queue;
  clock: () => Date;
}

/**
 * The warehouse starts picking as soon as the order is packing; the ship job
 * is queued straight away because booking the carrier is the slow step and
 * runs while the parcel is being packed.
 */
export function packHandler(deps: PackDeps): (job: JobOf<'pack'>) => Promise<void> {
  const { store, queue, clock } = deps;
  return async (job) => {
    const order = await requireOrder(store, job.orderId);
    const packing = transition(order, 'packing', clock());
    await store.putOrder(packing);
    await queue.enqueue({ type: 'ship', orderId: order.id });
    log.info('order packing', {
      orderId: order.id,
      status: packing.status,
      at: packing.updatedAt.toISOString(),
    });
  };
}
