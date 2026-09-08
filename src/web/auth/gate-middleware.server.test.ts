// @vitest-environment node
import { RouterContextProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessions = {
  createSession: vi.fn(),
  readSession: vi.fn(),
  updateSession: vi.fn(),
  deleteSession: vi.fn<(id: string) => Promise<void>>(),
  deleteExpiredSessions: vi.fn(),
};
vi.mock('@/db/sessions', () => sessions);

const { sessionContext, userContext } = await import('./context.server');
const { requireUser } = await import('./gate-middleware.server');

const user = { id: 'u1', githubLogin: 'octocat', name: null, avatarUrl: null };
const session = { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 1000), data: {} };

async function run(setup: (ctx: RouterContextProvider) => void) {
  const context = new RouterContextProvider();
  setup(context);
  const request = new Request('http://localhost/');
  const next = vi.fn(async () => new Response('page'));
  const response = (await requireUser(
    { request, url: new URL(request.url), pattern: '/', context, params: {} },
    next,
  )) as Response;
  return { response, context, next };
}

describe('requireUser', () => {
  beforeEach(() => {
    sessions.deleteSession.mockReset().mockResolvedValue();
  });

  it('redirects anonymous requests to /login and clears both cookies', async () => {
    const { response, next } = await run((ctx) => {
      ctx.set(userContext, null);
      ctx.set(sessionContext, null);
    });

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/login');
    const cookies = response.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith('er_session=;'))).toBe(true);
    expect(cookies.some((c) => c.startsWith('gh_access_token=;'))).toBe(true);
    expect(sessions.deleteSession).not.toHaveBeenCalled();
  });

  it('destroys a session whose user is gone before redirecting', async () => {
    const { response, context } = await run((ctx) => {
      ctx.set(userContext, null);
      ctx.set(sessionContext, session);
    });

    expect(response.headers.get('location')).toBe('/login');
    expect(sessions.deleteSession).toHaveBeenCalledWith('s1');
    expect(context.get(sessionContext)).toBeNull();
    expect(context.get(userContext)).toBeNull();
  });

  it('lets any signed-in user through untouched', async () => {
    const { response, next } = await run((ctx) => {
      ctx.set(userContext, user);
      ctx.set(sessionContext, session);
    });

    expect(next).toHaveBeenCalledOnce();
    expect(await response.text()).toBe('page');
    expect(sessions.deleteSession).not.toHaveBeenCalled();
  });
});
