import 'server-only';
import { NextResponse } from 'next/server';
import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { logger } from '@/lib/log';
import { db } from '@/lib/db/client';
import { reviewJobs } from '@/lib/db/schema';

/**
 * GET /api/health — public, no secrets in payload.
 *
 * Cheap snapshot for ad-hoc ops checks: queue depth, age of the oldest
 * pending job, and the count of errored jobs in the last 24h. Three
 * lightweight Drizzle queries; no per-user data, no internal IDs.
 *
 * Always returns 200 so a green pinger sees a green dot. If a query
 * fails the value is null and `ok` flips to `false`, but the response
 * still hits 200 — this endpoint isn't a status-page oracle, just a
 * data dump.
 */
export const dynamic = 'force-dynamic';

export interface HealthBody {
  ok: boolean;
  queueDepth: number | null;
  oldestPendingAgeSec: number | null;
  errorsLast24h: number | null;
}

export async function GET() {
  let ok = true;

  const [queueDepth, oldestPending, errorsLast24h] = await Promise.all([
    countByStatus('pending').catch((err: unknown) => {
      logger.error({ err }, '[api/health] queueDepth failed');
      ok = false;
      return null;
    }),
    oldestPendingAgeSeconds().catch((err: unknown) => {
      logger.error({ err }, '[api/health] oldestPending failed');
      ok = false;
      return null;
    }),
    countErrorsLast24h().catch((err: unknown) => {
      logger.error({ err }, '[api/health] errorsLast24h failed');
      ok = false;
      return null;
    }),
  ]);

  const body: HealthBody = {
    ok,
    queueDepth,
    oldestPendingAgeSec: oldestPending,
    errorsLast24h,
  };
  return NextResponse.json(body);
}

async function countByStatus(
  status: 'pending' | 'running' | 'done' | 'error' | 'cancelled',
): Promise<number> {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reviewJobs)
    .where(eq(reviewJobs.status, status));
  return n;
}

async function oldestPendingAgeSeconds(): Promise<number | null> {
  const rows = await db
    .select({ createdAt: reviewJobs.createdAt })
    .from(reviewJobs)
    .where(eq(reviewJobs.status, 'pending'))
    .orderBy(asc(reviewJobs.createdAt))
    .limit(1);
  const oldest = rows[0];
  if (!oldest) return null;
  const ageMs = Date.now() - oldest.createdAt.getTime();
  return Math.max(0, Math.round(ageMs / 1000));
}

async function countErrorsLast24h(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reviewJobs)
    .where(and(eq(reviewJobs.status, 'error'), gte(reviewJobs.completedAt, cutoff)));
  return n;
}
