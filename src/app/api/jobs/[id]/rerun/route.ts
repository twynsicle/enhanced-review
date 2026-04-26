import 'server-only';
import { GithubAuthError, isAuthError, type ReviewTarget } from '@enhanced-review/github-client';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getGithubLogin } from '@/lib/auth/allowlist';
import { MissingProviderTokenError, getGithubToken } from '@/lib/github/token';
import { createServerOctokit, githubErrorResponse } from '@/lib/github/server';
import { findUserInFlightJob } from '@/lib/jobs/concurrency';
import { logger } from '@/lib/log';
import { getCurrentUser } from '@/lib/pb';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient as createServerSupabase } from '@/lib/supabase/server';

/**
 * POST /api/jobs/[id]/rerun
 *
 * Create a fresh `review_jobs` row that mirrors the source job's
 * `target` but pinned to the *current* head SHA on GitHub. The new job
 * is owned by the *viewer*, not the original requester — workspace
 * members can re-run each other's reviews and the new row reflects who
 * actually paid for the work.
 *
 * Returns 200 with `{ id }` of the new job. 401 / `github_token_invalid`
 * when the viewer needs to re-link. 404 when the source job doesn't
 * exist or RLS hides it. 502 when the GitHub head-SHA refresh fails.
 */
export const dynamic = 'force-dynamic';

const idSchema = z.string().uuid();

export async function POST(_req: NextRequest, ctx: RouteContext<'/api/jobs/[id]/rerun'>) {
  const { id } = await ctx.params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ message: 'invalid job id' }, { status: 400 });
  }

  // 1. Session.
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: 'unauthorized' }, { status: 401 });
  }

  // Phase 3 will move the source-job lookup to PB.
  const supabase = await createServerSupabase();

  const githubLogin = getGithubLogin(user);
  if (!githubLogin) {
    return NextResponse.json(
      { reason: 'github_token_invalid', message: 'No GitHub identity on this session.' },
      { status: 401 },
    );
  }

  // 2. Source job (workspace-readable via RLS — anyone in the beta can
  // re-run anyone's review).
  const { data: source } = await supabase
    .from('review_jobs')
    .select('target')
    .eq('id', id)
    .maybeSingle<{ target: ReviewTarget }>();

  if (!source) {
    return NextResponse.json({ message: 'job not found' }, { status: 404 });
  }
  const target = source.target;

  // 3. Per-user concurrency cap. Re-run is just another submission, so
  // the same gate applies — point the user at their existing in-flight
  // job rather than queueing a duplicate.
  const admin = createAdminClient();
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

  // 4. Re-resolve head_sha from GitHub. The whole point of re-running is
  // to capture commits added since the original review.
  let headSha: string;
  try {
    const octokit = await createServerOctokit();
    if (target.kind === 'pr') {
      const { data } = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
        owner: target.owner,
        repo: target.repo,
        pull_number: target.number,
      });
      headSha = data.head.sha;
    } else {
      const { data } = await octokit.request('GET /repos/{owner}/{repo}/branches/{branch}', {
        owner: target.owner,
        repo: target.repo,
        branch: target.ref,
      });
      headSha = data.commit.sha;
    }
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

  // 5. Pull the viewer's GitHub token for the worker's clone.
  let providerToken: string;
  try {
    providerToken = await getGithubToken();
  } catch (error) {
    if (error instanceof MissingProviderTokenError) {
      return NextResponse.json(
        { reason: 'github_token_invalid', message: 'GitHub token is invalid; please re-link.' },
        { status: 401 },
      );
    }
    throw error;
  }

  // 6. Insert the new job, attributed to the viewer.
  const { data: jobId, error: insertError } = await admin.rpc('create_review_job_with_token', {
    p_user_id: user.id,
    p_github_login: githubLogin,
    p_target: target,
    p_head_sha: headSha,
    p_token: providerToken,
  });

  if (insertError || !jobId) {
    logger.error(
      { err: insertError, source_job_id: id, user_id: user.id },
      '[api/jobs/rerun] insert failed',
    );
    return NextResponse.json({ message: 'failed to create job' }, { status: 500 });
  }

  return NextResponse.json({ id: jobId });
}
