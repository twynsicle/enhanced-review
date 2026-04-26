import 'server-only';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { SUMMARY_SECTION_ID, type NarrativeReview } from '@enhanced-review/review-types';
import type { ReviewTarget } from '@enhanced-review/github-client';
import { getCurrentUser, pbServer } from '@/lib/pb';
import { MissingProviderTokenError, getGithubToken } from '@/lib/github/token';
import {
  type BranchHead,
  type PullMetadata,
  getBranchHead,
  getCommitsAhead,
  getPullMetadata,
} from '@/lib/github/view-time';
import type { ReviewJobRow, ReviewRow } from '@/lib/jobs/types';
import { ChapterReader } from './chapter-reader';
import { RerunButton } from './rerun-button';

/**
 * `/reviews/:id` — the rendered review reader.
 *
 * `:id` is the **`review_jobs.id`** (preserves the `/jobs/:id → /reviews/:id`
 * link Phase 5 wired up). The page fetches the joined `reviews` row and
 * fans out to GitHub for the SummaryCard metadata + staleness check.
 *
 * The page only renders for `done` jobs that produced a `reviews` row.
 * Unfinished or errored jobs send the user back to `/jobs/:id`. PB rules
 * let every workspace member read both collections — anyone in the beta
 * can view anyone's reviews.
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

  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const pb = await pbServer();

  let job: ReviewJobRow;
  try {
    job = await pb.collection('review_jobs').getOne<ReviewJobRow>(id);
  } catch {
    notFound();
  }

  // The reader is only meaningful for done jobs; pending / running /
  // error / cancelled jobs live on /jobs/:id.
  if (job.status !== 'done') {
    redirect(`/jobs/${id}`);
  }

  let review: ReviewRow;
  try {
    review = await pb
      .collection('reviews')
      .getFirstListItem<ReviewRow>(`job = "${id}"`);
  } catch {
    // status=done but no row — should be impossible per Phase 4 guarantees.
    // Send the user back to the live view so they can see whatever state
    // exists rather than rendering an empty reader.
    redirect(`/jobs/${id}`);
  }

  const target = job.target;
  const owner = target.owner;
  const repo = target.repo;
  const baseRef = target.baseSha;
  const headRef = job.head_sha;

  // GitHub view-time fetches. All graceful: if the viewer can't reach
  // GitHub, the chapters / insights / markdown still render.
  let token: string | null = null;
  try {
    token = await getGithubToken();
  } catch (error) {
    if (!(error instanceof MissingProviderTokenError)) throw error;
  }

  let pullMetadata: PullMetadata | null = null;
  let currentHeadSha: string | null = null;
  let commitsAhead = 0;

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
    } else {
      const branch = await getBranchHead({ owner, repo, ref: target.ref, token });
      if (branch.ok) {
        currentHeadSha = branch.data.sha;
        // Synthesise a thin PullMetadata-shaped record for the SummaryCard
        // so the branch case doesn't need its own component.
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

  const isStale = currentHeadSha !== null && currentHeadSha !== job.head_sha;
  const activeId = parseActiveId(sp.ch, review.content.chapters);

  return (
    <main className="mx-auto flex min-h-full w-full max-w-7xl flex-col gap-4 px-6 py-6">
      <ReviewHeader job={job} review={review.content} target={target} />

      {review.diff_truncated && <TruncationBanner />}
      {isStale && <StalenessBanner jobId={job.id} commitsAhead={commitsAhead} />}

      <ChapterReader
        review={review.content}
        target={target}
        pullMetadata={pullMetadata}
        owner={owner}
        repo={repo}
        baseRef={baseRef}
        headRef={headRef}
        initialActiveId={activeId}
      />
    </main>
  );
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

function ReviewHeader({
  job,
  review,
  target,
}: {
  job: ReviewJobRow;
  review: NarrativeReview;
  target: ReviewTarget;
}) {
  const targetLabel =
    target.kind === 'pr'
      ? `${target.owner}/${target.repo} PR #${String(target.number)}`
      : `${target.owner}/${target.repo} branch:${target.ref}`;
  return (
    <header className="flex flex-col gap-2 border-b border-foreground/10 pb-4">
      <div className="text-xs text-muted-foreground">
        <Link href="/" className="hover:underline">
          ← Home
        </Link>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-mono text-sm font-medium break-all">{targetLabel}</h1>
          <p className="text-xs text-muted-foreground">
            Reviewed by <span className="font-medium">@{job.github_login}</span> ·{' '}
            <code className="rounded bg-muted px-1 py-0.5">{job.head_sha.slice(0, 7)}</code>
            {review.prTitle && <> · {review.prTitle}</>}
          </p>
        </div>
        <RerunButton jobId={job.id} />
      </div>
    </header>
  );
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
