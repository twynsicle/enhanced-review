import 'server-only';
import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { db } from '@/lib/db/client';
import { users, accounts, sessions, verificationTokens } from '@/lib/db/schema';
import { isAllowed } from '@/lib/auth/allowlist';

/**
 * Auth.js v5 configuration. Database sessions backed by Drizzle, GitHub OAuth
 * with the same scopes PB used (`repo read:user user:email`). The `signIn`
 * callback enforces the `allowed_users` gate; the `session` callback exposes
 * `github_login` on the session so server components don't need an extra
 * DB hit.
 *
 * Exports:
 *   - `auth()`     — read the session in server components / route handlers
 *   - `handlers`   — re-exported by `/api/auth/[...nextauth]/route.ts`
 *   - `signIn`     — server-action sign-in helper
 *   - `signOut`    — server-action sign-out helper
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
      authorization: {
        params: { scope: 'repo read:user user:email' },
      },
      profile(profile) {
        return {
          id: String(profile.id),
          name: profile.name ?? profile.login,
          email: profile.email,
          image: profile.avatar_url,
          githubLogin: profile.login,
        };
      },
    }),
  ],
  session: { strategy: 'database' },
  callbacks: {
    async signIn({ user }) {
      const login =
        typeof (user as { githubLogin?: unknown }).githubLogin === 'string'
          ? (user as { githubLogin: string }).githubLogin
          : null;
      if (!login) return false;
      return isAllowed(login);
    },
    async session({ session, user }) {
      session.user.githubLogin =
        typeof (user as { githubLogin?: unknown }).githubLogin === 'string'
          ? (user as { githubLogin: string }).githubLogin
          : null;
      session.user.id = user.id;
      return session;
    },
  },
  pages: {
    signIn: '/login',
    error: '/denied',
  },
});
