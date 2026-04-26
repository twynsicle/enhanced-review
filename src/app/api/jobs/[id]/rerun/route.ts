import 'server-only';
import { GithubAuthError, isAuthError, type ReviewTarget } from '@enhanced-review/github-client';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getGithubLogin } from '@/lib/auth/allowlist';
import { createServerOctokit, githubErrorResponse } from '@/lib/github/server';
import { findUserInFlightJob } from '@/lib/jobs/concurrency';
import { resolveFreshReviewTarget } from '@/lib/jobs/resolve-target';
import { logger } from '@/lib/log';
import { getCurrentUser, pbAdmin, readGithubTokenCookie } from '@/lib/pb';
import * as registry from '@/lib/jobs/runner/registry';
import { runJob } from '@/lib/jobs/runner/run';

/**
 * POST /api/jobs/[id]/rerun
 *
 * Create a fresh `review_jobs` row that mirrors the source job's
 * `target` but pinned to the *current* head SHA on GitHub. The new job
 * is owned by the *viewer*, not the original requester — workspace
 * members can re-run each other's reviews and the new row reflects who
 * actually paid for the work.
 *
 * Returns 200 with `{ id }` of the new job. 401 on missing session.
 * 404 when the source job doesn't exist. 502 when the GitHub head-SHA
 * refresh fails.
 *
 * The runner starts immediately with the viewer's GitHub token from the
 * session cookie.
 */
export const dynamic = 'force-dynamic';

const idSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_-]+$/)
  .min(1)
  .max(40);

export async function POST(_req: NextRequest, ctx: RouteContext<'/api/jobs/[id]/rerun'>) {
  const { id } = await ctx.params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ message: 'invalid job id' }, { status: 400 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: 'unauthorized' }, { status: 401 });
  }

  const githubLogin = getGithubLogin(user);
  if (!githubLogin) {
    return NextResponse.json(
      { reason: 'github_token_invalid', message: 'No GitHub identity on this session.' },
      { status: 401 },
    );
  }

  const token = await readGithubTokenCookie();
  if (!token) {
    return NextResponse.json(
      { reason: 'github_token_missing', message: 'GitHub token missing — re-link your account.' },
      { status: 401 },
    );
  }

  const admin = await pbAdmin();

  let target: ReviewTarget;
  try {
    const source = await admin
      .collection('review_jobs')
      .getOne<{ id: string; target: ReviewTarget }>(id, { fields: 'id,target' });
    target = source.target;
  } catch (err) {
    if (isNotFound(err)) {
      return NextResponse.json({ message: 'job not found' }, { status: 404 });
    }
    logger.error(
      { err, source_job_id: id, user_id: user.id },
      '[api/jobs/rerun] source lookup failed',
    );
    return NextResponse.json({ message: 'failed to load source job' }, { status: 500 });
  }

  const inFlight = await findUserInFlightJob(admin, user.id);
  if (inFlight) {
    return NextResponse.json(
      {
        reason: 'job_in_flight',
        message: 'You already have a review in progress. Wait for it to finish or cancel it.',
        activeJobId: inFlight.id,
      },
      { status: 409 },
    );
  }

  let headSha: string;
  try {
    const octokit = await createServerOctokit();
    const resolved = await resolveFreshReviewTarget(octokit, target);
    target = resolved.target;
    headSha = resolved.headSha;
  } catch (error) {
    if (error instanceof GithubAuthError || isAuthError(error)) {
      return githubErrorResponse(error);
    }
    logger.error(
      { err: error, source_job_id: id, user_id: user.id },
      '[api/jobs/rerun] head_sha resolution failed',
    );
    return NextResponse.json(
      { message: 'failed to resolve head SHA from GitHub' },
      { status: 502 },
    );
  }

  let jobId: string;
  try {
    const record = await admin.collection('review_jobs').create({
      user: user.id,
      github_login: githubLogin,
      target,
      status: 'pending',
      head_sha: headSha,
    });
    jobId = record.id;
  } catch (err) {
    logger.error({ err, source_job_id: id, user_id: user.id }, '[api/jobs/rerun] insert failed');
    return NextResponse.json({ message: 'failed to create job' }, { status: 500 });
  }

  const controller = new AbortController();
  const timeoutMin = Math.max(1, parseInt(process.env.REVIEW_TIMEOUT_MIN ?? '15', 10));
  const timeoutId = setTimeout(() => {
    admin
      .collection('review_jobs')
      .update(jobId, {
        status: 'error',
        completed_at: new Date().toISOString(),
        error_message: `timeout: job exceeded ${timeoutMin} min`,
      })
      .catch(() => {
        /* best-effort */
      })
      .finally(() => controller.abort('timeout'));
  }, timeoutMin * 60_000);

  registry.register(jobId, controller);

  runJob(jobId, token, headSha, target, controller.signal)
    .finally(() => {
      clearTimeout(timeoutId);
      registry.unregister(jobId);
    })
    .catch((err) => {
      logger.error({ err, job_id: jobId }, '[api/jobs/rerun] runJob rejected unexpectedly');
    });

  return NextResponse.json({ id: jobId });
}

function isNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  return (err as { status?: unknown }).status === 404;
}
