# 02 — Auth replacement (Auth.js v5)

Replaces PocketBase's auth + allowlist gate with Auth.js v5 (NextAuth) backed by Drizzle. The OAuth UX stays identical (GitHub popup, same scopes), but the session cookie, token storage, and allowlist enforcement all move to standard library plumbing.

This doc assumes the schema in [01](./01-postgres-data-layer.md) is in place (the `users`, `accounts`, `sessions`, `verification_tokens` tables Auth.js requires).

---

## Decisions feeding into this doc

- **D2** Auth.js v5 with Drizzle adapter, GitHub OAuth, database sessions
- **D7** Cognito user pool gates the ALB; Auth.js handles GitHub identity inside the app
- Provider-swap note: Google OAuth is a **config diff**, not a refactor — discussed below and elaborated in [11](./11-proposal-lightweight-infra.md) and [12](./12-proposal-software-stack.md)

---

## Why Auth.js v5

- **Standard for Next.js 16 App Router.** First-class support for the `app/` router, route handlers, server actions, and React Server Components. The integration boilerplate is one config file.
- **Drizzle adapter is officially supported.** `@auth/drizzle-adapter` reads/writes the four standard tables; we drop in our schema and it just works.
- **Database sessions, not JWT.** Reasoning: GitHub access tokens need to be stored server-side (the runner reads them to clone repos). Auth.js's `accounts` table holds them — exactly what we need. JWT mode requires you to roll your own token-stash, defeating the point.
- **Provider swappability.** The same config supports GitHub, Google, and dozens more with a one-block change. See the org-SSO comparison below.

---

## Two-layer auth: Cognito + Auth.js

Two different identities, two different jobs:

```
Browser ──▶ ALB ──── Cognito hosted UI ────▶ "is this Steven? yes."
              │       (set ALB-managed cookie)
              ▼
         ALB target group ──▶ Fargate task ──▶ Next.js
                                                 │
                                       Auth.js ──┼──▶ "what's this user's
                                                 │     GitHub identity + token?"
                                                 ▼
                                            (database session,
                                             OAuth tokens in `accounts`)
```

- **Cognito** answers "is this person allowed to talk to the ALB at all?" — one user pool, one user. Free for one user. Hosted UI on a Cognito-managed subdomain. ALB drops requests with no Cognito session.
- **Auth.js** answers "what's the active user's GitHub identity, and how do I act on their behalf?" — the runner reads the GitHub access token from `accounts` to do `git clone`.

You log into Cognito *once* per browser-session (very long expiry); you log into GitHub via Auth.js *once* per app session (rolling). They don't talk to each other directly. The user experience is two separate sign-in screens the first time; both have very long-lived sessions, so day-to-day it's invisible.

> **Why both?** Cognito alone can't act as a GitHub user. Auth.js alone can't gate the ALB. The combination gives us network-level access control (Cognito) and identity-with-a-token (Auth.js).

If the user ever wanted to drop Cognito (e.g. switch to Cloudflare Access, Tailscale, or IP allowlist), the Auth.js layer is unaffected. Decoupled.

---

## Auth.js setup

### File layout

```
src/
  lib/
    auth/
      auth.ts                # NextAuth() config — exports auth, handlers, signIn, signOut
      allowlist.ts           # rewritten to use Drizzle (see 01)
  app/
    api/
      auth/
        [...nextauth]/
          route.ts           # exports GET, POST = handlers
```

### Type augmentation (`next-auth.d.ts`)

Land this **first** in the auth-cutover commit cluster. Without it, every consumer reading `session.user.githubLogin` (the `session` callback below, the proxy, every server component) fails to typecheck and the cascade is annoying to bisect.

```typescript
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
```

`id` is tightened from optional → required because database sessions always have one — saves a long tail of nullable-id ceremony at every consumer.

### `auth.ts`

```typescript
import 'server-only';
import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { db } from '@/lib/db/client';
import { users, accounts, sessions, verificationTokens } from '@/lib/db/schema';
import { isAllowed } from '@/lib/auth/allowlist';

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
      authorization: { params: { scope: 'repo read:user user:email' } },
      profile(profile) {
        // Persist github_login alongside the standard fields.
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
      // Allowlist gate: refuse the login if github_login isn't allowed.
      const login = (user as { githubLogin?: string }).githubLogin;
      if (!login) return false;
      return isAllowed(login);
    },
    async session({ session, user }) {
      // Expose github_login on the session so server components can read it.
      (session.user as { githubLogin?: string }).githubLogin = (user as { githubLogin?: string }).githubLogin;
      return session;
    },
  },
  pages: {
    signIn: '/login',
    error: '/denied',
  },
});
```

Highlights:

- **`profile()`** captures `github_login` from the GitHub user response and the Drizzle adapter persists it into our extended `users` table. No separate post-signin handler needed.
- **`signIn` callback** is the allowlist gate. Returning `false` aborts the sign-in (Auth.js redirects to `/denied`).
- **`session` callback** surfaces `github_login` on the session object so RSCs can read it without an extra DB hit.
- **`session.strategy: 'database'`** keeps the session in the `sessions` table; no JWT to lose.

