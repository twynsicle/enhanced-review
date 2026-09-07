import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SeedResult } from '../db/allowed-users.ts';

const addAllowedLogins = vi.fn<(logins: string[]) => Promise<SeedResult>>();
vi.mock('../db/allowed-users.ts', () => ({ addAllowedLogins }));

const { parseLogins, seedAllowlist } = await import('./seed-allowlist.ts');
const { UsageError } = await import('./errors.ts');

describe('parseLogins', () => {
  it('accepts valid GitHub logins', () => {
    expect(parseLogins(['octocat', 'a-b', 'X1'])).toEqual(['octocat', 'a-b', 'X1']);
  });

  it.each([
    [[]],
    [['-lead']],
    [['trail-']],
    [['double--hyphen']],
    [['has space']],
    [['a'.repeat(40)]],
  ])('rejects %j with a usage error', (args) => {
    expect(() => parseLogins(args)).toThrowError(UsageError);
  });

  it('names the offending argument', () => {
    expect(() => parseLogins(['ok', 'bad!'])).toThrowError(/"bad!": not a valid GitHub login/);
  });
});

describe('seedAllowlist', () => {
  beforeEach(() => addAllowedLogins.mockReset());

  it('forwards the logins and returns the repository result', async () => {
    addAllowedLogins.mockResolvedValue({ added: 1, existing: 1 });
    await expect(seedAllowlist(['octocat', 'hubot'])).resolves.toEqual({ added: 1, existing: 1 });
    expect(addAllowedLogins).toHaveBeenCalledWith(['octocat', 'hubot']);
  });

  it('does not touch the database on bad input', async () => {
    await expect(seedAllowlist([])).rejects.toThrowError(UsageError);
    expect(addAllowedLogins).not.toHaveBeenCalled();
  });
});
