# 00 — React Router migration overview (plan of plans)

**Status:** executing — Phases 0–4 complete, Phase 5 next. **Branch:** `migrate-react-router`, cut from `main` (`d63b87c`).
**Audience:** the maintainer and any agent picking this up cold.

This is the index document for re-platforming `enhanced-review` from
**Next.js 16 + PocketBase** (PB does auth, SQLite storage and realtime SSE
from one binary) onto the org's **base app stack**: React Router 8
(framework mode) on Express 5, Mantine 9, Prisma 7 + Postgres, Zod, Pino,
Vitest 4 projects, Node 24. The repo ends up shipping a Docker image and
nothing infra-shaped.

Every phase below gets its own `phase-N-plan.md` written **just before that
phase starts**, with ordered commits and verification steps. This file is
the map; it does not change once the decisions are locked, except to record
phase completion.

> **About `migrate-ecs`.** That branch (Postgres + Drizzle + Auth.js + SSE +
> Terraform/ECS) was an untested experiment on top of `main`. It is
> abandoned, not merged, and not the starting point. Its Drizzle schema and
> SSE handlers are useful _reference_ when writing the Prisma schema and the
> polling endpoints, nothing more.

---

## 1. Why

- The org's reference stack is React Router + Mantine + Prisma. This repo is
  pitched as a reusable template, so it has to _be_ an instance of that
  stack, not a Next.js app with a similar shape.
- The target infra is simpler than anything this app has targeted: one web
  service, one Postgres database in a shared cluster, no realtime channel.
  The app must work with polling only.
- PocketBase couples auth, storage and realtime in one binary that does not
  fit the org's platform. Everything PB-specific goes, along with the
  historical migration notes.

---

## 2. Decisions (locked — do not re-litigate)

