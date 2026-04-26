import 'server-only';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/log';
import { getCurrentUser, pbServer } from '@/lib/pb';
import * as registry from '@/lib/jobs/runner/registry';

/**
 * POST /api/jobs/[id]/cancel
 *
 * Owner-only cancellation. The user-scoped PB client is used deliberately
 * so the `review_jobs.updateRule`
 * (`@request.auth.id = user.id && (status = "pending" || status = "running")`)
 * enforces the owner check + cancellable-state check at the DB layer —
 * no manual auth comparison in this handler.
 *
 * Returns 200 with `{ id }` on success, 409 when the job is no longer in
 * a cancellable state (already done/errored, already cancelled, or not
 * the user's job). PB returns 404 when a rule blocks an update — we map
 * that to 409 deliberately. The 409 conflates "wrong owner" with "wrong
 * status" on purpose: exposing the difference would leak job ownership.
 */
export const dynamic = 'force-dynamic';

// PB IDs default to 15 alphanumeric chars; allow a bit of slack in case
// of customised id length.
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

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: 'unauthorized' }, { status: 401 });
  }

  const pb = await pbServer();
  try {
    const record = await pb.collection('review_jobs').update(id, {
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
    });
    // Signal the in-process runner (no-op if the job isn't currently running
    // in this process, e.g. already completed or not yet started).
    registry.signal(id);
    return NextResponse.json({ id: record.id });
  } catch (err: unknown) {
    if (isNotFound(err)) {
      return NextResponse.json({ message: 'job is not cancellable' }, { status: 409 });
    }
    logger.error({ err, job_id: id, user_id: user.id }, '[api/jobs/cancel] update failed');
    return NextResponse.json({ message: 'failed to cancel' }, { status: 500 });
  }
}

function isNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  return (err as { status?: unknown }).status === 404;
}
