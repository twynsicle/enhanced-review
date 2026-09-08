// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewJob } from '@/domain/jobs/jobs.server';

const jobs = {
  listJobs: vi.fn<(options: { status?: string; limit: number }) => Promise<ReviewJob[]>>(),
  toJobView: vi.fn((job: ReviewJob) => ({ id: job.id, status: job.status })),
};
vi.mock('@/domain/jobs/jobs.server', () => jobs);

const { loader } = await import('./history');

const job = { id: 'j1', status: 'done' } as ReviewJob;

beforeEach(() => {
  vi.clearAllMocks();
  jobs.listJobs.mockResolvedValue([job]);
});

const load = (url: string) =>
  loader({ request: new Request(url), params: {}, context: {} } as never);

describe('/history loader', () => {
  it('lists everything, newest first, when there is no filter', async () => {
    const result = await load('http://localhost/history');
    expect(jobs.listJobs).toHaveBeenCalledWith({ status: undefined, limit: 100 });
    expect(result).toEqual({ status: 'all', jobs: [{ id: 'j1', status: 'done' }] });
  });

  it('filters on a known status', async () => {
    const result = await load('http://localhost/history?status=error');
    expect(jobs.listJobs).toHaveBeenCalledWith({ status: 'error', limit: 100 });
    expect(result.status).toBe('error');
  });

  it('treats an unknown status as "all" instead of failing', async () => {
    const result = await load('http://localhost/history?status=bogus');
    expect(jobs.listJobs).toHaveBeenCalledWith({ status: undefined, limit: 100 });
    expect(result.status).toBe('all');
  });
});
