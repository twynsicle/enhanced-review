import 'server-only';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { db, pool } from '@/lib/db/client';
import { reviewJobs } from '@/lib/db/schema';
import { logger } from '@/lib/log';
import * as registry from '@/lib/jobs/runner/registry';

/**
 * POST /api/jobs/[id]/cancel
 *
 * Owner-only cancellation. The state-check that PB used to enforce in the
 * collection rule
 * (`@request.auth.id = user.id && (status = "pending" || status = "running")`)
 * is now in the SQL WHERE clause. RETURNING tells us whether we did the
 * cancel or someone beat us — zero rows means the job is no longer
 * cancellable, which we map to 409.
 *
 * The 409 conflates "wrong owner" with "wrong status" on purpose: exposing
 * the difference would leak job ownership across workspace members.
 */
export const dynamic = 'force-dynamic';

const idSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_-]+$/)
  .min(1)
  .max(40);

export async function POST(_req: NextRequest, ctx: RouteContext<'/api/jobs/[id]/cancel'>) {
  const { id } = await ctx.params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ message: 'invalid job id' }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: 'unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    const result = await db
      .update(reviewJobs)
      .set({
        status: 'cancelled',
        cancelledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(reviewJobs.id, id),
          eq(reviewJobs.userId, userId),
          inArray(reviewJobs.status, ['pending', 'running']),
        ),
      )
      .returning({ id: reviewJobs.id });
    if (result.length === 0) {
      return NextResponse.json({ message: 'job is not cancellable' }, { status: 409 });
    }
    // Signal the in-process runner (no-op if already complete or running
    // in another process — still single-task today).
    registry.signal(id);
    await pool.query('SELECT pg_notify($1, $2)', [
      `job_${id}`,
      JSON.stringify({ type: 'status', status: 'cancelled' }),
    ]);
    await pool.query('SELECT pg_notify($1, $2)', [
      `user_${userId}:terminal`,
      JSON.stringify({ jobId: id, status: 'cancelled' }),
    ]);
    return NextResponse.json({ id: result[0].id });
  } catch (err) {
    logger.error({ err, job_id: id, user_id: userId }, '[api/jobs/cancel] update failed');
    return NextResponse.json({ message: 'failed to cancel' }, { status: 500 });
  }
}
