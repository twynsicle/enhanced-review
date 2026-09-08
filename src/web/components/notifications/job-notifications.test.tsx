import { createRoutesStub } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobView } from '@/domain/jobs/job-view';
import { render, screen, waitFor } from '@/web/test/render';
import { describeTransition, JobNotifications } from './job-notifications';

const show = vi.fn();
vi.mock('@mantine/notifications', () => ({
  notifications: { show: (...args: unknown[]) => show(...args), hide: vi.fn() },
}));

const job = (overrides: Partial<JobView> = {}): JobView => ({
  id: 'j1',
  userId: 'u1',
  githubLogin: 'alice',
  target: {
    kind: 'pr',
    owner: 'acme',
    repo: 'widgets',
    number: 7,
    title: 'Add widgets',
    baseSha: 'b',
    headSha: 'h',
  },
  status: 'done',
  headSha: 'h',
  startedAt: null,
  completedAt: '2026-09-07T10:00:05.000Z',
  cancelledAt: null,
  errorMessage: null,
  riskScore: 2,
  createdAt: '2026-09-07T10:00:00.000Z',
  updatedAt: '2026-09-07T10:00:05.000Z',
  ...overrides,
});

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

const fetchMock = vi.fn<(input: string | URL | Request) => Promise<Response>>();

function renderAt(pathname: string) {
  const Stub = createRoutesStub([
    {
      path: '/*',
      Component: () => (
        <>
          <JobNotifications serverNow="2026-09-07T10:00:00.000Z" terminalMs={60_000} />
          <p>page</p>
        </>
      ),
    },
  ]);
  return render(<Stub initialEntries={[pathname]} />);
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  show.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('<JobNotifications />', () => {
  it('polls from serverNow and toasts a job that turned terminal', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ now: '2026-09-07T10:01:00.000Z', jobs: [job()] }));
    renderAt('/history');
    await waitFor(() => expect(show).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/me/jobs/terminal?since=2026-09-07T10%3A00%3A00.000Z',
    );
    expect(show.mock.calls[0]?.[0]).toMatchObject({
      id: 'job-j1',
      title: 'Review ready',
      color: 'mint',
    });
  });

  it('polls later from the server clock minus the overlap and never toasts the same id twice', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ now: '2026-09-07T10:01:00.000Z', jobs: [job()] }));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderAt('/history');
      await waitFor(() => expect(show).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(60_000);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      expect(fetchMock.mock.calls[1]?.[0]).toBe(
        '/api/me/jobs/terminal?since=2026-09-07T10%3A00%3A30.000Z',
      );
      await screen.findByText('page');
      expect(show).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is suppressed while the viewer is on that job’s own page', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ now: '2026-09-07T10:01:00.000Z', jobs: [job()] }));
    renderAt('/jobs/j1');
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await screen.findByText('page');
    expect(show).not.toHaveBeenCalled();
  });

  it('ignores a non-JSON body (an expired session redirected to the login page)', async () => {
    fetchMock.mockResolvedValue(new Response('<html></html>', { status: 200 }));
    renderAt('/history');
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await screen.findByText('page');
    expect(show).not.toHaveBeenCalled();
  });
});

describe('describeTransition', () => {
  it('maps the three terminal statuses to the legacy copy and destinations', () => {
    expect(describeTransition(job())).toEqual({
      title: 'Review ready',
      description: 'acme/widgets PR #7',
      tone: 'success',
      href: '/reviews/j1',
    });
    expect(describeTransition(job({ status: 'error', errorMessage: 'boom' }))).toMatchObject({
      title: 'Review errored',
      description: 'boom',
      tone: 'destructive',
      href: '/jobs/j1',
    });
    expect(
      describeTransition(
        job({
          status: 'cancelled',
          target: {
            kind: 'branch',
            owner: 'acme',
            repo: 'widgets',
            ref: 'feat',
            baseRef: 'main',
            baseSha: 'b',
            headSha: 'h',
          },
        }),
      ),
    ).toMatchObject({
      title: 'Review cancelled',
      description: 'acme/widgets feat',
      tone: 'default',
    });
  });
});
