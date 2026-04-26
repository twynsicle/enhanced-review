import 'server-only';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/log';
import { getCurrentUser } from '@/lib/pb';
import { createClient as createServerSupabase } from '@/lib/supabase/server';

/**
 * POST /api/jobs/[id]/cancel
 *
 * Owner-only cancellation. The user-scoped Supabase client is used
 * deliberately so RLS enforces the owner check — no manual `auth.uid()`
 * comparison in this handler. RLS additionally constrains the new status
 * to `cancelled` and requires `cancelled_at` to be set.
 *
 * Returns 200 with `{ id }` on success, 409 when the job is no longer in
 * a cancellable state (already done/errored, already cancelled, or not
 * the user's job). The 409 conflates "wrong owner" with "wrong status"
 * on purpose — exposing the difference would leak job ownership.
 */
export const dynamic = 'force-dynamic';

const idSchema = z.string().uuid();

export async function POST(_req: NextRequest, ctx: RouteContext<'/api/jobs/[id]/cancel'>) {
  const { id } = await ctx.params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ message: 'invalid job id' }, { status: 400 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: 'unauthorized' }, { status: 401 });
  }

  // Phase 3 will move this update to PB.
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('review_jobs')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('id', id)
    .in('status', ['pending', 'running'])
    .select('id')
    .maybeSingle();

  if (error) {
    logger.error({ err: error, job_id: id, user_id: user.id }, '[api/jobs/cancel] update failed');
    return NextResponse.json({ message: 'failed to cancel' }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ message: 'job is not cancellable' }, { status: 409 });
  }

  return NextResponse.json({ id: data.id });
}
