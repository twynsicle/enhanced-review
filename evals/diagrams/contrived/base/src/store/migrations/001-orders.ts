import type { Migration } from '../migrate.ts';

/**
 * Orders carry their payment reference inline rather than in a payments
 * table: there is exactly one capture per order, and the gateway's reference
 * is all anyone ever needs to look it up.
 */
export const migration: Migration = {
  name: '001-orders',
  async up(store) {
    await store.ensureTable('orders');
    await store.ensureIndex('orders', 'status');
    await store.ensureIndex('orders', 'createdAt');
  },
};
