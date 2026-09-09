import { beforeEach, expect, it } from 'vitest';
import { describeDb, resetDb } from '../test/db.ts';
import { findUserById, upsertUserFromGithub } from './users.ts';

describeDb('users repository', () => {
  beforeEach(resetDb);

  it('creates on first sign-in and refreshes profile fields on the next', async () => {
    const first = await upsertUserFromGithub({
      githubId: 42n,
      githubLogin: 'octocat',
      name: 'Octo',
      avatarUrl: null,
    });
    expect(first.githubLogin).toBe('octocat');

    const second = await upsertUserFromGithub({
      githubId: 42n,
      githubLogin: 'octocat-renamed',
      name: null,
      avatarUrl: 'https://example.com/a.png',
    });

    expect(second.id).toBe(first.id);
    expect(second.githubLogin).toBe('octocat-renamed');
    expect(second.name).toBeNull();
    expect(second.avatarUrl).toBe('https://example.com/a.png');
    expect(second.updatedAt.getTime()).toBeGreaterThanOrEqual(first.updatedAt.getTime());
  });

  it('lets a reused GitHub login move to another account', async () => {
    // GitHub frees a login on rename or account deletion. The stale row keeps
    // the old cached login until its owner signs in again, so the new owner
    // must still be able to sign in meanwhile — `github_login` is not unique.
    const stale = await upsertUserFromGithub({
      githubId: 1n,
      githubLogin: 'shared',
      name: null,
      avatarUrl: null,
    });
    const fresh = await upsertUserFromGithub({
      githubId: 2n,
      githubLogin: 'shared',
      name: null,
      avatarUrl: null,
    });
    expect(fresh.id).not.toBe(stale.id);
    await expect(findUserById(stale.id)).resolves.toMatchObject({ githubLogin: 'shared' });
  });

  it('finds by id and returns null for unknown ids', async () => {
    const row = await upsertUserFromGithub({
      githubId: 7n,
      githubLogin: 'seven',
      name: null,
      avatarUrl: null,
    });
    await expect(findUserById(row.id)).resolves.toMatchObject({ githubLogin: 'seven' });
    await expect(findUserById('00000000-0000-7000-8000-000000000000')).resolves.toBeNull();
  });
});
