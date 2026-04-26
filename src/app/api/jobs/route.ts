import 'server-only';
import { GithubAuthError, isAuthError, type ReviewTarget } from '@enhanced-review/github-client';
import { NextResponse } from 'next/server';
import { getGithubLogin } from '@/lib/auth/allowlist';
import { MissingProviderTokenError, getGithubToken } from '@/lib/github/token';
import { createServerOctokit, githubErrorResponse } from '@/lib/github/server';
import { findUserInFlightJob } from '@/lib/jobs/concurrency';
import { logger } from '@/lib/log';
import { ReviewTargetSchema } from '@/lib/jobs/target';
import { getCurrentUser } from '@/lib/pb';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * POST /api/jobs
 *
 * Create a `review_jobs` row for the supplied `ReviewTarget`. The picker
 * page POSTs here when the user clicks the "Review" button.
 *
 * Auth model:
 *   - Session is verified via @supabase/ssr (`getUser`).
 *   - The route then reaches for the user's GitHub provider_token to
 *     re-resolve `head_sha` server-side — the picker may have selected
 *     a target before recent pushes landed.
 *   - The insert runs through the service-role client so the row can be
 *     written with `user_id` + `github_login` copied from the verified
 *     session (RLS would otherwise restrict what columns can be set).
 *
 * Returns `{ id }` on success. 401 on missing/invalid session or
 * provider_token (client redirects to /relink). 400 on bad body.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  // 1. Session
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

  // 2. Body
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
  const target: ReviewTarget = parsed.data;

  // 3. Per-user concurrency cap. The client treats `reason: 'job_in_flight'`
  // as a "you already have a review running" prompt linking to the active
  // job rather than an error toast.
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

  // 4. Re-resolve head_sha from GitHub (always — the client value is a
  // hint, not a source of truth). Token errors map to the same shape the
  // picker already handles.
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
    logger.error({ err: error, user_id: user.id }, '[api/jobs] head_sha resolution failed');
    return NextResponse.json(
      { message: 'failed to resolve head SHA from GitHub' },
      { status: 502 },
    );
  }

  // 5. Pull the GitHub token off the session — the worker needs it to
  // clone the user's repo. Stored encrypted on the job row via pgsodium
  // (see migration 0003) and NULLed by the worker as soon as the clone
  // returns. Missing token => same 401 shape the picker handles.
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

  // 6. Insert via service role using the encrypt-and-create RPC so the
  // row is never visible without its token.
  const { data: jobId, error: insertError } = await admin.rpc('create_review_job_with_token', {
    p_user_id: user.id,
    p_github_login: githubLogin,
    p_target: target,
    p_head_sha: headSha,
    p_token: providerToken,
  });

  if (insertError || !jobId) {
    logger.error({ err: insertError, user_id: user.id }, '[api/jobs] insert failed');
    return NextResponse.json({ message: 'failed to create job' }, { status: 500 });
  }

  return NextResponse.json({ id: jobId });
}
