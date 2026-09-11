// @vitest-environment node
import { RouterContextProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Review, ReviewJob } from '@/domain/jobs/jobs.server';
import type { ReviewMetadata } from '@/web/lib/review-metadata.server';

const jobs = {
  getJob: vi.fn<(id: string) => Promise<ReviewJob | null>>(),
  getReview: vi.fn<(id: string) => Promise<Review | null>>(),
  toJobView: vi.fn((job: ReviewJob) => ({ id: job.id, status: job.status })),
};
const cookies = { readGithubToken: vi.fn<() => Promise<string | null>>() };
const metadata = {
  loadReviewMetadata: vi.fn<() => Promise<ReviewMetadata>>(),
  deriveDurationMs: vi.fn(() => 20_000),
};
const rerun = { rerunAction: vi.fn(() => Promise.resolve(new Response(null, { status: 302 }))) };
vi.mock('@/domain/jobs/jobs.server', () => jobs);
vi.mock('@/web/auth/cookies.server', () => cookies);
vi.mock('@/web/lib/review-metadata.server', () => metadata);
vi.mock('@/web/lib/rerun-action.server', () => rerun);

const { loader, action } = await import('./reviews.$id');

const JOB = {
  id: 'j1',
  status: 'done',
  headSha: 'aaaa',
  githubLogin: 'alice',
  startedAt: new Date('2026-01-01T00:00:00Z'),
  completedAt: new Date('2026-01-01T00:00:20Z'),
  target: {
    kind: 'pr',
    owner: 'o',
    repo: 'r',
    number: 7,
    headSha: 'aaaa',
    baseSha: 'b',
    title: 't',
  },
} as unknown as ReviewJob;
const REVIEW: Review = {
  jobId: 'j1',
  diffTruncated: true,
  createdAt: new Date(),
  content: {
    prTitle: 'Feature',
    overviewSummary: 'lead',
    chapters: [
      { id: 'ch1', title: 'One', insights: [{ type: 'context', text: 'a' }], diffChunks: [] },
      { id: 'ch2', title: 'Two', insights: [{ type: 'highlight', text: 'b' }], diffChunks: [] },
    ],
  },
};
const EMPTY: ReviewMetadata = {
  pullMetadata: null,
  currentHeadSha: null,
  commitsAhead: 0,
};

type Thrown = { init?: { status?: number }; data?: unknown };
const caught = (promise: Promise<unknown>) => promise.catch((e: unknown) => e);
const load = (url: string, id = 'j1') =>
  loader({
    request: new Request(url),
    params: { id },
    context: new RouterContextProvider(),
  } as never);

beforeEach(() => {
  vi.clearAllMocks();
  jobs.getJob.mockResolvedValue(JOB);
  jobs.getReview.mockResolvedValue(REVIEW);
  cookies.readGithubToken.mockResolvedValue('gh-token');
  metadata.loadReviewMetadata.mockResolvedValue(EMPTY);
});

describe('/reviews/:id loader', () => {
  it('throws 404 for an unknown id', async () => {
    jobs.getJob.mockResolvedValue(null);
    const thrown = (await caught(load('http://localhost/reviews/nope', 'nope'))) as Thrown;
    expect(thrown.init?.status).toBe(404);
  });

  it('sends unfinished jobs back to the live view', async () => {
    jobs.getJob.mockResolvedValue({ ...JOB, status: 'running' });
    const thrown = (await caught(load('http://localhost/reviews/j1'))) as Response;
    expect(thrown.status).toBe(302);
    expect(thrown.headers.get('location')).toBe('/jobs/j1');
  });

  it('sends a done job without a review row back to the live view', async () => {
    jobs.getReview.mockResolvedValue(null);
    const thrown = (await caught(load('http://localhost/reviews/j1'))) as Response;
    expect(thrown.headers.get('location')).toBe('/jobs/j1');
  });

  it('returns the reader data with the summary active by default', async () => {
    const result = await load('http://localhost/reviews/j1');
    expect(result).toMatchObject({
      job: { id: 'j1' },
      review: { prTitle: 'Feature' },
      diffTruncated: true,
      meta: { authorLogin: 'alice', stats: null, description: null },
      isStale: false,
      commitsAhead: 0,
      initialActiveId: '__summary__',
    });
    expect(metadata.loadReviewMetadata).toHaveBeenCalledWith({
      token: 'gh-token',
      target: JOB.target,
      headSha: 'aaaa',
      githubLogin: 'alice',
    });
  });

  it('honours a known ?ch= and falls back to the summary for an unknown one', async () => {
    expect((await load('http://localhost/reviews/j1?ch=ch2')).initialActiveId).toBe('ch2');
    expect((await load('http://localhost/reviews/j1?ch=zzz')).initialActiveId).toBe('__summary__');
  });

  it('flags staleness when GitHub reports a different head', async () => {
    metadata.loadReviewMetadata.mockResolvedValue({
      ...EMPTY,
      currentHeadSha: 'cccc',
      commitsAhead: 2,
    });
    const result = await load('http://localhost/reviews/j1');
    expect(result.isStale).toBe(true);
    expect(result.commitsAhead).toBe(2);
  });

  it('renders without a GitHub token', async () => {
    cookies.readGithubToken.mockResolvedValue(null);
    const result = await load('http://localhost/reviews/j1');
    // No GitHub answer: the header falls back to the stored target.
    expect(result.meta.stats).toBeNull();
    expect(result.meta.description).toBeNull();
    expect(result.meta.authorLogin).toBe('alice');
    expect(metadata.loadReviewMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ token: null }),
    );
  });
});

describe('/reviews/:id action', () => {
  const post = (intent: string) => {
    const form = new FormData();
    form.set('intent', intent);
    const request = new Request('http://localhost/reviews/j1', { method: 'POST', body: form });
    return action({ request, params: { id: 'j1' }, context: new RouterContextProvider() } as never);
  };

  it('rerun delegates to the shared rerun action for this job', async () => {
    const res = (await post('rerun')) as Response;
    expect(res.status).toBe(302);
    expect(rerun.rerunAction).toHaveBeenCalledWith(expect.any(Request), expect.anything(), 'j1');
  });

  it('rejects any other intent with 400', async () => {
    const thrown = (await caught(post('cancel'))) as Thrown;
    expect(thrown.init?.status).toBe(400);
    expect(rerun.rerunAction).not.toHaveBeenCalled();
  });
});
