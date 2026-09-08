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
const allowlist = { isAllowed: vi.fn<(login: string) => Promise<boolean>>() };
vi.mock('@/db/sessions', () => sessions);
vi.mock('@/domain/auth/allowlist.server', () => allowlist);

const { sessionContext, userContext } = await import('./context.server');
const { allowlistGate } = await import('./gate-middleware.server');

const user = { id: 'u1', githubLogin: 'octocat', name: null, avatarUrl: null };
const session = { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 1000), data: {} };

async function run(setup: (ctx: RouterContextProvider) => void) {
  const context = new RouterContextProvider();
  setup(context);
  const request = new Request('http://localhost/');
  const next = vi.fn(async () => new Response('page'));
  const response = (await allowlistGate(
    { request, url: new URL(request.url), pattern: '/', context, params: {} },
    next,
  )) as Response;
  return { response, context, next };
}

describe('allowlistGate', () => {
  beforeEach(() => {
    sessions.deleteSession.mockReset().mockResolvedValue();
    allowlist.isAllowed.mockReset();
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

  it('signs out and redirects a user who is not on the allowlist', async () => {
    allowlist.isAllowed.mockResolvedValue(false);
    const { response, context, next } = await run((ctx) => {
      ctx.set(userContext, user);
      ctx.set(sessionContext, session);
    });

    expect(next).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBe('/denied');
    expect(sessions.deleteSession).toHaveBeenCalledWith('s1');
    expect(context.get(sessionContext)).toBeNull();
    expect(context.get(userContext)).toBeNull();
  });

  it('lets an allowed user through untouched', async () => {
    allowlist.isAllowed.mockResolvedValue(true);
    const { response, next } = await run((ctx) => {
      ctx.set(userContext, user);
      ctx.set(sessionContext, session);
    });

    expect(next).toHaveBeenCalledOnce();
    expect(await response.text()).toBe('page');
    expect(allowlist.isAllowed).toHaveBeenCalledWith('octocat');
  });
});
