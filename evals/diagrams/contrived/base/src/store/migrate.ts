import { log } from '../logger.ts';
import { migration as orders } from './migrations/001-orders.ts';
import { migration as shipments } from './migrations/002-shipments.ts';
import type { Store } from './store.ts';

export interface Migration {
  name: string;
  up(store: Store): Promise<void>;
}

export const MIGRATIONS: readonly Migration[] = [orders, shipments];

/**
 * Applies whatever has not run yet, in list order. The order is also checked
 * against the names, so a migration slotted in out of sequence fails at boot
 * instead of running after one that depends on it.
 */
export async function migrate(store: Store, migrations = MIGRATIONS): Promise<string[]> {
  for (let i = 1; i < migrations.length; i += 1) {
    if (migrations[i]!.name <= migrations[i - 1]!.name) {
      throw new Error(`migration ${migrations[i]!.name} is out of order`);
    }
  }
  const applied = new Set(await store.appliedMigrations());
  const ran: string[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    await migration.up(store);
    await store.recordMigration(migration.name);
    ran.push(migration.name);
    log.info('migration applied', { name: migration.name });
  }
  return ran;
}
