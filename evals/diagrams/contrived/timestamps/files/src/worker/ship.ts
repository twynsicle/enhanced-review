import { log } from '../logger.ts';
import { transition } from '../orders/order.ts';
import type { JobOf } from '../queue/jobs.ts';
import type { Queue } from '../queue/queue.ts';
import type { Carrier, Shipment } from '../shipping/carrier.ts';
import { requireOrder, type Store } from '../store/store.ts';

export interface ShipDeps {
  store: Store;
  queue: Queue;
  carrier: Carrier;
  clock: () => Date;
}

export function shipHandler(deps: ShipDeps): (job: JobOf<'ship'>) => Promise<void> {
  const { store, queue, carrier, clock } = deps;
  return async (job) => {
    const order = await requireOrder(store, job.orderId);
    // The stuck sweep replays a ship job whose booking succeeded but whose
    // status write did not land; the stored shipment is the proof the carrier
    // already has this one, and a second booking would be a second label.
    let shipment: Shipment | null = await store.getShipment(order.id);
    if (!shipment) {
      const trackingNumber = await carrier.book({
        orderId: order.id,
        to: order.address,
        pieces: order.lines.reduce((sum, line) => sum + line.quantity, 0),
      });
      const bookedAt = clock();
      shipment = {
        orderId: order.id,
        carrier: carrier.name,
        trackingNumber,
        bookedAt,
        updatedAt: bookedAt,
      };
      await store.putShipment(shipment);
    }
    const shipped = transition(order, 'shipped', clock());
    await store.putOrder(shipped);
    await queue.enqueue({ type: 'email', orderId: order.id, template: 'shipped' });
    log.info('order shipped', {
      orderId: order.id,
      status: shipped.status,
      at: shipped.updatedAt.toISOString(),
      trackingNumber: shipment.trackingNumber,
    });
  };
}
