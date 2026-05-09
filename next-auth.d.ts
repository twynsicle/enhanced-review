/**
 * Type augmentation for Auth.js v5. Adds `githubLogin` to the standard
 * `Session.user` shape so server components and route handlers can read it
 * without an extra DB hit, and tightens `id` to be required on the session
 * (database sessions always have one).
 *
 * Populated by the `session` callback in `src/lib/auth/auth.ts`, which copies
 * `users.github_login` (set by the GitHub provider's `profile()` callback)
 * onto the session object.
 */
import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      githubLogin: string | null;
    } & DefaultSession['user'];
  }

  interface User {
    githubLogin?: string | null;
  }
}