### `route.ts` for `[...nextauth]`

```typescript
export { GET, POST } from '@/lib/auth/auth'; // re-exports the handlers
```

Auth.js handles `/api/auth/signin`, `/api/auth/callback/github`, `/api/auth/signout`, `/api/auth/session`, etc., all under one catch-all route.

---

## Token storage: where the GitHub access token lives

PB stored the GitHub access token in an HttpOnly cookie (`gh_access_token`). Auth.js stores it in the `accounts` table (one row per OAuth provider per user). Server-only, never exposed to the client.

`src/lib/github/token.ts` (rewritten):

```typescript
import 'server-only';
import { db } from '@/lib/db/client';
import { accounts } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

export async function getGithubTokenFor(userId: string): Promise<string | null> {
  const rows = await db
    .select({ token: accounts.access_token })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, 'github')))
    .limit(1);
  return rows[0]?.token ?? null;
}
```

- The runner calls `getGithubTokenFor(userId)` instead of reading a cookie — this is a strict improvement (server-side, queryable, revocable).
- The cookie is gone. No cross-cutting "set this on every request" concern.
- **Token refresh:** GitHub tokens don't expire by default for OAuth Apps (unlike short-lived access tokens for fine-grained PATs). For the GitHub provider in Auth.js v5, `refresh_token` is null and `expires_at` is null, so we don't need refresh logic. If we later switch to GitHub Apps, see the Auth.js refresh-token recipe.

---

## Allowlist gate (rewritten)

`src/lib/auth/allowlist.ts`:

```typescript
import 'server-only';
import { db } from '@/lib/db/client';
import { allowedUsers } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function isAllowed(githubLogin: string): Promise<boolean> {
  const rows = await db
    .select({ id: allowedUsers.id })
    .from(allowedUsers)
    .where(eq(allowedUsers.githubLogin, githubLogin))
    .limit(1);
  return rows.length > 0;
}
```

The gate runs in two places:

1. **Sign-in callback** (above) — refuses the OAuth handshake before a session is even created.
2. **`src/proxy.ts` middleware** — defense-in-depth. If someone is somehow already signed in but the allowlist row is removed, every subsequent request is rejected.

### Middleware (`src/proxy.ts`)

PB's middleware did three things: hydrate from cookie, refresh token past half-life, allowlist gate. Auth.js takes over the first two — the rolling-token logic is built in. We only keep the allowlist gate.

