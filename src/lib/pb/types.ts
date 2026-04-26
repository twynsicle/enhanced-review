import type { RecordModel } from 'pocketbase';

/**
 * Shape of a record from the `users` auth collection. Extends PB's base
 * `RecordModel` with our app-specific fields. PB system fields like `id`,
 * `email`, `name`, `avatar`, `username` are inherited via `RecordModel`'s
 * index signature.
 */
export interface UserRecord extends RecordModel {
  email: string;
  name: string;
  avatar: string;
  username: string;
  github_login: string;
}

/** Cookie key the PB SDK uses by default for its serialized auth state. */
export const PB_AUTH_COOKIE = 'pb_auth';

/**
 * HttpOnly cookie holding the GitHub OAuth provider access token. Set by
 * `/api/auth/post-signin` after a browser-side OAuth handshake; cleared by
 * `/api/auth/sign-out`. Read server-side by `getGithubToken()`.
 *
 * Lives outside `pb_auth` so we can set it `httpOnly: true` (PB's auth
 * cookie is read by the browser SDK, so it can't be).
 */
export const GH_TOKEN_COOKIE = 'gh_access_token';
