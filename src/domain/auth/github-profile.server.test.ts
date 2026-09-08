import { describe, expect, it, vi } from 'vitest';
import { fetchGithubProfile, GithubProfileError } from './github-profile.server.ts';

function fakeFetch(status: number, body: unknown) {
  return vi.fn(async () => Response.json(body, { status }));
}

describe('fetchGithubProfile', () => {
  it('maps the viewer payload and sends the bearer token', async () => {
    const fetchImpl = fakeFetch(200, {
      id: 12345,
      login: 'octocat',
      name: 'The Octocat',
      avatar_url: 'https://avatars.githubusercontent.com/u/12345',
    });

    const profile = await fetchGithubProfile('gho_token', fetchImpl);

    expect(profile).toEqual({
      githubId: 12345n,
      githubLogin: 'octocat',
      name: 'The Octocat',
      avatarUrl: 'https://avatars.githubusercontent.com/u/12345',
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.com/user');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer gho_token');
  });

  it('treats missing name and avatar as null', async () => {
    const profile = await fetchGithubProfile(
      't',
      fakeFetch(200, { id: 1, login: 'x', name: null }),
    );
    expect(profile.name).toBeNull();
    expect(profile.avatarUrl).toBeNull();
  });

  it('throws with the status when GitHub rejects the token', async () => {
    const err: unknown = await fetchGithubProfile('t', fakeFetch(401, {})).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GithubProfileError);
    expect((err as GithubProfileError).status).toBe(401);
  });

  it('throws when the payload has the wrong shape', async () => {
    await expect(fetchGithubProfile('t', fakeFetch(200, { login: 'no-id' }))).rejects.toThrowError(
      /unexpected payload/,
    );
  });
});
