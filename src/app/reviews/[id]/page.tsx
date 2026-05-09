import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { SUMMARY_SECTION_ID, type NarrativeReview } from '@enhanced-review/review-types';
import type { ReviewTarget } from '@enhanced-review/github-client';
import { Topbar } from '@/components/topbar/topbar';
import { auth } from '@/lib/auth/auth';
import { db } from '@/lib/db/client';
import { reviewJobs, reviews } from '@/lib/db/schema';
import { MissingProviderTokenError, getGithubTokenFor } from '@/lib/github/token';
import {
  type BranchHead,
  type PullMetadata,
  type PullReviewer,
  getBranchHead,
  getCommitsAhead,
  getPullMetadata,
  getPullReviewers,
} from '@/lib/github/view-time';
import { toJobRow, toReviewRow, type ReviewJobRow } from '@/lib/jobs/types';
import { ChapterReader } from './chapter-reader';
import { RerunButton } from './rerun-button';

/**
 * `/reviews/:id` — the rendered review reader.
 *
 * `:id` is the **`review_jobs.id`**. The page fetches the joined `reviews`
 * row and fans out to GitHub for the SummaryCard metadata + staleness check.
 *
 * Renders only for `done` jobs that produced a `reviews` row. Unfinished
 * or errored jobs send the user back to `/jobs/:id`.
 */
export const dynamic = 'force-dynamic';

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const session = await auth();
  if (!session?.user) redirect('/login');

  const jobRows = await db.select().from(reviewJobs).where(eq(reviewJobs.id, id)).limit(1);
  if (jobRows.length === 0) notFound();
  const job: ReviewJobRow = toJobRow(jobRows[0]);

  if (job.status !== 'done') {
    redirect(`/jobs/${id}`);
  }

  const reviewRows = await db.select().from(reviews).where(eq(reviews.jobId, id)).limit(1);
  if (reviewRows.length === 0) {
    redirect(`/jobs/${id}`);
  }
  const review = toReviewRow(reviewRows[0]);

  const target = job.target;
  const owner = target.owner;
  const repo = target.repo;
  const baseRef = target.baseSha;
  const headRef = job.head_sha;

  let token: string | null = null;
  try {
    token = await getGithubTokenFor(session.user.id);
  } catch (error) {
    if (!(error instanceof MissingProviderTokenError)) throw error;
  }

  let pullMetadata: PullMetadata | null = null;
  let currentHeadSha: string | null = null;
  let commitsAhead = 0;
  let reviewers: PullReviewer[] = [];

  if (token) {
    if (target.kind === 'pr') {
      const md = await getPullMetadata({
        owner,
        repo,
        number: target.number,
        token,
      });
      if (md.ok) {
        pullMetadata = md.data;
        currentHeadSha = md.data.headSha;
      }
      const rev = await getPullReviewers({
        owner,
        repo,
        number: target.number,
        token,
      });
      if (rev.ok) reviewers = rev.data;
    } else {
      const branch = await getBranchHead({ owner, repo, ref: target.ref, token });
      if (branch.ok) {
        currentHeadSha = branch.data.sha;
        pullMetadata = synthesizeBranchSummary(target, branch.data, job);
      }
    }

    if (currentHeadSha && currentHeadSha !== job.head_sha) {
      const compare = await getCommitsAhead({
        owner,
        repo,
        base: job.head_sha,
        head: currentHeadSha,
        token,
      });
      if (compare.ok) commitsAhead = compare.data.count;
    }
  }

  const aiReviewer = {
    durationMs: deriveDurationMs(job.started_at, job.completed_at),
    insightCount: review.content.chapters.reduce((sum, ch) => sum + ch.insights.length, 0),
  };

  const isStale = currentHeadSha !== null && currentHeadSha !== job.head_sha;
  const activeId = parseActiveId(sp.ch, review.content.chapters);

  const login = session.user.githubLogin ?? session.user.email ?? session.user.id;
  const avatarUrl = session.user.image ?? null;
  const fullName = session.user.name && session.user.name.length > 0 ? session.user.name : null;

  return (
    <>
      <Topbar user={{ login, fullName, avatarUrl }} />
      <main className="mx-auto flex min-h-full w-full max-w-[var(--review-max-width,92rem)] flex-col gap-4 px-6 py-8">
        {review.diff_truncated && <TruncationBanner />}
        {isStale && <StalenessBanner jobId={job.id} commitsAhead={commitsAhead} />}

        <ChapterReader
          review={review.content}
          target={target}
          pullMetadata={pullMetadata}
          reviewers={reviewers}
          aiReviewer={aiReviewer}
          owner={owner}
          repo={repo}
          baseRef={baseRef}
          headRef={headRef}
          initialActiveId={activeId}
          jobId={job.id}
          jobAuthor={job.github_login}
          jobHeadSha={job.head_sha}
        />
      </main>
    </>
  );
}

function deriveDurationMs(started: string | null, completed: string | null): number | null {
  if (!started || !completed) return null;
  const startMs = Date.parse(started);
  const endMs = Date.parse(completed);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null;
  const diff = endMs - startMs;
  return diff > 0 ? diff : null;
}

function synthesizeBranchSummary(
  target: Extract<ReviewTarget, { kind: 'branch' }>,
  branch: BranchHead,
  job: ReviewJobRow,
): PullMetadata {
  return {
    title: branch.commitMessage.split('\n')[0] || target.ref,
    authorLogin: job.github_login,
    authorAvatarUrl: `https://github.com/${job.github_login}.png`,
    body: null,
    baseRefName: target.baseRef,
    headRefName: target.ref,
    baseSha: target.baseSha,
    headSha: branch.sha,
    changedFiles: 0,
    additions: 0,
    deletions: 0,
    htmlUrl: `https://github.com/${target.owner}/${target.repo}/tree/${target.ref}`,
  };
}

function parseActiveId(
  raw: string | string[] | undefined,
  chapters: NarrativeReview['chapters'],
): string {
  if (typeof raw !== 'string' || raw.length === 0) return SUMMARY_SECTION_ID;
  if (raw === SUMMARY_SECTION_ID) return SUMMARY_SECTION_ID;
  if (chapters.some((ch) => ch.id === raw)) return raw;
  return SUMMARY_SECTION_ID;
}

function TruncationBanner() {
  return (
    <div
      role="status"
      className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200"
    >
      <strong className="font-semibold">Diff was truncated</strong> to fit the token budget — some
      files may not be included in this review.
    </div>
  );
}

function StalenessBanner({ jobId, commitsAhead }: { jobId: string; commitsAhead: number }) {
  const label =
    commitsAhead === 0
      ? 'New commits since this review.'
      : `${String(commitsAhead)} new commit${commitsAhead === 1 ? '' : 's'} since this review.`;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-sky-500/40 bg-sky-500/10 px-4 py-3 text-sm text-sky-900 dark:text-sky-200"
    >
      <span>{label}</span>
      <RerunButton jobId={jobId} variant="banner" />
    </div>
  );
}
