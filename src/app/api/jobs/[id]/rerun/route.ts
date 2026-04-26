import 'server-only';
import { GithubAuthError, isAuthError, type ReviewTarget } from '@enhanced-review/github-client';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getGithubLogin } from '@/lib/auth/allowlist';
import { createServerOctokit, githubErrorResponse } from '@/lib/github/server';
import { findUserInFlightJob } from '@/lib/jobs/concurrency';
import { logger } from '@/lib/log';
import { getCurrentUser, pbAdmin } from '@/lib/pb';

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
 * Phase 3: the runner isn't hooked up yet, so the new row sits at
 * `pending` forever. Phase 4 wires the runner in and starts pulling
 * the viewer's GitHub token off the session here.
 */
export const dynamic = 'force-dynamic';

const idSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/).min(1).max(40);

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
    logger.error({ err, source_job_id: id, user_id: user.id }, '[api/jobs/rerun] source lookup failed');
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
    logger.error(
      { err, source_job_id: id, user_id: user.id },
      '[api/jobs/rerun] insert failed',
    );
    return NextResponse.json({ message: 'failed to create job' }, { status: 500 });
  }
}

function isNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  return (err as { status?: unknown }).status === 404;
}
