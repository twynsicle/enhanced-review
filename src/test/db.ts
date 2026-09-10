import { describe, inject } from 'vitest';
import { prisma } from '../db/client.ts';

/**
 * `describe` for integration tests: the whole block is skipped when the global
 * setup could not reach Postgres. Import from `*.integration.test.ts` only.
 */
export const describeDb = inject('dbAvailable') ? describe : describe.skip;

/** Wipe every table. Integration files run serially, so this is race-free. */
export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE users, sessions, review_jobs, review_schedules, reviews, review_chunks CASCADE',
  );
}
