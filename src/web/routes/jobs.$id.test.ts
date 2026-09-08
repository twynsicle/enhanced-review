// @vitest-environment node
import { RouterContextProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GithubAuthError } from '@/domain/github/client.server';
import { HeadShaResolutionError, JobInFlightError, JobNotFoundError } from '@/domain/jobs/errors';
import type { ReviewJob } from '@/domain/jobs/jobs.server';
import { userContext } from '@/web/auth/context.server';

const jobs = {
  getJob: vi.fn<(id: string) => Promise<ReviewJob | null>>(),
  listChunksAfter: vi.fn<(id: string) => Promise<{ seq: number; content: string }[]>>(),
  toJobView: vi.fn((job: ReviewJob) => ({ id: job.id, status: job.status })),
};
const cancel = { cancelJob: vi.fn<() => Promise<'cancelled' | 'not-cancellable'>>() };
const start = { rerunJob: vi.fn<() => Promise<{ id: string }>>() };
const github = {
  requireGithubToken: vi.fn<() => Promise<string>>(),
  relinkRedirect: vi.fn(
    () => new Response(null, { status: 302, headers: { location: '/relink' } }),
  ),
};
vi.mock('@/domain/jobs/jobs.server', () => jobs);
vi.mock('@/domain/jobs/cancel-job.server', () => cancel);
vi.mock('@/domain/jobs/start-review.server', () => start);
vi.mock('@/web/lib/github.server', () => github);

const { loader, action } = await import('./jobs.$id');

const USER = { id: 'u1', githubLogin: 'alice', name: null, avatarUrl: null };

function contextFor(user: typeof USER | null) {
  const context = new RouterContextProvider();
  context.set(userContext, user);
  return context;
}

function post(intent: string, user: typeof USER | null = USER) {
  const form = new FormData();
  form.set('intent', intent);
  const request = new Request('http://localhost/jobs/j1', { method: 'POST', body: form });
  return action({ request, params: { id: 'j1' }, context: contextFor(user) } as never);
}

type Thrown = { init?: { status?: number }; data?: unknown };
const caught = (promise: Promise<unknown>) => promise.catch((e: unknown) => e);

beforeEach(() => {
  vi.clearAllMocks();
  jobs.getJob.mockResolvedValue({ id: 'j1', status: 'running' } as ReviewJob);
  jobs.listChunksAfter.mockResolvedValue([{ seq: 0, content: 'a' }]);
  cancel.cancelJob.mockResolvedValue('cancelled');
  start.rerunJob.mockResolvedValue({ id: 'j2' });
  github.requireGithubToken.mockResolvedValue('gh-token');
});

describe('/jobs/:id loader', () => {
  it('returns the job, its chunks and the viewer id', async () => {
    const result = await loader({
      request: new Request('http://localhost/jobs/j1'),
      params: { id: 'j1' },
      context: contextFor(USER),
    } as never);
    expect(result).toEqual({
      job: { id: 'j1', status: 'running' },
      chunks: [{ seq: 0, content: 'a' }],
      viewerUserId: 'u1',
    });
    expect(jobs.listChunksAfter).toHaveBeenCalledWith('j1');
  });

  it('throws 404 for an unknown id', async () => {
    jobs.getJob.mockResolvedValue(null);
    const thrown = (await caught(
      loader({
        request: new Request('http://localhost/jobs/nope'),
        params: { id: 'nope' },
        context: contextFor(USER),
      } as never),
    )) as Thrown;
    expect(thrown.init?.status).toBe(404);
  });
});

describe('/jobs/:id action', () => {
  it('cancel: owner cancels and gets ok', async () => {
    await expect(post('cancel')).resolves.toEqual({ ok: true });
    expect(cancel.cancelJob).toHaveBeenCalledWith({ jobId: 'j1', userId: 'u1' });
  });

  it('cancel: not-cancellable answers 409', async () => {
    cancel.cancelJob.mockResolvedValue('not-cancellable');
    const res = (await post('cancel')) as Thrown;
    expect(res.init?.status).toBe(409);
    expect(res.data).toMatchObject({ ok: false, reason: 'not_cancellable' });
  });

  it('rerun: redirects to the new job', async () => {
    const res = (await post('rerun')) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/jobs/j2');
    expect(start.rerunJob).toHaveBeenCalledWith({
      userId: 'u1',
      token: 'gh-token',
      sourceJobId: 'j1',
    });
  });

  it('rerun: maps the domain errors to ActionErrors', async () => {
    start.rerunJob.mockRejectedValueOnce(new JobNotFoundError('j1'));
    expect(((await post('rerun')) as Thrown).init?.status).toBe(404);
    start.rerunJob.mockRejectedValueOnce(new JobInFlightError('busy'));
    const inFlight = (await post('rerun')) as Thrown;
    expect(inFlight.init?.status).toBe(409);
    expect(inFlight.data).toMatchObject({ reason: 'job_in_flight', activeJobId: 'busy' });
    start.rerunJob.mockRejectedValueOnce(new HeadShaResolutionError(new Error('net')));
    expect(((await post('rerun')) as Thrown).init?.status).toBe(502);
  });

  it('rerun: a rejected GitHub token goes to /relink', async () => {
    start.rerunJob.mockRejectedValue(new GithubAuthError());
    const thrown = (await caught(post('rerun'))) as Response;
    expect(thrown.status).toBe(302);
    expect(thrown.headers.get('location')).toBe('/relink');
  });

  it('rejects an unknown intent with 400', async () => {
    const thrown = (await caught(post('explode'))) as Thrown;
    expect(thrown.init?.status).toBe(400);
  });
});
