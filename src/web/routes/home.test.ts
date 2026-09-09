// @vitest-environment node
import { RouterContextProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GithubAuthError } from '@/domain/github/client.server';
import { HeadShaResolutionError, JobInFlightError } from '@/domain/jobs/errors';
import type { ReviewJob } from '@/domain/jobs/jobs.server';
import { userContext } from '@/web/auth/context.server';

const jobs = {
  listJobs: vi.fn<(options: { limit: number }) => Promise<ReviewJob[]>>(),
  listRecentActivity: vi.fn<() => Promise<Date[]>>(),
  toJobView: vi.fn((job: ReviewJob) => ({ id: job.id })),
};
const start = { startReview: vi.fn<() => Promise<{ id: string }>>() };
const github = {
  requireGithubToken: vi.fn<() => Promise<string>>(),
  relinkRedirect: vi.fn(
    () => new Response(null, { status: 302, headers: { location: '/relink' } }),
  ),
};
vi.mock('@/domain/jobs/jobs.server', () => jobs);
vi.mock('@/domain/jobs/start-review.server', () => start);
vi.mock('@/web/lib/github.server', () => github);

const { loader, action } = await import('./home');

const USER = { id: 'u1', githubLogin: 'alice', name: null, avatarUrl: null };
const TARGET = {
  kind: 'pr',
  owner: 'acme',
  repo: 'w',
  number: 3,
  headSha: 'h',
  baseSha: 'b',
  title: 't',
};

function contextFor(user: typeof USER | null) {
  const context = new RouterContextProvider();
  context.set(userContext, user);
  return context;
}

function post(body: Record<string, string>, user: typeof USER | null = USER) {
  const form = new FormData();
  for (const [key, value] of Object.entries(body)) form.set(key, value);
  const request = new Request('http://localhost/', { method: 'POST', body: form });
  return action({ request, params: {}, context: contextFor(user) } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  jobs.listJobs.mockResolvedValue([{ id: 'a' } as ReviewJob, { id: 'b' } as ReviewJob]);
  jobs.listRecentActivity.mockResolvedValue([new Date(), new Date(Date.now() - 86_400_000)]);
  github.requireGithubToken.mockResolvedValue('gh-token');
  start.startReview.mockResolvedValue({ id: 'job-9' });
});

describe('/ loader', () => {
  it('returns the viewer id, the five newest jobs and 14 activity buckets', async () => {
    const result = await loader({
      request: new Request('http://localhost/'),
      params: {},
      context: contextFor(USER),
    } as never);
    expect(result.userId).toBe('u1');
    expect(jobs.listJobs).toHaveBeenCalledWith({ limit: 5 });
    expect(result.recent).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(result.activity).toHaveLength(14);
    expect(result.activity[13]).toBe(1);
    expect(result.activity[12]).toBe(1);
  });
});

describe('/ action', () => {
  it('starts the review and redirects to the live view', async () => {
    const res = (await post({ target: JSON.stringify(TARGET) })) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/jobs/job-9');
    expect(start.startReview).toHaveBeenCalledWith({
      userId: 'u1',
      token: 'gh-token',
      target: TARGET,
    });
  });

  it('answers 409 job_in_flight with the active job id', async () => {
    start.startReview.mockRejectedValue(new JobInFlightError('busy-1'));
    const res = (await post({ target: JSON.stringify(TARGET) })) as {
      data: unknown;
      init?: { status?: number };
    };
    expect(res.init?.status).toBe(409);
    expect(res.data).toMatchObject({ ok: false, reason: 'job_in_flight', activeJobId: 'busy-1' });
  });

  it('answers 502 when the head SHA cannot be resolved', async () => {
    start.startReview.mockRejectedValue(new HeadShaResolutionError(new Error('net')));
    const res = (await post({ target: JSON.stringify(TARGET) })) as { init?: { status?: number } };
    expect(res.init?.status).toBe(502);
  });

  it('redirects to /relink when GitHub rejects the token', async () => {
    start.startReview.mockRejectedValue(new GithubAuthError());
    const thrown = (await post({ target: JSON.stringify(TARGET) }).catch(
      (e: unknown) => e,
    )) as Response;
    expect(thrown.status).toBe(302);
    expect(thrown.headers.get('location')).toBe('/relink');
  });

  it('rejects a malformed target with 400 before touching GitHub', async () => {
    const thrown = (await post({ target: '{not json' }).catch((e: unknown) => e)) as {
      init?: { status?: number };
    };
    expect(thrown.init?.status).toBe(400);
    expect(github.requireGithubToken).not.toHaveBeenCalled();
  });
});
