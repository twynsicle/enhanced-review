import 'server-only';
import { GithubAuthError, isAuthError, type ReviewTarget } from '@enhanced-review/github-client';
import { NextResponse } from 'next/server';
import { getGithubLogin } from '@/lib/auth/allowlist';
import { createServerOctokit, githubErrorResponse } from '@/lib/github/server';
import { findUserInFlightJob } from '@/lib/jobs/concurrency';
import { logger } from '@/lib/log';
import { ReviewTargetSchema } from '@/lib/jobs/target';
import { resolveFreshReviewTarget } from '@/lib/jobs/resolve-target';
import { getCurrentUser, pbAdmin, readGithubTokenCookie } from '@/lib/pb';
import * as registry from '@/lib/jobs/runner/registry';
import { runJob } from '@/lib/jobs/runner/run';

/**
 * POST /api/jobs
 *
 * Create a `review_jobs` row for the supplied `ReviewTarget`, then kick off
 * the in-process runner fire-and-forget. Returns `{ id }` immediately.
 *
 * Auth model:
 *   - Session verified via `getCurrentUser()` (PB).
 *   - GitHub token read from the HttpOnly `gh_access_token` cookie — set at
 *     OAuth time by /api/auth/post-signin and never persisted to the DB.
 *   - Row insert uses `pbAdmin()` because `review_jobs.createRule` is server-only.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'invalid JSON body' }, { status: 400 });
  }

  const parsed = ReviewTargetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { message: 'invalid review target', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  let target: ReviewTarget = parsed.data;

  const admin = await pbAdmin();
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
    logger.error({ err: error, user_id: user.id }, '[api/jobs] head_sha resolution failed');
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
    logger.error({ err, user_id: user.id }, '[api/jobs] insert failed');
    return NextResponse.json({ message: 'failed to create job' }, { status: 500 });
  }

  // Fire-and-forget: register the controller, start the runner, return immediately.
  const controller = new AbortController();
  const timeoutMin = Math.max(1, parseInt(process.env.REVIEW_TIMEOUT_MIN ?? '15', 10));
  const timeoutId = setTimeout(() => {
    // Write timeout error status before aborting so runJob's signal.aborted
    // check skips further status writes.
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
      logger.error({ err, job_id: jobId }, '[api/jobs] runJob rejected unexpectedly');
    });

  return NextResponse.json({ id: jobId });
}
