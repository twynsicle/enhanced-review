import { Authenticator } from 'remix-auth';
import { GitHubStrategy } from 'remix-auth-github';
import { env } from '@/config/env';
import { signInWithGithubToken, type SessionUser } from '@/domain/auth/sign-in.server';
import { oauthStateCookie } from './cookies.server';

/**
 * remix-auth wiring for the server-side GitHub redirect flow.
 * `authenticate()` on a request without `?code` redirects to GitHub; on the
 * callback it exchanges the code and runs the verify callback below. What the
 * caller does with the result (session cookie, token cookie) lives in the
 * route modules.
 */
export interface GithubSignIn {
  user: SessionUser;
  accessToken: string;
}

export const GITHUB_STRATEGY = 'github';

export const authenticator = new Authenticator<GithubSignIn>();

authenticator.use(
  new GitHubStrategy<GithubSignIn>(
    {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      redirectURI: new URL('/auth/github/callback', env.APP_ORIGIN),
      // `repo` so the runner can clone private repositories (same as before).
      scopes: ['repo'],
      cookie: oauthStateCookie,
    },
    async ({ tokens }) => {
      const accessToken = tokens.accessToken();
      const user = await signInWithGithubToken(accessToken);
      return { user, accessToken };
    },
  ),
  GITHUB_STRATEGY,
);
