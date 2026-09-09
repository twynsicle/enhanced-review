import { Client } from 'pg';
import type { TestProject } from 'vitest/node';
import { env } from '../config/env.ts';

/**
 * Integration project global setup: probe Postgres once and publish the
 * result. Test files wrap themselves in `describeDb` (src/test/db.ts), which
 * skips when the probe failed, so `npm run test:integration` exits 0 on a
 * machine without Docker instead of erroring on every file (A13).
 */
declare module 'vitest' {
  export interface ProvidedContext {
    dbAvailable: boolean;
  }
}

async function probe(): Promise<boolean> {
  const client = new Client({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 2000,
  });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

export default async function setup(project: TestProject): Promise<void> {
  const available = await probe();
  if (!available) {
    process.stdout.write(
      `[integration] Postgres unreachable at ${new URL(env.DATABASE_URL).host}; skipping integration tests\n`,
    );
  }
  project.provide('dbAvailable', available);
}
