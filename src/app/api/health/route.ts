import 'server-only';
import { NextResponse } from 'next/server';
import { logger } from '@/lib/log';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * GET /api/health — public, no secrets in payload.
 *
 * Cheap snapshot for ad-hoc ops checks: queue depth, age of the oldest
 * pending job, and the count of errored jobs in the last 24h. Three
 * lightweight queries (one count, one min, one filtered count); no
 * per-user data, no internal IDs.
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
  const admin = createAdminClient();
  let ok = true;

  const [queueDepth, oldestPending, errorsLast24h] = await Promise.all([
    countByStatus(admin, 'pending').catch((err) => {
      logger.error({ err }, '[api/health] queueDepth failed');
      ok = false;
      return null;
    }),
    oldestPendingAgeSeconds(admin).catch((err) => {
      logger.error({ err }, '[api/health] oldestPending failed');
      ok = false;
      return null;
    }),
    countErrorsLast24h(admin).catch((err) => {
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
  admin: ReturnType<typeof createAdminClient>,
  status: 'pending' | 'running' | 'done' | 'error' | 'cancelled',
): Promise<number> {
  const { count, error } = await admin
    .from('review_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', status);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function oldestPendingAgeSeconds(
  admin: ReturnType<typeof createAdminClient>,
): Promise<number | null> {
  const { data, error } = await admin
    .from('review_jobs')
    .select('created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle<{ created_at: string }>();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const ageMs = Date.now() - new Date(data.created_at).getTime();
  return Math.max(0, Math.round(ageMs / 1000));
}

async function countErrorsLast24h(
  admin: ReturnType<typeof createAdminClient>,
): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count, error } = await admin
    .from('review_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'error')
    .gte('completed_at', cutoff);
  if (error) throw new Error(error.message);
  return count ?? 0;
}
