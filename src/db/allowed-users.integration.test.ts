import { beforeEach, expect, it } from 'vitest';
import { describeDb, resetDb } from '../test/db.ts';
import { addAllowedLogins, isLoginAllowed, removeAllowedLogin } from './allowed-users.ts';

describeDb('allowed-users repository', () => {
  beforeEach(resetDb);

  it('seeds idempotently and reports added vs existing', async () => {
    await expect(addAllowedLogins(['octocat', 'hubot', 'octocat'])).resolves.toEqual({
      added: 2,
      existing: 0,
    });
    await expect(addAllowedLogins(['hubot', 'newcomer'])).resolves.toEqual({
      added: 1,
      existing: 1,
    });
    await expect(addAllowedLogins([])).resolves.toEqual({ added: 0, existing: 0 });
  });

  it('matches logins exactly', async () => {
    await addAllowedLogins(['Octocat']);
    await expect(isLoginAllowed('Octocat')).resolves.toBe(true);
    await expect(isLoginAllowed('octocat')).resolves.toBe(false);
    await expect(isLoginAllowed('nobody')).resolves.toBe(false);
  });

  it('removes and reports whether anything was removed', async () => {
    await addAllowedLogins(['octocat']);
    await expect(removeAllowedLogin('octocat')).resolves.toBe(true);
    await expect(removeAllowedLogin('octocat')).resolves.toBe(false);
    await expect(isLoginAllowed('octocat')).resolves.toBe(false);
  });
});
