import { createRoutesStub } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PullSummary, RepoSummary } from '@/domain/github/types';
import type { PullsResponse, ReposResponse } from '@/web/lib/github-api';
import { render, screen, userEvent, waitFor } from '@/web/test/render';
import { useLastTarget, writeLastRepo } from '@/web/stores/last-target';
import { ReviewComposer } from './review-composer';

vi.mock('@mantine/notifications', () => ({
  notifications: { show: vi.fn(), hide: vi.fn() },
}));

const USER = 'user-1';

const repo: RepoSummary = {
  owner: 'acme',
  name: 'widgets',
  fullName: 'acme/widgets',
  description: 'Widgets',
  private: false,
  fork: false,
  archived: false,
  defaultBranch: 'main',
  pushedAt: '2026-09-01T00:00:00.000Z',
  htmlUrl: 'https://github.com/acme/widgets',
};

const pull: PullSummary = {
  number: 7,
  title: 'Add widgets',
  state: 'open',
  draft: false,
  authorLogin: 'alice',
  authorAvatarUrl: null,
  headRef: 'feature/x',
  headSha: 'h',
  baseRef: 'main',
  baseSha: 'b',
  htmlUrl: 'https://github.com/acme/widgets/pull/7',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
};

const RATE_LIMIT_MESSAGE = 'GitHub API rate limit reached. Try again in a minute.';
const rateLimited: PullsResponse = {
  ok: false,
  fullName: repo.fullName,
  error: { kind: 'rate-limited', status: 403 },
  message: RATE_LIMIT_MESSAGE,
};

const loaded: PullsResponse = { ok: true, fullName: repo.fullName, pulls: [pull] };

/** Bodies the two loaders answer with; a test may swap them mid-flight. */
let reposBody: ReposResponse;
let pullsBody: PullsResponse;
const reposLoader = vi.fn(() => reposBody);
const pullsLoader = vi.fn(() => pullsBody);

function renderComposer() {
  const Stub = createRoutesStub([
    { path: '/', Component: () => <ReviewComposer userId={USER} /> },
    { path: '/api/github/repos', loader: () => reposLoader() },
    { path: '/api/github/repos/:owner/:name/pulls', loader: () => pullsLoader() },
  ]);
  return render(<Stub initialEntries={['/']} />);
}

/** Lets any effect-scheduled follow-up load run before the count is read. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

beforeEach(async () => {
  window.localStorage.clear();
  useLastTarget.setState({ byUser: {} });
  await useLastTarget.persist.rehydrate();
  reposBody = { ok: true, repos: [repo] };
  pullsBody = loaded;
  reposLoader.mockClear();
  pullsLoader.mockClear();
  // The composer restores its selection from the store, so seeding it picks
  // the repo without driving the combobox.
  writeLastRepo(USER, repo.fullName);
});

describe('<ReviewComposer />', () => {
  it('loads the repos and then the PRs for the restored repo, once each', async () => {
    renderComposer();
    await waitFor(() => expect(screen.getByText('Choose a pull request')).toBeInTheDocument());
    await settle();
    expect(reposLoader).toHaveBeenCalledTimes(1);
    expect(pullsLoader).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows an inline error, not a loading dropdown, when the PR load fails', async () => {
    pullsBody = rateLimited;
    renderComposer();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(RATE_LIMIT_MESSAGE);
    // The picker is gone entirely, so nothing is left pretending to load.
    expect(screen.queryByText('Choose a pull request')).toBeNull();
  });

  it('does not re-issue a failed load on its own', async () => {
    pullsBody = rateLimited;
    renderComposer();
    await screen.findByRole('alert');
    await settle();
    expect(pullsLoader).toHaveBeenCalledTimes(1);
  });

  it('re-issues the load on Retry and recovers', async () => {
    const user = userEvent.setup();
    pullsBody = rateLimited;
    renderComposer();
    await screen.findByRole('alert');

    pullsBody = loaded;
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.getByText('Choose a pull request')).toBeInTheDocument());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(pullsLoader).toHaveBeenCalledTimes(2);
  });

  it('keeps showing the error, once, when the retry fails again', async () => {
    const user = userEvent.setup();
    pullsBody = rateLimited;
    renderComposer();
    await screen.findByRole('alert');

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(pullsLoader).toHaveBeenCalledTimes(2));
    await settle();
    expect(pullsLoader).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
