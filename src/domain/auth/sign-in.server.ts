import { logger } from '../../common/logger.ts';
import { upsertUserFromGithub, type UserRow } from '../../db/users.ts';
import { fetchGithubProfile, type FetchLike } from './github-profile.server.ts';

/** The user as the web layer sees it: what the topbar and loaders need. */
export interface SessionUser {
  id: string;
  githubLogin: string;
  name: string | null;
  avatarUrl: string | null;
}

export function toSessionUser(row: UserRow): SessionUser {
  return { id: row.id, githubLogin: row.githubLogin, name: row.name, avatarUrl: row.avatarUrl };
}

/**
 * Completes a sign-in for a freshly exchanged GitHub access token: resolve the
 * GitHub identity, create-or-refresh the user row. The token itself is not
 * stored anywhere here — the caller puts it in the HttpOnly cookie (D3).
 */
export async function signInWithGithubToken(
  accessToken: string,
  fetchImpl?: FetchLike,
): Promise<SessionUser> {
  const profile = await fetchGithubProfile(accessToken, fetchImpl);
  const row = await upsertUserFromGithub(profile);
  logger.info({ user_id: row.id, github_login: row.githubLogin }, 'user signed in');
  return toSessionUser(row);
}
