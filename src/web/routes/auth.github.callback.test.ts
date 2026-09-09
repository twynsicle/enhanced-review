// @vitest-environment node
import { RouterContextProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadedSession } from '@/web/auth/session.server';

const authenticator = { authenticate: vi.fn() };
vi.mock('@/web/auth/authenticator.server', () => ({
  authenticator,
  GITHUB_STRATEGY: 'github',
}));

const sessionModule = {
  createUserSession: vi.fn(async () => 'er_session=new'),
  destroySession: vi.fn(async () => 'er_session=; Max-Age=0'),
  readSessionId: vi.fn(async () => 'old-session'),
};
vi.mock('@/web/auth/session.server', () => sessionModule);
vi.mock('@/db/sessions', () => ({ deleteExpiredSessions: vi.fn(async () => {}) }));
vi.mock('@/web/auth/cookies.server', () => ({
  setGithubTokenHeader: vi.fn(async () => 'gh_access_token=t'),
}));

const { sessionContext } = await import('@/web/auth/context.server');
const { loader } = await import('./auth.github.callback');

const loaded: LoadedSession = {
  id: 'old-session',
  userId: 'u1',
  data: { userId: 'u1' },
  expiresAt: new Date(Date.now() + 1000),
};

function run() {
  const context = new RouterContextProvider();
  context.set(sessionContext, loaded);
  const request = new Request('http://localhost/auth/github/callback?code=abc');
  return {
    context,
    result: loader({ request, context, params: {} } as never) as Promise<Response>,
  };
}

describe('auth.github.callback loader', () => {
  beforeEach(() => {
    authenticator.authenticate.mockReset();
    sessionModule.destroySession.mockClear();
  });

  it('clears sessionContext after destroying the previous session', async () => {
    authenticator.authenticate.mockResolvedValue({ user: { id: 'u2' }, accessToken: 'tok' });

    const { context, result } = run();
    const response = await result;

    expect(response.status).toBe(302);
    expect(sessionModule.destroySession).toHaveBeenCalledWith('old-session');
    // The row is gone; leaving it in context would have the root middleware
    // roll a deleted session after the response was produced.
    expect(context.get(sessionContext)).toBeNull();
  });

  it('sends a failed exchange to /login without touching the session', async () => {
    authenticator.authenticate.mockRejectedValue(new Error('bad state'));

    const { context, result } = run();
    const response = await result;

    expect(response.headers.get('location')).toBe('/login?error=oauth');
    expect(sessionModule.destroySession).not.toHaveBeenCalled();
    expect(context.get(sessionContext)).toBe(loaded);
  });
});
