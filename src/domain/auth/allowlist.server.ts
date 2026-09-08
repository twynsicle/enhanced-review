import { logger } from '../../common/logger.ts';
import { isLoginAllowed } from '../../db/allowed-users.ts';

/**
 * The allowlist rule: a GitHub login is allowed iff it has a row in
 * `allowed_users`. Fails closed — a database error denies rather than admits.
 */
export async function isAllowed(githubLogin: string): Promise<boolean> {
  try {
    return await isLoginAllowed(githubLogin);
  } catch (err) {
    logger.error({ err, github_login: githubLogin }, 'allowlist lookup failed; denying');
    return false;
  }
}
