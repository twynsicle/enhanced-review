import { data, redirect } from 'react-router';
import {
  classifyGithubError,
  createOctokit,
  GithubAuthError,
  type GithubClient,
} from '@/domain/github/client.server';
import { clearGithubTokenHeader, readGithubToken } from '@/web/auth/cookies.server';
import { describeGithubError, GITHUB_ERROR_STATUS, type GithubFailure } from './github-api';

/**
 * GitHub token handling for loaders and actions. The token lives only in the
 * HttpOnly cookie; a missing or rejected token sends the user through
 * `/relink`, which re-runs the OAuth flow. Thrown redirects are followed by
 * `useFetcher` as well as by document requests.
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
 * can fold it with `githubFailure` or let the error boundary have it.
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

/**
 * The `GithubFailure` body (with status) a resource route *returns* for a
 * thrown GitHub error. Auth errors are re-thrown for `withGithub` to turn
 * into the relink redirect. The per-repo lists pass `fullName` so the failure
 * is attributable to a repo the same way their success bodies are
 * (`RepoScopedFailure`).
 */
export function githubFailure(err: unknown, fullName?: string) {
  if (err instanceof GithubAuthError) throw err;
  const error = classifyGithubError(err);
  const body: GithubFailure & { fullName?: string } = {
    ok: false,
    error,
    message: describeGithubError(error),
    ...(fullName === undefined ? {} : { fullName }),
  };
  return data(body, { status: GITHUB_ERROR_STATUS[error.kind] });
}