| #   | Question                 | Decision                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Template source          | No template repo available. Build to the stack summary; flag guesses in the phase plans.                                                                                                                                                                                                                                                                                                                                             |
| D2  | UI fidelity bar          | Stay as close as possible to the current design (Editorial Iris palette, fonts, radii, layout, behaviour). Not pixel-perfect. **Prefer Mantine theming over per-component CSS tweaks.**                                                                                                                                                                                                                                              |
| D3  | Auth                     | `remix-auth` 4 + `remix-auth-github` 3, server-side OAuth redirect flow (replaces PB's popup). DB-backed sessions in Prisma. **GitHub access token is never persisted in the database** — it lives in an HttpOnly `gh_access_token` cookie set by the OAuth callback, read by the runner at job start and by the GitHub proxy routes. Same posture as today; `/relink` re-runs OAuth when it is missing or rejected.                 |
| D4  | Infra scope              | **No infrastructure in the repo.** Add a multi-stage `Dockerfile` and a `docker-compose.yml` (Postgres for local dev, optional web service). No Terraform, no deploy workflows. The org platform owns hosting.                                                                                                                                                                                                                       |
| D5  | Live job view            | Client polls `GET /api/jobs/:id?after=<seq>` every ~2 s. Response = job status + chunks with `seq > after`. Stops on terminal status. Replaces PB realtime subscriptions on `review_jobs` + `review_chunks`.                                                                                                                                                                                                                         |
| D6  | Cross-page notifications | Keep. Client polls `GET /api/me/jobs/terminal?since=<iso>` every ~10 s while the tab is visible; toasts newly terminal jobs. Same suppression rules as today.                                                                                                                                                                                                                                                                        |
| D7  | Docs                     | Delete `docs/archive/`. Rewrite `README.md`, `docs/README.md`, `docs/RUNNING.md`, `docs/OPERATIONS.md`, `AGENTS.md` for the new stack. Plan docs live in `docs/rr-migration/` and stay. The org-facing proposal docs on `migrate-ecs` are **not** carried over.                                                                                                                                                                      |
| D8  | Runner + one-shot jobs   | Review runner stays fire-and-forget **in the Express process** (AbortController registry, drain-before-done unchanged). `src/jobs/` gets `recover-jobs` (flip orphan `running` rows after a restart — new; PB had no equivalent) and `seed-allowlist` (replaces the PB admin-UI step) as one-shots built by the Node-only Vite config; the container entrypoint runs migrate → seed → recover → web.                                 |
| D9  | Domain layout            | `src/domain/` split by concern: `auth/` (allowlist rule, session/token helpers), `github/` (Octokit wrapper + fetch helpers — absorbs `packages/github-client`), `review/` (runner, clone, executor, prompt, narrative types — absorbs `packages/review-types`), `jobs/` (lifecycle: create/cancel/rerun/timeout, registry, shutdown, recovery). `packages/` is removed.                                                             |
| D10 | Data access              | **Full React Router idiom.** Page reads are route `loader`s. Mutations (create, cancel, rerun) are route `action`s submitted with `useFetcher`; 401-relink / 409-in-flight become typed action data with status codes. Client-side reads after mount (GitHub repo/PR/branch lists, file blobs, live-view polling, terminal polling) are resource-route loaders read via `useFetcher().load()`. Zod parses every action/loader input. |
| D11 | Database                 | **Fresh database.** SQLite → Postgres with no data migration. Prisma history starts at `0001_init`.                                                                                                                                                                                                                                                                                                                                  |
| D12 | Strategy                 | **Big-bang on one branch.** The app is non-functional between the end of Phase 1 and the end of Phase 4. Each commit compiles and `npm run check` is green at every phase gate. No Next/RR coexistence.                                                                                                                                                                                                                              |
| D13 | Baselines                | Capture live baseline screenshots from `main` before Phase 1 (maintainer performs the one-time PocketBase setup; the agent captures).                                                                                                                                                                                                                                                                                                |

---

## 3. Assumptions

Recommended defaults the phase plans follow unless overridden.

| #   | Assumption                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | **Fonts self-hosted** via `@fontsource-variable/inter-tight`, `@fontsource/source-serif-4`, `@fontsource-variable/jetbrains-mono` (same three families as today, replacing `next/font/google`).                                                                                                                                                                                                                                                                                                       |
| A2  | **Monaco `DiffEditor` stays** (`@monaco-editor/react`), loaded client-only via `React.lazy` + a hydration guard. It is a component, not a CSS framework.                                                                                                                                                                                                                                                                                                                                              |
| A3  | **Zustand** owns persisted client preferences: layout width, last review target per user (today's `last-target.ts` localStorage helper). Colour scheme is Mantine's `localStorageColorSchemeManager` (key `er-theme`, default dark), not Zustand. Toasts are `@mantine/notifications`.                                                                                                                                                                                                                |
| A4  | **Guardrails** (repo-reading tests): (a) layering — `web` may import `domain` and `db`; `domain` may import `db` and `common`; `db` imports only `common`; nothing outside `web`/`server` imports `react-router` or React; (b) `process.env` only in `src/config/`; (c) no `console.*` outside the logger itself; (d) every file in `src/web/routes/` is referenced from `routes.ts`; (e) every loader/action parses its input with Zod; (f) no `.server.ts` module imported from a client-side file. |
| A5  | **Tables** (Prisma): `users` (id, github_login unique, name, avatar_url), `sessions` (remix-auth / RR session storage), `allowed_users`, `review_jobs`, `reviews`, `review_chunks`. PB's `user`/`job` relation columns become `user_id`/`job_id`; PB autodates `created`/`updated` become `created_at`/`updated_at`; `risk_score` carried over. Rules PB enforced declaratively (owner-only cancel while pending/running; any authed user may read) become explicit checks in actions/loaders.        |
| A6  | **Session semantics** match today's: 7-day session, rolled when past half-life on any request (PB `authRefresh` behaviour), re-implemented in the auth middleware. `github_login`, `name` and avatar are refreshed from GitHub on every sign-in (today's `post-signin` backfill). Avatar becomes the GitHub avatar URL (PB downloaded it into a file field).                                                                                                                                          |
| A7  | **Postgres 18** (`postgres:18-alpine`) in `docker-compose.yml`, bound to `127.0.0.1:5432`, named volume. Prod pins nothing — the org cluster supplies the DB.                                                                                                                                                                                                                                                                                                                                         |
| A8  | **Versions:** latest stable within the summary's majors — React Router 8.3.x, Mantine 9.6.x, Prisma **7.10.x** (8 is still RC), Vite 8.2.x, Vitest 4.x, Zod 4.x, TypeScript 7.0.x, Node 24 via `volta` + `engines`. `package-lock.json` pins exact versions.                                                                                                                                                                                                                                          |
| A9  | **Lint:** ~~flat ESLint with typescript-eslint~~ **Superseded in Phase 1: oxlint** (`.oxlintrc.json`). TypeScript 7 has no JS API, so typescript-eslint cannot run against it. See phase-1-plan Deviations.                                                                                                                                                                                                                                                                                           |
| A10 | **Health endpoint** stays at `GET /api/health` (public). Login/denied/relink pages stay. Rerun + staleness badge + "PR moved" semantics unchanged.                                                                                                                                                                                                                                                                                                                                                    |
| A11 | **UI regression protocol:** baseline screenshots of every page in light + dark at 1280 px (stub executor, one seeded review). Re-capture after Phase 4 and compare side by side. Screenshots live in a gitignored `screenshots/` folder, not in the repo.                                                                                                                                                                                                                                             |
| A12 | **Server-only marker:** React Router's `.server.ts` filename convention replaces `import 'server-only'`. Domain/db code is server-only by construction (guardrail A4f). **Superseded by P3-D4:** `domain` is shared with the browser; a domain module that reaches server-only code is named `*.server.ts` and the layering guardrail enforces it.                                                                                                                                                    |
| A13 | **Docker is optional locally.** `npm run check` needs no Docker; only Postgres (compose) and `check:all` do. The `web` compose service exists to prove the image, not for day-to-day dev.                                                                                                                                                                                                                                                                                                             |

---

## 4. Current → target map

### Stack

| Concern         | Today (`main`)                                                                      | Target                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Runtime         | Node ≥ 20.9, unpinned                                                               | Node 24.x, Volta-pinned, `engines >=24`                                                                 |
| Framework       | Next.js 16 App Router, Turbopack                                                    | React Router 8 framework mode, Vite 8                                                                   |
| Server          | `next dev` / `next start`                                                           | Express 5 + `@react-router/express` in `server/`                                                        |
| UI kit          | Tailwind v4 + shadcn/Radix + lucide + cva/clsx/cmdk                                 | Mantine 9 (core/hooks/notifications/form/dates) + `@tabler/icons-react`                                 |
| Bespoke styling | Tailwind utility classes                                                            | Mantine theme + style props; CSS Modules only where theming can't reach                                 |
| Client state    | ad-hoc localStorage + shadcn `use-toast`                                            | Zustand (persisted prefs) + Mantine notifications                                                       |
| Validation      | Zod on some route bodies                                                            | Zod at **every** boundary (env, params, search params, form data, JSON columns)                         |
| Data store      | PocketBase (SQLite) via PB SDK, JSVM migrations                                     | Postgres via Prisma 7 + `@prisma/adapter-pg`, `prisma migrate`                                          |
| Auth            | PB GitHub OAuth popup, `pb_auth` cookie, PB superuser admin client, `proxy.ts` gate | remix-auth GitHub strategy (redirect flow), Prisma sessions, RR middleware gate                         |
| GitHub token    | HttpOnly `gh_access_token` cookie, never in DB                                      | Same                                                                                                    |
| Realtime        | PB realtime SSE subscriptions                                                       | Polling (2 resource-route loaders)                                                                      |
| Logging         | Pino                                                                                | Pino (unchanged; `console.*` banned by guardrail)                                                       |
| Tests           | Vitest, single jsdom project                                                        | Vitest 4 projects: `unit`, `web`, `guardrails`, `integration`                                           |
| Gate            | `format:check` + `lint` + `typecheck` + `test`                                      | `npm run check` (typecheck + build + unit/web/guardrails + lint + format), `check:all` adds integration |
| Local infra     | PB binary (`npm run pb`), no Docker                                                 | `docker compose up -d postgres`; Dockerfile for the image                                               |

### Directory layout

```
src/
  common/        logger (pino), time-ago, small utils
  config/        env.ts — Zod-parsed process.env, throws on import if invalid
  db/            prisma client singleton, repositories (jobs, chunks, reviews, users, sessions, allowlist)
  domain/        auth/ github/ review/ jobs/  (D9)
  jobs/          recover-jobs.ts, seed-allowlist.ts, index.ts (name → handler)
  web/           root.tsx, routes.ts, routes/ (pages + resource routes), components/, theme/, stores/
  guardrails/    convention tests
server/          index.ts — Express bootstrap, static, request handler, SIGTERM → registry abort
prisma/          schema.prisma, migrations/
docs/            README, RUNNING, OPERATIONS, rr-migration/
```

### Routes

| Path                                                                 | Kind     | Loader                                             | Action                                                                                                                   |
| -------------------------------------------------------------------- | -------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `/`                                                                  | page     | session + recent reviews                           | `intent=create` — validate target, resolve head SHA, insert, fire runner, redirect to `/jobs/:id`; 401/409 as typed data |
| `/login`, `/denied`, `/relink`                                       | page     | redirect if already signed in (login)              | —                                                                                                                        |
| `/history`                                                           | page     | jobs list, `?status=` filter                       | —                                                                                                                        |
| `/jobs/:id`                                                          | page     | job snapshot + chunks                              | `intent=cancel` (owner only, pending/running), `intent=rerun` (redirects to the new job)                                 |
| `/reviews/:id`                                                       | page     | review + GitHub view-time metadata                 | — (rerun button submits to `/jobs/:id`)                                                                                  |
| `/auth/github`, `/auth/github/callback`, `/auth/logout`              | resource | callback (sets session + token cookie)             | start OAuth / logout (remix-auth)                                                                                        |
| `/api/health`                                                        | resource | public health JSON                                 | —                                                                                                                        |
| `/api/github/repos`, `.../pulls`, `.../branches`, `/api/github/file` | resource | Octokit proxies, read via `useFetcher().load()`    | —                                                                                                                        |
| `/api/jobs/:id`                                                      | resource | **new** — `?after=<seq>` status + new chunks (D5)  | —                                                                                                                        |
| `/api/me/jobs/terminal`                                              | resource | **new** — `?since=<iso>` terminal transitions (D6) | —                                                                                                                        |

Removed: `/api/auth/post-signin`, `/api/auth/sign-out`, `/api/jobs` POST,
`/api/jobs/:id/cancel`, `/api/jobs/:id/rerun`, and every direct browser →
PocketBase call (`pbBrowser()` reads, subscriptions, `authWithOAuth2`).
Every loader/action parses params, search params and form data with Zod.

### What gets deleted

`pb_migrations/`, `scripts/pb.mjs`, `scripts/pb-install.mjs`, `src/lib/pb/`,
`src/app/` (all of it), `src/proxy.ts`, `src/components/ui/`, `src/hooks/`,
`packages/`, `test/server-only.shim.ts`, `docs/archive/`, `next.config.ts`,
`next-env.d.ts`, `components.json`, `postcss.config.mjs`, the empty
`supabase/` directory tree, and the dependencies `pocketbase`, `next`,
`eslint-config-next`, `tailwindcss`, `@tailwindcss/postcss`, `tw-animate-css`,
`shadcn`, `radix-ui`, `cmdk`, `class-variance-authority`, `clsx`,
`tailwind-merge`, `lucide-react`, `jsdom`.

`.env.local` (gitignored) still carries Supabase- and PocketBase-era keys;
Phase 1 replaces `.env.example`, and the maintainer prunes `.env.local` to
match.

---

## 5. Phases

Each phase ends with `npm run check` green and a commit series on the
branch. The app is only end-to-end runnable again at the end of Phase 4 (D12).

| Phase | Outcome                                                                                                                                                                                                                                                                                                                                                                       | Exit criteria                                                                                                                                  |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **0** | **Baseline + legacy removal.** Maintainer does the one-time PB setup (RUNNING.md §3–9); agent captures UI baseline screenshots (A11) including one stub review. Delete `docs/archive/` and the empty `supabase/` tree.                                                                                                                                                        | Baseline set exists for every page in light + dark. Current app still runs (nothing in `src/` touched).                                        |
| **1** | **Skeleton.** Node 24 pin, TS 7, Vite 8, RR 8 framework mode + Express server, Mantine provider + theme port (palette, fonts, radii, headings), `src/config` env schema, `src/common` logger, Vitest 4 projects, guardrails, `npm run check`, ESLint/Prettier, CI on `check`. New `Dockerfile` (node:24-alpine) + `docker-compose.yml` (pg 18, loopback). New `.env.example`. | Hello page renders in light + dark with the ported theme. `check` green. Docker image builds. Next.js and PocketBase gone from `package.json`. |
| **2** | **Data + auth.** Prisma schema + `0001_init`, `src/db` client + repositories, remix-auth GitHub strategy with redirect flow, Prisma session storage with half-life rolling (A6), `gh_access_token` cookie (D3), allowlist gate as route middleware, `/login` `/denied` `/relink` pages, `seed-allowlist` job.                                                                 | Sign in, get gated, sign out, all against local Postgres. Integration tests for repositories + allowlist skip cleanly when PG is down.         |
| **3** | **Domain port.** Move runner/clone/executor/prompt/github/review-types into `src/domain/*`; swap PB admin-client writes for repositories; job lifecycle service (create/cancel/rerun/timeout/registry/shutdown/recover). Port all existing unit tests.                                                                                                                        | Stub review runs end to end from an integration test and lands `done` with chunks + review row. `recover-jobs` job flips orphans.              |
| **4** | **Web port.** Every page + component rebuilt on Mantine + theme; loaders + actions with `useFetcher` (D10); resource-route loaders for GitHub lists and polling (D5, D6); Zustand stores (A3); notifications; Monaco lazy load; keyboard nav. Port component tests to `web` project.                                                                                          | Full app works locally with stub + claude executors. Side-by-side screenshots vs Phase 0 baseline reviewed and signed off.                     |
| **5** | **Jobs bundle + container.** Node-only Vite config → `build/jobs`, `npm run job -- <name>`, `entrypoint.sh` runs migrate → seed → recover → web, Dockerfile final, compose full flow, CI docker build.                                                                                                                                                                        | `docker compose up --build` from a clean clone works. `docker run <image> node build/jobs/index.js recover-jobs` works.                        |
| **6** | **Clean-out + docs.** Grep for every legacy term (PocketBase, `pb_`, Supabase, Next, shadcn, Tailwind, realtime) and remove. Rewrite `README.md`, `docs/README.md`, `docs/RUNNING.md`, `docs/OPERATIONS.md`, `AGENTS.md`. Final `check:all`.                                                                                                                                  | Zero hits for legacy terms outside `docs/rr-migration/` and git history. Fresh-clone walkthrough of RUNNING.md succeeds.                       |

Phase plan docs: `phase-0-plan.md` … `phase-6-plan.md`, written just-in-time.

---

## 6. Risks and how each phase handles them

- **Mantine vs bespoke design.** The narrative reader (chapter cards,
  insight callouts, diff chunks, sidebar, people card, risk score) is
  heavily custom. The Phase 4 plan classifies each component as _theme
  only_, _Mantine + style props_, or _CSS Module_, and justifies every CSS
  Module. The theme port happens in Phase 1 so Phase 4 builds on it.
- **PB rules become code.** Owner-only cancel while pending/running, and
  "any authed user can read every job" were declarative in PB. Phase 3
  puts them in the jobs service with unit tests; Phase 4 actions call the
  service rather than re-implementing checks.
- **Action error semantics.** Today's client branches on HTTP 401
  (`github_token_invalid` → `/relink`) and 409 (`job_in_flight` →
  link to the active job). With `useFetcher` these become a shared typed
  `ActionError` returned via `data(..., { status })`. The Phase 4 plan
  defines that shape once and every action uses it.
- **Polling latency.** A 2 s live-view cadence is a UX change from push.
  The Phase 4 plan makes the interval a config knob and pauses polling on
  hidden tabs.
- **OAuth flow change.** PB's popup flow becomes a full-page redirect. The
  GitHub OAuth app's callback URL must change from PB's
  `/api/oauth2-redirect` to the app's `/auth/github/callback`; RUNNING.md
  documents it in Phase 6, and Phase 2 needs it for local sign-in.
- **In-process runner + Express.** Same model as today; the server must not
  be run under a forking process manager. The Phase 1 plan documents
  single-process in `server/`.
- **TypeScript 7.** New compiler; the `tsc` binary name is unchanged. If a
  dependency's types break under 7, Phase 1 falls back to TS 6 and records
  the deviation.
- **Prisma 7 driver adapter.** `prisma migrate dev` no longer regenerates
  the client; `npm run db:migrate` must chain `prisma generate`. Phase 2.
- **remix-auth session storage.** React Router's `createSessionStorage`
  with Prisma-backed CRUD is the DB-session path. Phase 2 verifies against
  current remix-auth 4 docs before writing code.
- **Stub-only local verification.** A real-executor smoke test needs an
  `ANTHROPIC_API_KEY` (present in `.env.local`); the Phase 4 exit includes
  one real run.

---

## 7. Out of scope

- Any infra work. The org platform owns hosting; this repo ships an image.
- Data migration from the PocketBase SQLite database.
- Workspace mode, webhooks, write-back to GitHub (still intentional cuts).
- New features. The UI must look and behave the same; nothing gets added.
- Anything on the `migrate-ecs` branch, including the proposal docs.
