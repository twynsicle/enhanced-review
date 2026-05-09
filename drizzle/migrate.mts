/**
 * Standalone migration runner. Used three ways:
 *
 *   1. Local dev: `npm run db:migrate` (tsx, this .mts file directly).
 *   2. CI: same command in a sandboxed Postgres.
 *   3. Container entrypoint: `node drizzle/migrate.mjs` — the build stage
 *      compiles this file with `tsc` to emit `migrate.mjs` next to it,
 *      and the runtime image copies the `.mjs` plus the SQL migrations.
 *
 * Reads DATABASE_URL from the environment. Idempotent — safe to re-run.
 * Migrations are sourced from this directory (see drizzle.config.ts).
 */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required to run migrations.');
  }

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const db = drizzle(pool);
    const migrationsFolder = path.dirname(fileURLToPath(import.meta.url));
    console.log(`[migrate] applying migrations from ${migrationsFolder}`);
    await migrate(db, { migrationsFolder });
    console.log('[migrate] done');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[migrate] failed:', err);
  process.exit(1);
});