```typescript
import { auth } from '@/lib/auth/auth';
import { isAllowed } from '@/lib/auth/allowlist';
import { NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/api/auth', '/api/health', '/login', '/denied', '/_next', '/favicon.ico'];

export const proxy = auth(async (req) => {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const session = req.auth;
  if (!session?.user) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  const githubLogin = (session.user as { githubLogin?: string }).githubLogin;
  if (!githubLogin || !(await isAllowed(githubLogin))) {
    return NextResponse.redirect(new URL('/denied', req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

Notes:

- `auth()` wraps the middleware function and provides `req.auth` for free.
- `proxy.ts` is the Next 16 rename of `middleware.ts` (already in this repo). Continues to work the same way.
- Public-path bypass list shrinks: `/api/auth/post-signin` and `/api/auth/sign-out` are gone. Auth.js routes are under `/api/auth/*` which is already public.

---

## Sign-in / sign-out UX

### Sign-in button

`src/app/login/sign-in-button.tsx`:

```typescript
'use client';
import { signIn } from 'next-auth/react';

export function SignInButton() {
  return <button onClick={() => signIn('github', { callbackUrl: '/' })}>Sign in with GitHub</button>;
}
```

`signIn()` redirects to `/api/auth/signin/github`, which redirects to GitHub, which redirects back to `/api/auth/callback/github`, which runs the `signIn` callback (allowlist gate), creates the session row, and redirects to `callbackUrl`. Same UX as before, less code.

### Re-link button

`src/app/relink/relink-button.tsx` — calling `signIn('github')` again with an existing session triggers a re-auth and overwrites the `accounts` row with the fresh token. No special "relink" code path.

### Sign-out

```typescript
import { signOut } from 'next-auth/react';
<button onClick={() => signOut({ callbackUrl: '/login' })}>Sign out</button>;
```

Drops the session row + cookie. `/api/auth/sign-out/route.ts` is deleted.

---

## Cognito setup (ALB-side)

This is summarized here; the full Terraform lives in [06](./06-aws-infra-terraform.md).

- **User pool** with one user (the maintainer's email). MFA optional but recommended.
- **App client** with the ALB callback URL: `https://<your-domain>/oauth2/idpresponse` (this is the URL ALB exposes for OIDC).
- **Hosted UI** on a Cognito-managed subdomain: `<prefix>.auth.<region>.amazoncognito.com`. No custom domain — saves the cert hassle on the Cognito side.
- **ALB listener rule** on HTTPS:443 with action `authenticate-cognito` before `forward` to the target group. Cognito-issued OIDC tokens are added as request headers (`x-amzn-oidc-data`, `x-amzn-oidc-identity`).

The Next.js app **does not read** the Cognito headers. They only matter to the ALB. If we ever wanted in-app awareness of the Cognito identity (e.g. for audit), we could parse them, but it's not necessary — Auth.js is the source of truth for app identity.

---

## Provider-swap appendix: Google OAuth for org SSO

The user asked: *"how could similar apps use Google OAuth so users SSO in with their work accounts?"*

Short answer: **trivially, with two important nuances** depending on whether the app needs identity-only or on-behalf API access.

### Identity-only (most internal apps)

If the app only needs "who is this person" (no Google API calls on the user's behalf), the change is a config swap:

```typescript
import Google from 'next-auth/providers/google';

providers: [
  Google({
    clientId: process.env.AUTH_GOOGLE_ID,
    clientSecret: process.env.AUTH_GOOGLE_SECRET,
    authorization: {
      params: {
        scope: 'openid email profile',
        hd: 'yourcompany.com',  // restrict to your Workspace domain
      },
    },
  }),
],
```

What changes:

- **Schema**: nothing. `users`, `accounts`, `sessions`, `verification_tokens` tables are provider-agnostic.
- **Allowlist semantics**: switch from `github_login` matching to email-domain matching, or drop the allowlist entirely if `hd` already restricts to your Workspace domain (which is usually enough).
- **Runner / data layer**: nothing changes.
- **Cognito layering**: optional but useful — Cognito can federate Google as an OIDC IdP, layering org SSO at the network edge in addition to Auth.js.

That's it. Same Drizzle adapter, same session strategy, same middleware.

### On-behalf API access (some apps)

If the app calls Google APIs as the user (Drive, Calendar, Gmail, BigQuery, Vertex AI, etc.), you'll need:

- The right scopes for each API surface (these can compound quickly; users see them all in the consent screen).
- **Refresh-token handling.** Unlike GitHub OAuth Apps, Google access tokens expire (~1 hour). Auth.js v5 supports refresh-token rotation; you wire it up in the `jwt` or `session` callback. The `accounts` row stores `refresh_token`, and you exchange it for a new `access_token` when expired.
- **Verified app + brand verification** if you want to leave testing mode (Google's screen of doom).

For apps that only do SSO (the common case), skip all of this.

### When to choose which

| If your app...                                          | Use                                                                          |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Acts on the user's GitHub repos / orgs / actions        | GitHub OAuth (this POC)                                                      |
| Just needs to know who someone is, with org SSO         | Google OAuth, restrict via `hd`                                              |
| Acts on Google Workspace data on the user's behalf      | Google OAuth + scope-per-API + refresh tokens                                |
| Has both kinds of users / both kinds of work            | Both providers in the same Auth.js config (tested pattern, just two blocks)  |

The infrastructure (Cognito, ALB, ECS, Drizzle, all the Terraform) is **identical** regardless. The auth choice is a software-side decision. This is exactly the kind of orthogonality the proposal docs in [11](./11-proposal-lightweight-infra.md) and [12](./12-proposal-software-stack.md) lean on.

---

## Migration risks

- **Auth.js manages its own cookie** (`authjs.session-token`). The legacy `pb_auth` cookie can be ignored — it expires on its own. No special cleanup needed.
- **Sessions don't carry over.** Anyone who was signed in before the migration has to sign in again. For a one-user POC, this is a non-event; for the proposal docs, flag it as a one-time disruption.
- **`signIn` callback ordering with the Drizzle adapter.** Auth.js v5 calls the adapter's `createUser` *before* the `signIn` callback fires (the adapter needs an id to attach the new session to). When `signIn` returns `false`, the user row is left behind. For a single-user POC this is harmless — verify the observed behaviour and document the cleanup option (a `DELETE FROM users WHERE id = ...` in the `signIn` callback before returning `false`) if it ever matters.
- **Allowlist updates require a DB write, not an admin UI click.** [09](./09-cost-and-operations.md) documents the runbook for adding/removing allowlist rows via ECS Exec.
- **GitHub OAuth app callback URL** changes from PB's URL to Auth.js's: `https://<your-domain>/api/auth/callback/github`. Update in the GitHub OAuth app settings during deploy.

---

## Verification

Phase A success for the auth slice:

1. `npm run dev` → click "Sign in with GitHub" → popup → consent → redirect home, signed in.
2. `users` row populated with `github_login`. `accounts` row populated with the GitHub access token.
3. Allowlist gate: temporarily remove your row, refresh, get redirected to `/denied`. Restore.
4. Sign out → cookie cleared → trying to access `/` redirects to `/login`.
5. `/api/jobs` POST works (the runner can read your token from `accounts` and clone a public repo).
6. `pb_auth` cookie not set anywhere; grep for `pocketbase`, `pbServer`, `pbAdmin`, `pbBrowser` returns empty.

After deploy (Phase C):

7. Visiting the domain → Cognito login first → app load → GitHub sign-in.
8. Logging out of the app does **not** log out of Cognito (separate sessions).
9. Updating the GitHub OAuth callback URL in GitHub's app settings; sign-in still works after.
