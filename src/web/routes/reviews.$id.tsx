import {
  data,
  isRouteErrorResponse,
  redirect,
  type ShouldRevalidateFunctionArgs,
} from 'react-router';
import { z } from 'zod';
import { getJob, getReview, toJobView } from '@/domain/jobs/jobs.server';
import { SUMMARY_SECTION_ID, type NarrativeReview } from '@/domain/review/narrative';
import { reviewMetaFromJob } from '@/domain/review/review-meta';
import { readGithubToken } from '@/web/auth/cookies.server';
import { AppError } from '@/web/components/app-error';
import { JobNotFound } from '@/web/components/jobs/job-not-found';
import { RerunButton } from '@/web/components/jobs/rerun-button';
import { StalenessBanner } from '@/web/components/jobs/review-banners';
import { ChapterReader } from '@/web/components/narrative/chapter-reader';
import { GithubFileSource } from '@/web/components/narrative/file-source';
import { PageShell } from '@/web/components/page-shell';
import { parseFormData, parseParams, parseSearchParams } from '@/web/lib/parse.server';
import { READER_HANDLE } from '@/web/lib/reader-route';
import { rerunAction } from '@/web/lib/rerun-action.server';
import { loadReviewMetadata } from '@/web/lib/review-metadata.server';
import type { Route } from './+types/reviews.$id';

const ParamsSchema = z.object({ id: z.string().min(1) });
const SearchSchema = z.object({ ch: z.string().optional(), file: z.string().optional() });
const IntentSchema = z.object({ intent: z.literal('rerun') });

// The one page that takes the whole window and offers the reader's display
// preferences; the topbar reads this through `useIsReader`.
export const handle = READER_HANDLE;

export const meta: Route.MetaFunction = ({ loaderData }) => [
  {
    title: loaderData
      ? `${loaderData.review.prTitle} · enhanced-review`
      : 'Review · enhanced-review',
  },
];

function parseActiveId(raw: string | undefined, chapters: NarrativeReview['chapters']): string {
  if (!raw || raw === SUMMARY_SECTION_ID) return SUMMARY_SECTION_ID;
  return chapters.some((ch) => ch.id === raw) ? raw : SUMMARY_SECTION_ID;
}

/**
 * `/reviews/:id` — the rendered reader for a `done` job (`:id` is the job id,
 * so the live view's hand-off keeps its link). Unfinished jobs, and the
 * impossible done-without-review case, go back to `/jobs/:id`. GitHub is
 * consulted with whatever token the viewer has; without one, or when GitHub
 * refuses, the page still renders from the stored review.
 */
export async function loader({ params, request }: Route.LoaderArgs) {
  const { id } = parseParams(ParamsSchema, params);
  const { ch } = parseSearchParams(SearchSchema, request);
  const job = await getJob(id);
  if (!job) throw data(null, { status: 404 });
  if (job.status !== 'done') throw redirect(`/jobs/${id}`);
  const review = await getReview(id);
  if (!review) throw redirect(`/jobs/${id}`);

  const headSha = job.headSha ?? '';
  const metadata = await loadReviewMetadata({
    token: await readGithubToken(request),
    target: job.target,
    headSha,
    githubLogin: job.githubLogin,
  });

  return {
    job: toJobView(job),
    review: review.content,
    findings: review.findings,
    meta: reviewMetaFromJob(job.target, metadata.pullMetadata, job.githubLogin),
    isStale: metadata.currentHeadSha !== null && metadata.currentHeadSha !== headSha,
    commitsAhead: metadata.commitsAhead,
    initialActiveId: parseActiveId(ch, review.content.chapters),
  };
}

/**
 * `?ch=` / `?file=` changes are client-side section switches: the reader
 * already holds the whole review, so a search-param-only navigation must not
 * re-run the loader (and its GitHub fan-out). Submissions still revalidate.
 */
export function shouldRevalidate({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (!formMethod && currentUrl.pathname === nextUrl.pathname) return false;
  return defaultShouldRevalidate;
}

/** `intent=rerun` from the staleness banner (the header button posts to `/jobs/:id`). */
export async function action({ request, params, context }: Route.ActionArgs) {
  const { id } = parseParams(ParamsSchema, params);
  await parseFormData(IntentSchema, request);
  return rerunAction(request, context, id);
}

export default function ReviewPage({ loaderData }: Route.ComponentProps) {
  const { job, review } = loaderData;
  return (
    <PageShell
      py={32}
      width="reader"
      style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: '100%' }}
    >
      {loaderData.isStale && (
        <StalenessBanner jobId={job.id} commitsAhead={loaderData.commitsAhead} />
      )}
      <GithubFileSource
        owner={job.target.owner}
        repo={job.target.repo}
        baseRef={job.target.baseSha}
        headRef={job.headSha ?? ''}
      >
        <ChapterReader
          key={job.id}
          review={review}
          meta={loaderData.meta}
          initialActiveId={loaderData.initialActiveId}
          findings={loaderData.findings}
          actions={<RerunButton jobId={job.id} />}
        />
      </GithubFileSource>
    </PageShell>
  );
}

export function ErrorBoundary(props: Route.ErrorBoundaryProps) {
  if (isRouteErrorResponse(props.error) && props.error.status === 404) return <JobNotFound />;
  return <AppError error={props.error} />;
}
