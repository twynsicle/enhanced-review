import { env } from '@/config/env';
import { pingDb } from '@/db/client';

/**
 * GET /api/health — public, no secrets in the payload.
 *
 * Same key set as the previous endpoint so existing pingers keep parsing it,
 * plus `db`. The queue metrics come back in Phase 3; until then they are
 * `null`. Always 200: this is a data dump for ad-hoc ops checks, not a
 * status oracle — `ok` says only that the process is up.
 */
export interface HealthBody {
  ok: boolean;
  version: string | null;
  db: 'ok' | 'error';
  queueDepth: number | null;
  oldestPendingAgeSec: number | null;
  errorsLast24h: number | null;
}

export async function loader(): Promise<Response> {
  const body: HealthBody = {
    ok: true,
    version: env.APP_VERSION ?? null,
    db: (await pingDb()) ? 'ok' : 'error',
    queueDepth: null,
    oldestPendingAgeSec: null,
    errorsLast24h: null,
  };
  return Response.json(body, { headers: { 'cache-control': 'no-store' } });
}
