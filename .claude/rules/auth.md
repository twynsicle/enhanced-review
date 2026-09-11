---
paths:
  - 'src/web/auth/**'
  - 'src/domain/auth/**'
  - 'src/web/routes/_gated.tsx'
  - 'src/web/routes/login.tsx'
  - 'src/web/routes/relink.tsx'
  - 'src/web/routes/auth.*'
  - 'src/db/users.ts'
  - 'src/db/sessions.ts'
---

# How auth works

Loaded when you open a sign-in, session or gating file.

- `POST /auth/github` → remix-auth redirects to GitHub (`repo` scope, state in
  the `er_oauth` cookie). `GET /auth/github/callback` exchanges the code, the
  verify callback fetches `/user` and upserts `users` keyed on `github_id`,
  then the route mints a `sessions` row and sets two signed HttpOnly cookies:
  `er_session` (session id, 7 days) and `gh_access_token` (90 days). **The
  GitHub token is never written to the database.**
- Root middleware (`sessionMiddleware`) loads the session + user into route
  context on every request and rolls the session (row + cookie) once less than
  half its lifetime remains. It never redirects.
- Protected pages nest under `routes/_gated.tsx`, whose `requireUser`
  middleware requires a signed-in user; anyone else has their session deleted
  and both cookies cleared, and is redirected to `/login`. Public routes live
  outside the layout. Gated pages must export a loader so the chain runs.
  **Signing in with GitHub is the only condition for access** — the
  `allowed_users` allowlist and the `/denied` page are gone, so whatever
  fronts the deployment is the access control.
- `POST /auth/logout` uses the same `signOutHeaders`. `/relink` (gated)
  re-runs the OAuth flow when the token cookie is missing/rejected.
- GitHub logins are reusable; identity is `github_id` (migration
  `0003_drop_github_login_unique`).
