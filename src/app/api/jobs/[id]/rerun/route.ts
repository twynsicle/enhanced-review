import 'server-only';
import { GithubAuthError, isAuthError, type ReviewTarget } from '@enhanced-review/github-client';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { db, pool } from '@/lib/db/client';
import { reviewJobs } from '@/lib/db/schema';
import { createServerOctokit, githubErrorResponse } from '@/lib/github/server';
import { getGithubTokenFor } from '@/lib/github/token';
import { maxJobsPerUser } from '@/lib/jobs/concurrency';
import { resolveFreshReviewTarget } from '@/lib/jobs/resolve-target';
import { logger } from '@/lib/log';
import * as registry from '@/lib/jobs/runner/registry';
import { runJob } from '@/lib/jobs/runner/run';

/**
 * POST /api/jobs/[id]/rerun
 *
 * Create a fresh `review_jobs` row that mirrors the source job's `target`
 * but pinned to the *current* head SHA on GitHub. The new job is owned by
 * the *viewer*, not the original requester — workspace members can re-run
 * each other's reviews and the new row reflects who actually paid for
 * the work.
 *
 * Returns 200 with `{ id }` of the new job. 401 on missing session.
 * 404 when the source job doesn't exist. 502 when the GitHub head-SHA
 * refresh fails.
 */
export const dynamic = 'force-dynamic';

class ConcurrencyError extends Error {
  activeJobId: string;
  constructor(activeJobId: string) {
    super('job_in_flight');
    this.activeJobId = activeJobId;
  }
}

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

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: 'unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  const githubLogin = session.user.githubLogin;
  if (!githubLogin) {
    return NextResponse.json(
      { reason: 'github_token_invalid', message: 'No GitHub identity on this session.' },
      { status: 401 },
    );
  }

  const token = await getGithubTokenFor(userId);
  if (!token) {
    return NextResponse.json(
      { reason: 'github_token_missing', message: 'GitHub token missing — re-link your account.' },
      { status: 401 },
    );
  }

  let target: ReviewTarget;
  try {
    const sourceRows = await db
      .select({ id: reviewJobs.id, target: reviewJobs.target })
      .from(reviewJobs)
      .where(eq(reviewJobs.id, id))
      .limit(1);
    if (sourceRows.length === 0) {
      return NextResponse.json({ message: 'job not found' }, { status: 404 });
    }
    target = sourceRows[0].target;
  } catch (err) {
    logger.error(
      { err, source_job_id: id, user_id: userId },
      '[api/jobs/rerun] source lookup failed',
    );
    return NextResponse.json({ message: 'failed to load source job' }, { status: 500 });
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
      { err: error, source_job_id: id, user_id: userId },
      '[api/jobs/rerun] head_sha resolution failed',
    );
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
          and(eq(reviewJobs.userId, userId), inArray(reviewJobs.status, ['pending', 'running'])),
        )
        .limit(cap);
      if (activeRows.length >= cap) {
        throw new ConcurrencyError(activeRows[0]?.id ?? '');
      }
      const [row] = await tx
        .insert(reviewJobs)
        .values({
          userId,
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
    logger.error({ err, source_job_id: id, user_id: userId }, '[api/jobs/rerun] insert failed');
    return NextResponse.json({ message: 'failed to create job' }, { status: 500 });
  }

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
        logger.warn({ err, job_id: jobId }, '[api/jobs/rerun] timeout writer failed');
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
      logger.error({ err, job_id: jobId }, '[api/jobs/rerun] runJob rejected unexpectedly');
    });

  return NextResponse.json({ id: jobId });
}
