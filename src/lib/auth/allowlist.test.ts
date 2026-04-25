import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { getGithubLogin, isAllowed } from './allowlist';

/**
 * Build a stub SupabaseClient whose `from(...).select(...).eq(...).maybeSingle()`
 * chain resolves to the supplied result. Only the methods we use are stubbed;
 * everything else is `undefined`.
 */
function stubClient(result: { data: unknown; error: unknown }): SupabaseClient {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { from } as unknown as SupabaseClient;
}

describe('getGithubLogin', () => {
  it('returns the user_name from user_metadata', () => {
    const user = { user_metadata: { user_name: 'twynsicle' } } as unknown as User;
    expect(getGithubLogin(user)).toBe('twynsicle');
  });

  it('returns null when user_name is missing', () => {
    const user = { user_metadata: { name: 'Steven' } } as unknown as User;
    expect(getGithubLogin(user)).toBeNull();
  });

  it('returns null when user_name is empty', () => {
    const user = { user_metadata: { user_name: '' } } as unknown as User;
    expect(getGithubLogin(user)).toBeNull();
  });

  it('returns null when user_metadata is null', () => {
    const user = { user_metadata: null } as unknown as User;
    expect(getGithubLogin(user)).toBeNull();
  });
});

describe('isAllowed', () => {
  it('returns true when the row exists', async () => {
    const client = stubClient({ data: { github_login: 'twynsicle' }, error: null });
    expect(await isAllowed(client, 'twynsicle')).toBe(true);
  });

  it('returns false when the row is missing (data === null)', async () => {
    const client = stubClient({ data: null, error: null });
    expect(await isAllowed(client, 'someone-else')).toBe(false);
  });

  it('fails closed (false) when the query errors', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = stubClient({ data: null, error: { message: 'boom' } });
    expect(await isAllowed(client, 'twynsicle')).toBe(false);
    errSpy.mockRestore();
  });

  it('queries the allowed_users table', async () => {
    const client = stubClient({ data: null, error: null });
    await isAllowed(client, 'twynsicle');
    expect(client.from).toHaveBeenCalledWith('allowed_users');
  });
});
