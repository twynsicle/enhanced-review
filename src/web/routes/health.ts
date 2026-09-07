import { env } from '@/config/env';

/**
 * GET /api/health — public, no secrets in the payload.
 *
 * Same key set as the previous endpoint so existing pingers keep
 * parsing it. The queue metrics come back in Phase 3 once `src/db` exists;
 * until then they are `null` and `ok` reflects only that the process is up.
 * Always 200: this is a data dump for ad-hoc ops checks, not a status
 * oracle.
 */
export interface HealthBody {
  ok: boolean;
  version: string | null;
  queueDepth: number | null;
  oldestPendingAgeSec: number | null;
  errorsLast24h: number | null;
}

export function loader(): Response {
  const body: HealthBody = {
    ok: true,
    version: env.APP_VERSION ?? null,
    queueDepth: null,
    oldestPendingAgeSec: null,
    errorsLast24h: null,
  };
  return Response.json(body, { headers: { 'cache-control': 'no-store' } });
}
