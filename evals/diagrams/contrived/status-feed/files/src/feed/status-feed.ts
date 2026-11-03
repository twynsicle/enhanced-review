import type { Order } from '../orders/order.ts';
import type { Queue } from '../queue/queue.ts';
import type { Store } from '../store/store.ts';

/**
 * The store, with every change of an order's status queued for Shelfwise.
 * Everything that moves an order writes it through `putOrder`, so the feed
 * sits here rather than beside each `transition`, and a part that starts
 * moving orders later is fed without knowing the warehouse exists.
 */
export function withStatusFeed(store: Store, queue: Queue): Store {
  return {
    ensureTable: (name) => store.ensureTable(name),
    ensureIndex: (table, field) => store.ensureIndex(table, field),
    appliedMigrations: () => store.appliedMigrations(),
    recordMigration: (name) => store.recordMigration(name),
    getOrder: (id) => store.getOrder(id),
    listOrders: (status) => store.listOrders(status),
    getShipment: (orderId) => store.getShipment(orderId),
    putShipment: (shipment) => store.putShipment(shipment),
    async putOrder(order: Order) {
      const before = await store.getOrder(order.id);
      await store.putOrder(order);
      // A write that leaves the status alone, like a refund reference landing, is not a move.
      if (before?.status === order.status) return;
      await queue.enqueue({
        type: 'status',
        orderId: order.id,
        status: order.status,
        at: order.updatedAt.toISOString(),
      });
    },
  };
}
