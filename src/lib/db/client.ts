import 'server-only';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

/**
 * Lazy singletons for the Postgres pool and Drizzle handle. The pool is
 * constructed on first access — not at module load — so test environments
 * that import this module transitively don't crash when `DATABASE_URL` is
 * unset. Real misconfiguration still surfaces the first time a query runs.
 */
let _pool: Pool | undefined;
let _db: NodePgDatabase<typeof schema> | undefined;

function ensurePool(): Pool {
  if (_pool) return _pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. See .env.example for the docker-compose default.',
    );
  }
  _pool = new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30_000,
  });
  return _pool;
}

function ensureDb(): NodePgDatabase<typeof schema> {
  if (_db) return _db;
  _db = drizzle(ensurePool(), { schema });
  return _db;
}

type DbHandle = NodePgDatabase<typeof schema>;

export const db: DbHandle = new Proxy({} as DbHandle, {
  get(_target, prop) {
    const real = ensureDb() as unknown as Record<PropertyKey, unknown>;
    const value = real[prop];
    return typeof value === 'function'
      ? (value as (...args: unknown[]) => unknown).bind(real)
      : value;
  },
});

export const pool = new Proxy({} as Pool, {
  get(_target, prop) {
    const real = ensurePool() as unknown as Record<PropertyKey, unknown>;
    const value = real[prop];
    return typeof value === 'function'
      ? (value as (...args: unknown[]) => unknown).bind(real)
      : value;
  },
});

export type DbClient = DbHandle;
