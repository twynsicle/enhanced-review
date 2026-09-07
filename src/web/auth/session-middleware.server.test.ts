// @vitest-environment node
import { RouterContextProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionRow } from '@/db/sessions';
import type { UserRow } from '@/db/users';

const sessions = {
  createSession: vi.fn(),
  readSession: vi.fn<(id: string) => Promise<SessionRow | null>>(),
  updateSession: vi.fn<(id: string, data: unknown, expiresAt: Date) => Promise<void>>(),
  deleteSession: vi.fn(),
  deleteExpiredSessions: vi.fn(),
};
const users = { findUserById: vi.fn<(id: string) => Promise<UserRow | null>>() };
vi.mock('@/db/sessions', () => sessions);
vi.mock('@/db/users', () => users);

const { sessionCookie } = await import('./cookies.server');
const { sessionContext, userContext } = await import('./context.server');
const { sessionMiddleware } = await import('./session-middleware.server');

const DAY = 24 * 60 * 60 * 1000;
const userRow: UserRow = {
  id: 'u1',
  githubId: 1n,
  githubLogin: 'octocat',
  name: null,
  avatarUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

async function run(cookieHeader: string | null, downstream?: (ctx: RouterContextProvider) => void) {
  const context = new RouterContextProvider();
  const request = new Request('http://localhost/', {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  });
  const params = {};
  const next = vi.fn(async () => {
    downstream?.(context);
    return new Response('ok');
  });
  const response = (await sessionMiddleware(
    { request, url: new URL(request.url), pattern: '/', context, params },
    next,
  )) as Response;
  return { response, context, next };
}

describe('sessionMiddleware', () => {
  beforeEach(() => {
    sessions.readSession.mockReset();
    sessions.updateSession.mockReset();
    users.findUserById.mockReset();
  });

  it('sets a null user when there is no session cookie', async () => {
    const { response, context, next } = await run(null);
    expect(next).toHaveBeenCalledOnce();
    expect(context.get(userContext)).toBeNull();
    expect(context.get(sessionContext)).toBeNull();
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(sessions.readSession).not.toHaveBeenCalled();
  });

  it('loads the user for a live session and does not roll a fresh one', async () => {
    sessions.readSession.mockResolvedValue({
      id: 's1',
      userId: 'u1',
      data: { userId: 'u1' },
      expiresAt: new Date(Date.now() + 6 * DAY),
    });
    users.findUserById.mockResolvedValue(userRow);

    const { response, context } = await run(await sessionCookie.serialize('s1'));

    expect(context.get(userContext)).toMatchObject({ id: 'u1', githubLogin: 'octocat' });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(sessions.updateSession).not.toHaveBeenCalled();
  });

  it('rolls a session past half-life and re-sets the cookie', async () => {
    sessions.readSession.mockResolvedValue({
      id: 's1',
      userId: 'u1',
      data: { userId: 'u1' },
      expiresAt: new Date(Date.now() + 2 * DAY),
    });
    users.findUserById.mockResolvedValue(userRow);
    sessions.updateSession.mockResolvedValue();

    const { response } = await run(await sessionCookie.serialize('s1'));

    expect(sessions.updateSession).toHaveBeenCalledOnce();
    const [id, , expiresAt] = sessions.updateSession.mock.calls[0]!;
    expect(id).toBe('s1');
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 6.9 * DAY);
    expect(response.headers.get('set-cookie')).toMatch(/^er_session=/);
  });

  it('does not roll a session that downstream destroyed', async () => {
    sessions.readSession.mockResolvedValue({
      id: 's1',
      userId: 'u1',
      data: { userId: 'u1' },
      expiresAt: new Date(Date.now() + DAY),
    });
    users.findUserById.mockResolvedValue(userRow);

    const { response } = await run(await sessionCookie.serialize('s1'), (ctx) =>
      ctx.set(sessionContext, null),
    );

    expect(sessions.updateSession).not.toHaveBeenCalled();
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('ignores a cookie with a bad signature', async () => {
    const { context } = await run('er_session=forged-value');
    expect(sessions.readSession).not.toHaveBeenCalled();
    expect(context.get(userContext)).toBeNull();
  });
});
