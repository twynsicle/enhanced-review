// Server-only re-exports. Client components must import `pbBrowser` from
// `@/lib/pb/browser` directly — the server-side modules pull in
// `next/headers` which the browser bundle can't resolve.
export { pbServer } from './client';
export { pbAdmin, withAdminRetry } from './admin';
export { getCurrentUser, readGithubTokenCookie } from './session';
export { GH_TOKEN_COOKIE, PB_AUTH_COOKIE } from './types';
export type { UserRecord } from './types';
