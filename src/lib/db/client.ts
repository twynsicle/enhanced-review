import 'server-only';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

/**
 * Singleton Postgres pool + Drizzle handle. Constructed eagerly at module
 * load — `new Pool()` only stores config and does not open a connection
 * until the first query, so a missing or wrong DATABASE_URL surfaces at
 * first use rather than module load (matching the previous behavior). An
 * eager Drizzle instance is required so `@auth/drizzle-adapter`'s
 * `is(db, PgDatabase)` check succeeds at build-time page-data collection.
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
});

export const db: NodePgDatabase<typeof schema> = drizzle(pool, { schema });

export type DbClient = NodePgDatabase<typeof schema>;
