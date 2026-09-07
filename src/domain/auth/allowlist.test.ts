import { beforeEach, describe, expect, it, vi } from 'vitest';

const isLoginAllowed = vi.fn<(login: string) => Promise<boolean>>();
vi.mock('../../db/allowed-users.ts', () => ({ isLoginAllowed }));

const { isAllowed } = await import('./allowlist.ts');

describe('isAllowed', () => {
  beforeEach(() => isLoginAllowed.mockReset());

  it('mirrors the repository answer', async () => {
    isLoginAllowed.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(isAllowed('octocat')).resolves.toBe(true);
    await expect(isAllowed('stranger')).resolves.toBe(false);
  });

  it('fails closed when the lookup throws', async () => {
    isLoginAllowed.mockRejectedValueOnce(new Error('connection refused'));
    await expect(isAllowed('octocat')).resolves.toBe(false);
  });
});
