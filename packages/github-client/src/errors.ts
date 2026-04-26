/**
 * Thrown when GitHub returns 401, signalling the OAuth access token is no
 * longer valid (revoked, expired, scope downgraded). Callers in the web
 * app translate this into a redirect to `/relink`.
 *
 * GitHub OAuth Apps don't issue refresh tokens by default, so the only
 * correct recovery is to re-run the OAuth flow.
 */
export class GithubAuthError extends Error {
  readonly status: number;

  constructor(message = 'GitHub returned 401 — provider token invalid', status = 401) {
    super(message);
    this.name = 'GithubAuthError';
    this.status = status;
  }
}

/**
 * Best-effort detection of an Octokit RequestError indicating auth failure.
 * Octokit throws `RequestError` with a numeric `.status`; for GraphQL it
 * may surface as `GraphqlResponseError` with a `.errors[*].type` of
 * `UNAUTHORIZED`. Both shapes are covered.
 */
export function isAuthError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { status?: number; errors?: Array<{ type?: string }> };
  if (e.status === 401) return true;
  if (Array.isArray(e.errors) && e.errors.some((x) => x?.type === 'UNAUTHORIZED')) {
    return true;
  }
  return false;
}

/**
 * Re-throw as {@link GithubAuthError} if the underlying error is an auth
 * failure; otherwise re-throw the original error untouched. Use at the
 * boundary of every github-client method.
 */
export function rethrowAuth(error: unknown): never {
  if (isAuthError(error)) {
    throw new GithubAuthError();
  }
  throw error;
}
