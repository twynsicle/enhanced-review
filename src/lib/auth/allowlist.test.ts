import { describe, expect, it, vi } from 'vitest';
import type PocketBase from 'pocketbase';
import type { UserRecord } from '@/lib/pb';
import { getGithubLogin, isAllowed } from './allowlist';

/**
 * Build a stub PocketBase client whose `collection(name).getFirstListItem(filter)`
 * resolves with `result` or rejects with `rejectWith` (used to simulate
 * 404 / 500). Only the methods we use are stubbed.
 */
function stubClient(opts: { result?: unknown; rejectWith?: unknown }): PocketBase {
  const getFirstListItem = vi.fn(() =>
    'rejectWith' in opts ? Promise.reject(opts.rejectWith) : Promise.resolve(opts.result),
  );
  const collection = vi.fn().mockReturnValue({ getFirstListItem });
  return { collection } as unknown as PocketBase;
}

describe('getGithubLogin', () => {
  it('returns the github_login field from the user record', () => {
    const user = { github_login: 'twynsicle' } as unknown as UserRecord;
    expect(getGithubLogin(user)).toBe('twynsicle');
  });

  it('returns null when github_login is missing', () => {
    const user = { name: 'Steven' } as unknown as UserRecord;
    expect(getGithubLogin(user)).toBeNull();
  });

  it('returns null when github_login is empty', () => {
    const user = { github_login: '' } as unknown as UserRecord;
    expect(getGithubLogin(user)).toBeNull();
  });

  it('returns null when the user is null', () => {
    expect(getGithubLogin(null)).toBeNull();
  });
});

describe('isAllowed', () => {
  it('returns true when the row exists', async () => {
    const client = stubClient({ result: { github_login: 'twynsicle' } });
    expect(await isAllowed(client, 'twynsicle')).toBe(true);
  });

  it('returns false on a 404 (row missing)', async () => {
    const client = stubClient({ rejectWith: { status: 404, message: 'not found' } });
    expect(await isAllowed(client, 'someone-else')).toBe(false);
  });

  it('fails closed (false) on unexpected errors', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = stubClient({ rejectWith: new Error('boom') });
    expect(await isAllowed(client, 'twynsicle')).toBe(false);
    errSpy.mockRestore();
  });

  it('queries the allowed_users collection', async () => {
    const client = stubClient({ rejectWith: { status: 404 } });
    await isAllowed(client, 'twynsicle');
    expect(client.collection).toHaveBeenCalledWith('allowed_users');
  });
});
