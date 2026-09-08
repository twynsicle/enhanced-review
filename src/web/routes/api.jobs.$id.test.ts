// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewJob } from '@/domain/jobs/jobs.server';

const jobs = {
  getJob: vi.fn<(id: string) => Promise<ReviewJob | null>>(),
  listChunksAfter:
    vi.fn<(id: string, after?: number) => Promise<{ seq: number; content: string }[]>>(),
  toJobView: vi.fn((job: ReviewJob) => ({ id: job.id, status: job.status })),
};
vi.mock('@/domain/jobs/jobs.server', () => jobs);

const { loader } = await import('./api.jobs.$id');

const call = (url: string, params: Record<string, string>) =>
  loader({ request: new Request(url), params, context: {} } as never);

beforeEach(() => {
  vi.clearAllMocks();
  jobs.getJob.mockResolvedValue({ id: 'j1', status: 'running' } as ReviewJob);
  jobs.listChunksAfter.mockResolvedValue([{ seq: 3, content: 'x' }]);
});

describe('/api/jobs/:id loader', () => {
  it('returns the job view and the chunks after the given seq', async () => {
    const body = await call('http://localhost/api/jobs/j1?after=2', { id: 'j1' });
    expect(jobs.listChunksAfter).toHaveBeenCalledWith('j1', 2);
    expect(body).toEqual({
      job: { id: 'j1', status: 'running' },
      chunks: [{ seq: 3, content: 'x' }],
    });
  });

  it('defaults after to -1 (every chunk)', async () => {
    await call('http://localhost/api/jobs/j1', { id: 'j1' });
    expect(jobs.listChunksAfter).toHaveBeenCalledWith('j1', -1);
  });

  it('rejects after below -1 with 400', async () => {
    const thrown = await Promise.resolve()
      .then(() => call('http://localhost/api/jobs/j1?after=-2', { id: 'j1' }))
      .catch((e: unknown) => e);
    expect((thrown as { init?: { status?: number } }).init?.status).toBe(400);
  });

  it('throws 404 for an unknown job', async () => {
    jobs.getJob.mockResolvedValue(null);
    const thrown = await call('http://localhost/api/jobs/nope', { id: 'nope' }).catch(
      (e: unknown) => e,
    );
    expect((thrown as { init?: { status?: number } }).init?.status).toBe(404);
  });
});
