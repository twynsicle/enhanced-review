import 'server-only';
import { GithubAuthError, isAuthError, type ReviewTarget } from '@enhanced-review/github-client';
import { NextResponse } from 'next/server';
import { getGithubLogin } from '@/lib/auth/allowlist';
import { createServerOctokit, githubErrorResponse } from '@/lib/github/server';
import { findUserInFlightJob } from '@/lib/jobs/concurrency';
import { logger } from '@/lib/log';
import { ReviewTargetSchema } from '@/lib/jobs/target';
import { getCurrentUser, pbAdmin } from '@/lib/pb';

/**
 * POST /api/jobs
 *
 * Create a `review_jobs` row for the supplied `ReviewTarget`. The picker
 * page POSTs here when the user clicks the "Review" button.
 *
 * Auth model:
 *   - Session is verified via `getCurrentUser()` (PB).
 *   - The route then re-resolves `head_sha` server-side — the picker may
 *     have selected a target before recent pushes landed.
 *   - The insert runs through `pbAdmin()` because `review_jobs.createRule`
 *     is server-only.
 *
 * Returns `{ id }` on success. 401 on missing session. 400 on bad body.
 *
 * Phase 3: row is created at status `pending` but no runner is hooked up
 * yet, so the job sits at `pending` forever. Phase 4 wires the in-process
 * runner in and starts pulling the GitHub token off the session here.
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

  try {
    const record = await admin.collection('review_jobs').create({
      user: user.id,
      github_login: githubLogin,
      target,
      status: 'pending',
      head_sha: headSha,
    });
    return NextResponse.json({ id: record.id });
  } catch (err) {
    logger.error({ err, user_id: user.id }, '[api/jobs] insert failed');
    return NextResponse.json({ message: 'failed to create job' }, { status: 500 });
  }
}
