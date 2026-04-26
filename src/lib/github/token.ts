import 'server-only';
import { readGithubTokenCookie } from '@/lib/pb';

/**
 * Thrown when the HttpOnly GitHub access-token cookie isn't set or has been
 * cleared. Happens before first sign-in, after sign-out, or if the user
 * signed in via a flow that didn't persist the token. Callers translate
 * this into a redirect to `/relink`.
 */
export class MissingProviderTokenError extends Error {
  constructor(message = 'No GitHub access token cookie on this request') {
    super(message);
    this.name = 'MissingProviderTokenError';
  }
}

/**
 * Read the user's GitHub OAuth access token from the HttpOnly
 * `gh_access_token` cookie set by `POST /api/auth/post-signin` after the
 * browser-side PB OAuth handshake completes.
 *
 * The token isn't persisted server-side (per the migration's "never store
 * the GitHub token" rule). We do **not** attempt to refresh it: GitHub
 * OAuth Apps don't issue refresh tokens, and PB doesn't expose one either.
 * If the token is rejected by GitHub, callers redirect the user to
 * `/relink` to re-run the OAuth flow.
 */
export async function getGithubToken(): Promise<string> {
  const token = await readGithubTokenCookie();
  if (!token) {
    throw new MissingProviderTokenError();
  }
  return token;
}
