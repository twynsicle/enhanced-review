import { Octokit } from 'octokit';

/**
 * Construct a per-request Octokit instance authenticated with the user's
 * GitHub OAuth access token.
 *
 * Token must be passed in explicitly; this module deliberately has no
 * dependency on Next.js cookies or any request context so it stays
 * portable to non-Next runtimes.
 */
export function createOctokit(token: string): Octokit {
  if (!token) {
    throw new Error('createOctokit: token is required');
  }
  return new Octokit({
    auth: token,
    userAgent: 'enhanced-review/0.1',
  });
}
