import { logger } from '@/common/logger';
import { env } from '@/config/env';
import { pingDb } from '@/db/client';
import { countErrorsSince, countJobsByStatus, oldestPendingCreatedAt } from '@/db/review-jobs';

/**
 * GET /api/health — public, no secrets in the payload.
 *
 * A cheap snapshot for ad-hoc ops checks: database reachability, queue depth,
 * age of the oldest pending job and errors in the last 24 h. Always 200 so a
 * green pinger sees a green dot; a failed query leaves its value `null` and
 * flips `ok` to false, but this endpoint is a data dump, not a status oracle.
 */
export interface HealthBody {
  ok: boolean;
  version: string | null;
  db: 'ok' | 'error';
  queueDepth: number | null;
  oldestPendingAgeSec: number | null;
  errorsLast24h: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function loader(): Promise<Response> {
  let ok = true;
  const guard = <T>(name: string, promise: Promise<T>): Promise<T | null> =>
    promise.catch((err: unknown) => {
      logger.error({ err, metric: name }, 'health metric failed');
      ok = false;
      return null;
    });

  const [db, queueDepth, oldestPending, errorsLast24h] = await Promise.all([
    pingDb(),
    guard('queueDepth', countJobsByStatus('pending')),
    guard('oldestPending', oldestPendingCreatedAt()),
    guard('errorsLast24h', countErrorsSince(new Date(Date.now() - DAY_MS))),
  ]);

  const body: HealthBody = {
    ok,
    version: env.APP_VERSION ?? null,
    db: db ? 'ok' : 'error',
    queueDepth,
    oldestPendingAgeSec: oldestPending
      ? Math.max(0, Math.round((Date.now() - oldestPending.getTime()) / 1000))
      : null,
    errorsLast24h,
  };
  return Response.json(body, { headers: { 'cache-control': 'no-store' } });
}
