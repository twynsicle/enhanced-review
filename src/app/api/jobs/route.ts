import 'server-only';
import { GithubAuthError, isAuthError, type ReviewTarget } from '@enhanced-review/github-client';
import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { db, pool } from '@/lib/db/client';
import { reviewJobs } from '@/lib/db/schema';
import { createServerOctokit, githubErrorResponse } from '@/lib/github/server';
import { getGithubTokenFor } from '@/lib/github/token';
import { maxJobsPerUser } from '@/lib/jobs/concurrency';
import { logger } from '@/lib/log';
import { ReviewTargetSchema } from '@/lib/jobs/target';
import { resolveFreshReviewTarget } from '@/lib/jobs/resolve-target';
import * as registry from '@/lib/jobs/runner/registry';
import { runJob } from '@/lib/jobs/runner/run';

/**
 * POST /api/jobs
 *
 * Create a `review_jobs` row for the supplied `ReviewTarget`, then kick off
 * the in-process runner fire-and-forget. Returns `{ id }` immediately.
 *
 * Auth: Auth.js session via `auth()`. GitHub access token is read from the
 * `accounts` table via `getGithubTokenFor(userId)`, never from a cookie.
 *
 * Concurrency check + insert run inside a single Drizzle transaction so two
 * simultaneous submits can't both pass the count check.
 */
export const dynamic = 'force-dynamic';

class ConcurrencyError extends Error {
  activeJobId: string;
  constructor(activeJobId: string) {
    super('job_in_flight');
    this.activeJobId = activeJobId;
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: 'unauthorized' }, { status: 401 });
  }

  const githubLogin = session.user.githubLogin;
  if (!githubLogin) {
    return NextResponse.json(
      { reason: 'github_token_invalid', message: 'No GitHub identity on this session.' },
      { status: 401 },
    );
  }

  const token = await getGithubTokenFor(session.user.id);
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
    logger.error({ err: error, user_id: session.user.id }, '[api/jobs] head_sha resolution failed');
    return NextResponse.json(
      { message: 'failed to resolve head SHA from GitHub' },
      { status: 502 },
    );
  }

  let jobId: string;
  try {
    const cap = maxJobsPerUser();
    const newJob = await db.transaction(async (tx) => {
      const activeRows = await tx
        .select({ id: reviewJobs.id })
        .from(reviewJobs)
        .where(
          and(
            eq(reviewJobs.userId, session.user.id),
            inArray(reviewJobs.status, ['pending', 'running']),
          ),
        )
        .limit(cap);
      if (activeRows.length >= cap) {
        throw new ConcurrencyError(activeRows[0]?.id ?? '');
      }
      const [row] = await tx
        .insert(reviewJobs)
        .values({
          userId: session.user.id,
          githubLogin,
          target,
          status: 'pending',
          headSha,
        })
        .returning({ id: reviewJobs.id });
      return row;
    });
    jobId = newJob.id;
  } catch (err) {
    if (err instanceof ConcurrencyError) {
      return NextResponse.json(
        {
          reason: 'job_in_flight',
          message: 'You already have a review in progress. Wait for it to finish or cancel it.',
          activeJobId: err.activeJobId,
        },
        { status: 409 },
      );
    }
    logger.error({ err, user_id: session.user.id }, '[api/jobs] insert failed');
    return NextResponse.json({ message: 'failed to create job' }, { status: 500 });
  }

  // Fire-and-forget: register the controller, start the runner, return immediately.
  const userId = session.user.id;
  const controller = new AbortController();
  const timeoutMin = Math.max(1, parseInt(process.env.REVIEW_TIMEOUT_MIN ?? '15', 10));
  const timeoutId = setTimeout(() => {
    void (async () => {
      try {
        await db
          .update(reviewJobs)
          .set({
            status: 'error',
            completedAt: new Date(),
            errorMessage: `timeout: job exceeded ${String(timeoutMin)} min`,
            updatedAt: new Date(),
          })
          .where(eq(reviewJobs.id, jobId));
        await pool.query('SELECT pg_notify($1, $2)', [
          `job_${jobId}`,
          JSON.stringify({
            type: 'status',
            status: 'error',
            errorMessage: `timeout: job exceeded ${String(timeoutMin)} min`,
          }),
        ]);
        await pool.query('SELECT pg_notify($1, $2)', [
          `user_${userId}:terminal`,
          JSON.stringify({ jobId, status: 'error' }),
        ]);
      } catch (err) {
        logger.warn({ err, job_id: jobId }, '[api/jobs] timeout writer failed');
      } finally {
        controller.abort('timeout');
      }
    })();
  }, timeoutMin * 60_000);

  registry.register(jobId, controller);

  runJob(jobId, userId, token, headSha, target, controller.signal)
    .finally(() => {
      clearTimeout(timeoutId);
      registry.unregister(jobId);
    })
    .catch((err) => {
      logger.error({ err, job_id: jobId }, '[api/jobs] runJob rejected unexpectedly');
    });

  return NextResponse.json({ id: jobId });
}
