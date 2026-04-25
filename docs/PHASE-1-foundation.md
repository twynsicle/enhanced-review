# Phase 1 — Foundation: infra + auth shell

## Goal

Stand up the project skeleton: a Next.js app, self-hosted Supabase via `docker-compose`, GitHub OAuth login gated by a username allowlist, and a placeholder authenticated page. Nothing review-related yet.

## Demoable at end

- `docker-compose up` brings up Supabase locally.
- Visiting the app in a browser shows a "Sign in with GitHub" page.
- Signing in with an **allowed** GitHub username lands on a logged-in placeholder page that displays the user's GitHub login + avatar.
- Signing in with a **non-allowed** username shows an "Access denied — beta is invite-only" page and rejects the session.
- Sign-out works.

## Tasks

1. **Scaffold Next.js project** in `enhanced-review/` using `npm` and `create-next-app` (App Router, TypeScript strict, ESLint, Prettier, `src/app` directory layout).
2. **Set up styling** with **Tailwind CSS + shadcn/ui** (initialize via `shadcn` CLI, neutral base color). Add the handful of primitives we'll need for the auth shell (button, card).
3. **`docker-compose.yml`** based on the official `supabase/supabase` self-host stack (postgres, GoTrue, Realtime, Storage, Studio, Kong gateway), used as-is so upstream fixes can be merged later. Persist data in a named volume so restarts don't wipe accounts. Pin Studio off port 3000 so it doesn't collide with `next dev`.
4. **Configure GitHub OAuth provider** in Supabase (callback URL, client ID/secret via env). Document how to register a GitHub OAuth app for local dev.
5. **`allowed_users` table** with `github_login` (text) primary key + `created_at`. Seed with `twynsicle` via a SQL migration in `supabase/migrations/`.
6. **Allowlist enforcement via Next.js middleware** — after a user completes Supabase OAuth, middleware looks up their `github_login` in `allowed_users`; if missing, calls `supabase.auth.signOut()` and redirects to `/denied`. (Auth Hook / Edge Function approach was considered and rejected for Phase 1 in favor of easier debugging.)
7. **Auth middleware** — Next.js middleware that redirects unauthenticated users to `/login`, denied users to `/denied`, and otherwise lets the request through. Use `@supabase/ssr` for cookie-based session reads.
8. **Placeholder home page** — shows GitHub login + avatar + sign-out button. Sign-out redirects to `/login`. No other features.
9. **`.env.example`** documenting every env var needed (Supabase URL/keys, GitHub OAuth client/secret, JWT secret, postgres password, etc.).
10. **README** for `enhanced-review/` covering: prerequisites, registering a GitHub OAuth app, `docker-compose up`, applying migrations, seeding the allowlist, running `npm run dev`.
11. **Initialize git** at `enhanced-review/` (not at the outer `diffy/` workspace).
12. **Vitest** unit-test harness configured for the Next.js + TypeScript setup. No tests required to land Phase 1, but the harness must run cleanly on an empty suite.
13. **GitHub Actions** workflow running `lint`, `typecheck`, and `vitest` on pull requests to `main`.

## Schema sketch

```sql
create table allowed_users (
  github_login text primary key,
  created_at   timestamptz not null default now()
);
```

RLS: `allowed_users` is server-only (no client reads). Enforcement happens in a server-side check during the auth callback.

## Out of scope (deferred)

- Listing repos / PRs (Phase 2).
- Any database tables for reviews or jobs (Phase 3).
- Any worker container (Phase 3).
- Token refresh logic (Phase 2 — first place we use the GitHub token).

## Decisions (resolved)

- **Styling**: Tailwind CSS + shadcn/ui, neutral base color.
- **Allowlist enforcement**: Next.js middleware (after Supabase OAuth completes). Brief window where a denied user holds a session is acceptable for an invite-only beta; debugging clarity wins for Phase 1.
- **Local Supabase**: official `supabase/supabase` self-host `docker-compose.yml` used as-is (no trimming), so we can pull upstream fixes without merge pain.
- **Seed user**: `twynsicle` (the operator).
- **Package manager**: `npm`.
- **Layout**: `src/app` directory.
- **Tests/CI**: Vitest for unit tests (harness only in Phase 1, no required tests). Prettier + ESLint. GitHub Actions runs lint, typecheck, and vitest on PRs. **No Playwright / E2E in Phase 1.**
- **Version control**: `git init` inside `enhanced-review/` only. The outer `diffy/` workspace contains a deprecated POC kept for reference and is not tracked.

## Risks

- Supabase self-host compose has a lot of moving parts (Kong, Studio, GoTrue, Realtime, Storage). Easy to spend a day on env-var alignment. Budget for this.
- GitHub OAuth callback URL must match exactly — common source of "redirect_uri mismatch" pain. Document it.
- Default Supabase Studio exposes port 3000, which collides with `next dev`. Remap Studio (or Kong's Studio route) before first boot.
- Middleware-based allowlist enforcement means a denied user briefly holds a Supabase session between OAuth callback and the middleware redirect. Acceptable for an invite-only beta but worth re-evaluating if the threat model changes.
