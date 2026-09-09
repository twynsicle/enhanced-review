// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { GithubAuthError } from '@/domain/github/client.server';
import type * as GithubClientModule from '@/domain/github/client.server';
import { githubTokenCookie } from '@/web/auth/cookies.server';
import { githubFailure, requireGithubToken, withGithub } from './github.server';

vi.mock('@/domain/github/client.server', async (importOriginal) => {
  const actual = await importOriginal<typeof GithubClientModule>();
  return { ...actual, createOctokit: vi.fn(() => ({ request: vi.fn(), graphql: vi.fn() })) };
});

async function signedRequest(token: string | null): Promise<Request> {
  const headers = new Headers();
  if (token) headers.set('cookie', await githubTokenCookie.serialize(token));
  return new Request('http://localhost/api/github/repos', { headers });
}

async function caught(promise: Promise<unknown>): Promise<Response> {
  const thrown = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(thrown).toBeInstanceOf(Response);
  return thrown as Response;
}

describe('requireGithubToken', () => {
  it('returns the signed cookie value', async () => {
    await expect(requireGithubToken(await signedRequest('gh-token'))).resolves.toBe('gh-token');
  });

  it('redirects to /relink when the cookie is missing', async () => {
    const res = await caught(requireGithubToken(await signedRequest(null)));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/relink');
  });
});

describe('withGithub', () => {
  it('runs the callback with a client and the token', async () => {
    const result = await withGithub(await signedRequest('gh-token'), async (client, token) => ({
      hasClient: typeof client.request === 'function',
      token,
    }));
    expect(result).toEqual({ hasClient: true, token: 'gh-token' });
  });

  it('turns GithubAuthError into a relink redirect that clears the token cookie', async () => {
    const res = await caught(
      withGithub(await signedRequest('stale'), async () => {
        throw new GithubAuthError();
      }),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/relink');
    expect(res.headers.get('set-cookie')).toMatch(/gh_access_token=;/);
  });

  it('lets other errors through untouched', async () => {
    const boom = new Error('boom');
    await expect(
      withGithub(await signedRequest('t'), async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });
});

describe('githubFailure', () => {
  it('folds a classified error into a returned body with a status', () => {
    const res = githubFailure(Object.assign(new Error('nope'), { status: 404 }));
    expect(res.init?.status).toBe(404);
    expect(res.data).toMatchObject({ ok: false, error: { kind: 'not-found' } });
  });

  it('re-throws auth errors for withGithub to redirect', () => {
    expect(() => githubFailure(new GithubAuthError())).toThrow(GithubAuthError);
  });
});
