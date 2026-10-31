import type { Migration } from '../migrate.ts';

/**
 * Shipments sit in their own table rather than on the order so the carrier's
 * booking survives whatever happens to the order afterwards: a booking is a
 * record of money spent with the carrier and is never rewritten.
 */
export const migration: Migration = {
  name: '002-shipments',
  async up(store) {
    await store.ensureTable('shipments');
    await store.ensureIndex('shipments', 'orderId');
    await store.ensureIndex('shipments', 'trackingNumber');
  },
};
