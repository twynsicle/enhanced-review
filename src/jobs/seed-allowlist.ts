import { z } from 'zod';
import { logger } from '../common/logger.ts';
import { addAllowedLogins, type SeedResult } from '../db/allowed-users.ts';
import { UsageError } from './errors.ts';

/**
 * `npm run job -- seed-allowlist <github-login> [more...]`
 *
 * Adds GitHub logins to `allowed_users`. Idempotent: logins already present
 * are reported as `existing`, never errors. Replaces the PocketBase admin-UI
 * step (00-overview D8).
 */
// GitHub username rules: alphanumerics and single hyphens, no leading/trailing
// hyphen, at most 39 characters.
const GITHUB_LOGIN = /^[A-Za-z\d](?:[A-Za-z\d]|-(?=[A-Za-z\d])){0,38}$/;

const loginsSchema = z
  .array(z.string().regex(GITHUB_LOGIN, 'not a valid GitHub login'))
  .min(1, 'at least one GitHub login is required');

export function parseLogins(args: string[]): string[] {
  const result = loginsSchema.safeParse(args);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => {
        const index = issue.path[0];
        const offender = typeof index === 'number' ? `"${args[index] ?? ''}": ` : '';
        return `${offender}${issue.message}`;
      })
      .join('; ');
    throw new UsageError(`seed-allowlist: ${detail}`);
  }
  return result.data;
}

export async function seedAllowlist(args: string[]): Promise<SeedResult> {
  const logins = parseLogins(args);
  const result = await addAllowedLogins(logins);
  logger.info({ ...result, logins }, 'allowlist seeded');
  return result;
}
