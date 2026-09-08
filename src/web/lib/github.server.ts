import { redirect } from 'react-router';
import { createOctokit, GithubAuthError, type GithubClient } from '@/domain/github/client.server';
import { clearGithubTokenHeader, readGithubToken } from '@/web/auth/cookies.server';

/**
 * GitHub token handling for loaders and actions (phase-4-plan P4-D7). The
 * token lives only in the HttpOnly cookie (D3); a missing or rejected token
 * sends the user through `/relink`, which re-runs the OAuth flow. Thrown
 * redirects are followed by `useFetcher` as well as by document requests.
 */
export async function requireGithubToken(request: Request): Promise<string> {
  const token = await readGithubToken(request);
  if (!token) throw redirect('/relink');
  return token;
}

/** Redirect to `/relink`, dropping the rejected token cookie on the way. */
export async function relinkRedirect(): Promise<Response> {
  return redirect('/relink', { headers: { 'Set-Cookie': await clearGithubTokenHeader() } });
}

/**
 * Run `fn` with a per-request Octokit for the caller's token. `GithubAuthError`
 * becomes the relink redirect; every other error propagates so the caller
 * can classify it (`toResult`) or let the error boundary have it.
 */
export async function withGithub<T>(
  request: Request,
  fn: (client: GithubClient, token: string) => Promise<T>,
): Promise<T> {
  const token = await requireGithubToken(request);
  try {
    return await fn(createOctokit(token), token);
  } catch (err) {
    if (err instanceof GithubAuthError) throw await relinkRedirect();
    throw err;
  }
}
