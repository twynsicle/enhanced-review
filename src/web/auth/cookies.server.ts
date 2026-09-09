import { createCookie } from 'react-router';
import type { GitHubStrategy } from 'remix-auth-github';
import { env } from '@/config/env';

/**
 * The three cookies the auth flow touches. All HttpOnly, SameSite=Lax,
 * `Secure` whenever the app is served over https. `er_session` and
 * `gh_access_token` are signed with SESSION_SECRET, so a tampered value
 * parses as null instead of being trusted.
 */
const secure = new URL(env.APP_ORIGIN).protocol === 'https:';

export const SESSION_MAX_AGE_SEC = 7 * 24 * 60 * 60;
export const GITHUB_TOKEN_MAX_AGE_SEC = 90 * 24 * 60 * 60;

/** Carries only the session id; the payload lives in the `sessions` table. */
export const sessionCookie = createCookie('er_session', {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure,
  secrets: [env.SESSION_SECRET],
  maxAge: SESSION_MAX_AGE_SEC,
});

/** The GitHub OAuth access token. Never stored anywhere else. */
export const githubTokenCookie = createCookie('gh_access_token', {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure,
  secrets: [env.SESSION_SECRET],
  maxAge: GITHUB_TOKEN_MAX_AGE_SEC,
});

/** remix-auth-github's state/PKCE cookie; only needs to live for one round trip. */
type OauthStateCookie = Exclude<GitHubStrategy.ConstructorOptions['cookie'], string | undefined>;
export const oauthStateCookie: OauthStateCookie = {
  name: 'er_oauth',
  httpOnly: true,
  sameSite: 'Lax',
  path: '/auth',
  maxAge: 10 * 60,
  // SetCookieInit only accepts `secure: true`, never `false`.
  ...(secure ? { secure: true } : {}),
};

export async function readGithubToken(request: Request): Promise<string | null> {
  const value: unknown = await githubTokenCookie.parse(request.headers.get('cookie'));
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function setGithubTokenHeader(token: string): Promise<string> {
  return githubTokenCookie.serialize(token);
}

export function clearGithubTokenHeader(): Promise<string> {
  return githubTokenCookie.serialize('', { maxAge: 0, expires: new Date(0) });
}
