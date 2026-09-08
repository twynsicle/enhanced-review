// @vitest-environment node
import { RouterContextProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '@/domain/auth/sign-in.server';
import type { ReviewJob } from '@/domain/jobs/jobs.server';
import { userContext } from '@/web/auth/context.server';

const jobs = {
  listTerminalJobsSince: vi.fn<(userId: string, since: Date) => Promise<ReviewJob[]>>(),
  toJobView: vi.fn((job: ReviewJob) => ({ id: job.id, status: job.status })),
};
vi.mock('@/domain/jobs/jobs.server', () => jobs);

const { loader } = await import('./api.me.jobs.terminal');

const alice: SessionUser = { id: 'u1', githubLogin: 'alice', name: null, avatarUrl: null };

function call(search: string, user: SessionUser | null = alice) {
  const context = new RouterContextProvider();
  context.set(userContext, user);
  const request = new Request(`http://localhost/api/me/jobs/terminal${search}`);
  return loader({ request, params: {}, context } as never);
}

const status = (thrown: unknown) => (thrown as { init?: { status?: number } }).init?.status;

beforeEach(() => {
  vi.clearAllMocks();
  jobs.listTerminalJobsSince.mockResolvedValue([{ id: 'j1', status: 'done' } as ReviewJob]);
});

describe('/api/me/jobs/terminal loader', () => {
  it("lists the viewer's terminal jobs since the given instant and returns the server clock", async () => {
    const before = Date.now();
    const body = await call('?since=2026-09-07T10:00:00.000Z');
    expect(jobs.listTerminalJobsSince).toHaveBeenCalledWith(
      'u1',
      new Date('2026-09-07T10:00:00.000Z'),
    );
    expect(body.jobs).toEqual([{ id: 'j1', status: 'done' }]);
    expect(new Date(body.now).getTime()).toBeGreaterThanOrEqual(before);
  });

  it('rejects a missing or malformed since with 400', async () => {
    expect(status(await call('').catch((e: unknown) => e))).toBe(400);
    expect(status(await call('?since=yesterday').catch((e: unknown) => e))).toBe(400);
    expect(jobs.listTerminalJobsSince).not.toHaveBeenCalled();
  });

  it('answers 401 without a session user (belt to the gate)', async () => {
    expect(status(await call('?since=2026-09-07T10:00:00Z', null).catch((e: unknown) => e))).toBe(
      401,
    );
  });
});
