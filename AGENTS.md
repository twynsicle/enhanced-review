# Repo orientation for agents

Web-based AI code-review tool. Sign in with GitHub, pick a repo + PR/branch,
the server clones it, runs the Claude Agent SDK against it, and streams a
chaptered narrative review back. Successor to the diffy POC.

This file is the map of the tree for anyone changing it, cut to what every
change needs. The detail for each area lives beside it (see "Where the rest
lives"). `README.md` is the product-and-setup document; `docs/OPERATIONS.md`
is the runbook for a running deployment.

Library APIs here (React Router 8, Mantine 9, Prisma 7, remix-auth 4, Vite 8,
Vitest 4, Zod 4, TypeScript 7, oxlint) may be newer than your training data.
Check the package's docs in `node_modules/<pkg>` or the current online docs
before writing code against them; heed deprecation notices.

## Tech stack

- Node 24 (Volta-pinned, `engines >=24`). The Express server, the jobs CLI
  and the local `er` CLI run TypeScript directly via Node's type stripping —
  no build step for `server/`, `src/jobs/` or `src/cli/`.
- React Router 8 framework mode (SSR) on Vite 8; Express 5 via
  `@react-router/express` in `server/index.ts`. Single process: the review
  runner lives in-process, so never run under a forking manager.
- React 19, Mantine 9 (core/hooks/notifications/form/dates), Tabler icons,
  Zustand for persisted client prefs, Zod 4 at every boundary.
- Prisma 7 + `@prisma/adapter-pg` (engine-free) on Postgres 18. Client is
  generated into `src/db/generated/` (gitignored) by `postinstall`. Polling
  instead of realtime.
- Auth: remix-auth 4 + remix-auth-github 3 redirect flow; DB-backed sessions
  via React Router `createSessionStorage`; GitHub token only in an HttpOnly
  cookie.
- Pino logging (`src/common/logger.ts`); `console.*` is banned by guardrail.
- TypeScript 7 (native compiler) strict, `verbatimModuleSyntax`,
  `erasableSyntaxOnly`. Linting is **oxlint** (`.oxlintrc.json`) — TS 7 has
  no JS API, so typescript-eslint cannot run against it. Prettier formats.
- Vitest 4 projects: `unit` (node), `web` (happy-dom), `guardrails`
  (repo-reading convention tests), `integration` (real Postgres, self-skips).

## Repo layout

```
server/index.ts        Express bootstrap: dev = Vite middleware, prod = build/; SIGTERM/SIGINT → abortAll('shutdown') + drain, then close
prisma/
  schema.prisma        5 models (users, sessions, review_jobs, reviews, review_chunks) + JobStatus
  migrations/          0001_init (hand-added CHECK constraints), 0002_drop_allowed_users,
                       0003_drop_github_login_unique (logins are reusable; identity is github_id)
prisma.config.ts       Prisma CLI config; loads .env, datasource url from DATABASE_URL
vite.viewer.config.ts  the local report: src/web/viewer/ → one build/viewer/viewer.html, all inlined but Monaco
src/
  common/              logger.ts (pino), time-ago.ts, plural.ts — imports only config from src/
  config/              env.ts — Zod-parsed process.env, the only process.env reader; load-env.ts — loads .env for native entry points;
                       host-env.ts — hostEnv()/pickHostEnv() for code that spawns subprocesses
  db/                  client.ts (PrismaClient singleton, pingDb), users.ts, sessions.ts,
                       review-jobs.ts (conditional status transitions, lists, health counts), reviews.ts, review-chunks.ts,
                       generated/ (gitignored). JSON columns come back `unknown`; domain parses them.
  domain/              shared by server and browser; *.server.ts marks the server-only modules (see Layering)
    auth/              GitHub profile + sign-in upsert
    github/            one @octokit/core instance per request: repos, pulls, branches, target re-pinning, view-time reads
    review/            narrative + diagram schemas; clone/, prompt/, executor/; run.server.ts, the runner
    jobs/              registry, timeout, start/rerun/cancel/recover, boot, and the read side (jobs.server.ts)
  jobs/                cli.ts (`npm run job -- <name>`), recover-jobs.ts, errors.ts
  cli/                 `er`, the local review CLI: the package `bin`, put on PATH by `npm link`;
                       runs in the repo under review with no server config
  guardrails/          *.guard.test.ts — layering, env-access, no-console, routes-registered, zod-boundaries, server-only,
                       prisma-access, palette (token contrast, type scale, one label), diagram-colour (SVG takes token() only),
                       cli-imports (nothing `er` loads reaches env.ts, the logger, the db or a server package),
                       comment-paths (a repo path named in a comment still exists — see Comments),
                       monaco-version (the Monaco the reader loads is the one it is typechecked against)
  test/                integration-global-setup.ts (Postgres probe → provide dbAvailable), db.ts (describeDb, resetDb),
                       git-repo.ts (a throwaway repository with a bare origin, for tests that drive real git)
  web/                 the React Router app: root.tsx, entry.server.tsx, routes.ts (every file in routes/ must be listed),
                       routes/, auth/, components/, stores/ (Zustand, persisted), theme/, lib/, test/
public/                Passage brand-mark PNG export (the SVG sits beside components/brand-mark.tsx), favicon.svg / favicon.ico,
                       apple-touch-icon.png
docs/OPERATIONS.md     runbook for a running deployment
Dockerfile             node:24-alpine multi-stage; build stage runs prisma generate; runtime ships source + prod deps
entrypoint.sh          the image's CMD: prisma migrate deploy → recover-jobs → exec node server/index.ts
docker-compose.yml     postgres:18-alpine on 127.0.0.1:5432 + `web` (the app as it ships, on :3000, behind the `app` profile)
.github/workflows/ci.yml  check: postgres → npm ci → db:deploy → check:all; image: docker build → boot → /api/health
.claude/rules/         area detail, loaded when you open a file in that area (see below)
.claude/skills/        workflows loaded on demand (see below)
```

Layering (enforced by `src/guardrails`): `web → domain, db, common,
config`; `domain → db, common, config`; `db → common, config`;
`jobs → domain, db, common, config`; `cli → domain, common, config`;
`common → config`; `config` imports nothing from `src/`. Only `src/web/` and `server/` may import React or
`react-router`. `db` and `config` are server-only; `domain` is **shared**
between server and browser, and a domain module that imports `db`, `config`,
the logger, a `node:` builtin, a server-only package (`@octokit/*`, the Claude
SDK, `pg`, `pino`) or another `.server` module must be named `*.server.ts` —
rule of thumb: name it `.server.ts` unless the browser is meant to import it.
Inside `web`, only route modules, `root.tsx`, `entry.server.tsx` and
`*.server.ts` files may import those server-only things; everything else in
`web` ships to the browser and may import only non-`.server` domain modules
and `common`. Only `src/db/` may import `@prisma/*` or the generated client
(guardrail `prisma-access`).

## Where the rest lives

Each file in `.claude/rules/` declares `paths:` globs, and Claude Code loads it
the first time you read a matching file. Other tools and people can open them
directly.

- `web.md` — file-by-file map of `src/web/`. Loads for `src/web/**`.
- `design-system.md` — type scale, the one label, the reading measure, page
  width, colour tokens and contrast. Loads for components, routes, CSS, the
  theme and the colour guardrails.
- `auth.md` — sign-in, cookies, the session middleware, the gate, `/relink`.
  Loads for the auth code, the auth routes and the users/sessions repositories.
- `review-pipeline.md` — file-by-file map of `src/domain/` and how a review
  runs: create/rerun, runner, abort reasons, executors, process lifecycle,
  reads. Loads for `src/domain/**`, `src/jobs/**`, the review repositories and
  `server/index.ts`.
- `container.md` — the compose `app` profile, CMD vs entrypoint, what the
  image ships. Loads for the Docker, compose and CI files, `package.json` and
  `server/**`.
- `cli.md` — file-by-file map of `src/cli/` (`er review` and its stages).
  Loads for `src/cli/**` and `vite.viewer.config.ts`.

Skills in `.claude/skills/`, loaded when the task calls for them:

- `linear` — the Linear workflow for bug and feature work (see Task tracking).

## Conventions

- Path alias `@/*` → `src/*` is used in `src/web/` (bundled by Vite).
  Everything Node may load natively — `server/`, `src/config`, `src/common`,
  `src/db`, `src/domain`, `src/jobs`, `src/cli` — uses relative imports with
  explicit `.ts` extensions.
- Server-only modules use the React Router `*.server.ts` filename convention
  — `db`/`config` by location, `domain` and `web` by filename.
- `process.env` is read only in `src/config`. Code that spawns a subprocess
  gets the environment from `src/config/host-env.ts`.
- `src/db/client.ts` owns the Prisma lifecycle (globalThis singleton for Vite
  HMR, disconnect on SIGTERM/SIGINT). `server/index.ts` does not import it.
- Every loader/action parses `params`, search params and form data with Zod
  via `src/web/lib/parse.server.ts` (guardrail `zod-boundaries`).
- Env vars: add to the schema in `src/config/env.ts` **and** to `.env.example`
  in the same commit; add a test default in `vitest.config.ts` if required.
  Local values live in `.env` (gitignored).
- Schema changes: edit `prisma/schema.prisma`, `npm run db:migrate` (creates
  the migration and regenerates the client). Prisma 7 does not regenerate on
  migrate by itself.
- Integration tests: `*.integration.test.ts`, wrap in `describeDb` from
  `src/test/db.ts`, call `resetDb()` in `beforeEach`. Files run serially.
- No barrel `index.ts` files. Import the module you need
  (`@/web/theme/theme`, not `@/web/theme`).
- The image ships **source** for `server/`, `src/{config,common,db,domain,jobs}/`
  and `prisma/` only, and never installs the devDependencies Vite bundles
  (`@tabler/icons-react`, Monaco, `@dagrejs/dagre`, `@fontsource/*`). A new
  top-level `src/` area imported at runtime, or a runtime import of one of
  those packages, breaks the container but not `npm run dev`. Detail in
  `.claude/rules/container.md`.

## Comments

- A comment explains **why**, never what. If the code already says what it
  does, the comment is noise the next reader has to check against it.
- A comment **stands alone**. It is read cold, by someone with no access to a
  plan, a ticket or the conversation that produced it. A reference may add
  colour; it must never be where the reason lives.
- **Never cite a transient document.** Plans here are written just-in-time and
  deleted when the work lands, so a decision id, a phase number or a section
  mark is dead the day it is written, and nothing notices. The `comment-paths`
  guardrail sees one shape of this, the plan cited as a path
  (`docs/plans/phase-2.md`); a bare `A4(b)` or `overview §4` is on you alone.
- **Don't narrate the change.** "Moved here from X", "now does Y instead":
  `git log` carries that, and a year later the comment describes a diff nobody
  can see. Comments describe the code as it stands.
- **Prefer none.** A comment earns its place by recording what the code cannot
  say for itself — a constraint, a trap, a rejected alternative, a non-obvious
  ordering, a why-not.
- **Terse**: a line or two. A block that argues rather than points is the
  exception and may run longer — the module-level doc comment laying out a
  subsystem's shape, a rejected alternative, the reasoning behind a layout.

## Scripts

| Script                                     | What                                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| `npm run dev`                              | Express + Vite dev server on `localhost:3000`                               |
| `npm run build` / `npm start`              | `react-router build` / serve `build/` in production mode                    |
| `npm run viewer:dev` / `viewer:build`      | the local report: Vite dev server / single-file build                       |
| `npm run typecheck`                        | `react-router typegen && tsc --noEmit`                                      |
| `npm test` / `test:watch`                  | Vitest `unit` + `web` + `guardrails`                                        |
| `npm run test:integration`                 | Vitest `integration` (needs Postgres; skips when unreachable)               |
| `npm run lint` / `format` / `format:check` | oxlint / Prettier                                                           |
| `npm run check`                            | **The gate**: typecheck + build + viewer:build + test + lint + format:check |
| `npm run check:all`                        | `check` + integration                                                       |
| `npm run db:migrate`                       | `prisma migrate dev && prisma generate` (local schema changes)              |
| `npm run db:deploy` / `db:reset`           | apply migrations (CI/containers) / drop + reapply + generate                |
| `npm run db:generate` / `db:studio`        | regenerate client (also `postinstall`) / Prisma Studio                      |
| `npm run job -- <name> [args]`             | one-shot jobs, natively: `recover-jobs`                                     |

`docker compose up -d` starts Postgres alone for local dev; the app's own
container is behind the `app` profile.

## Environment

`.env.example` is the canonical list with comments. Required: `DATABASE_URL`,
`SESSION_SECRET` (≥ 32 chars), `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`,
`APP_ORIGIN`. Optional: `NODE_ENV`, `PORT`, `APP_VERSION`, `LOG_LEVEL`
(`silent` allowed), `LOG_PRETTY`, and the review runner's `REVIEW_EXECUTOR`
(`stub | claude`, default `claude`), `REVIEW_MODEL`, `REVIEW_TIMEOUT_MIN`,
`MAX_JOBS_PER_USER`, `ANTHROPIC_API_KEY`, and the browser polling cadence
`LIVE_POLL_MS` / `TERMINAL_POLL_MS`. `vitest.config.ts` fills
placeholders for the required keys and forces `REVIEW_EXECUTOR=stub` so
`npm run check` runs without a `.env` and never calls the SDK.

## Working on Windows

The user runs Windows. `bash` (Git Bash) and `powershell` are both available.
When you suggest commands, use forward-slash paths and POSIX-friendly syntax.
Line endings are normalised to LF by `.gitattributes`.

## Task tracking (Linear)

Bugs, features and improvements to the app are tracked in Linear, team
**enhanced-reviews** (key `ER`). Before starting one, when opening its PR and
when finishing it, load the `linear` skill and follow it.

**A bug you find while you are already in the code is yours to fix.** The
default for something noticed in passing is a commit on the branch you are on,
with the reason in its message — not a new issue. A ticket for a fix that would
have taken twenty minutes costs more than it saves: someone has to read it,
triage it, schedule it, and then rebuild the context you had in front of you at
the time. A backlog of small tickets is a cost, not a record.

File one instead only when you genuinely cannot do it now, and say which of
these is why:

- it turns on a decision that is the user's rather than yours;
- it is big enough to want a review of its own;
- it is somewhere the branch at hand has no business touching;
- fixing it here would bury the change under review.

Scope discipline still applies — this is about small fixes in code you are
already changing, not licence to widen the task. When you fix in band, the
commit message carries what the issue would have: what was wrong, and how you
know it is not any more. When you are unsure which way it goes, ask; do not
file as a way of avoiding the question.

Housekeeping gets no issue: agent config (this file, `.claude/`), docs,
tooling, CI, dependency bumps and small cleanups go straight to a
`<type>/<slug>` branch (for example `chore/split-agents-md`). Out-of-scope
housekeeping is mentioned to the user, not filed. If it is unclear which a
piece of work is, ask.

## Keeping this file up to date

Treat AGENTS.md and `.claude/rules/` as one living map, split by area. **Update
whichever file covers the area in the same change that introduces structural
drift, then commit that edit with the change.** Triggers:

- New top-level directory, or a new `src/<area>` / `src/web/routes/<route>`.
- A new Prisma model or a rule change on how one is accessed.
- A new env var, npm script, executor backend, job, or guardrail.
- Renames or removals of any of the above.
- A change to the high-level data flow (auth, job lifecycle, polling).

A new area gets a line in the layout above, and a rule file (plus a row in
"Where the rest lives") once it has detail worth more than that line. Keep this
file to what every change needs; anything that matters only inside one area
belongs in that area's rule. Pure refactors inside an already-named area do
**not** require an update.

1. If a map file is part of the diff, include it in the same commit as the
   code change that triggered it. Do not split it into a separate docs commit.
2. If you notice the map is stale relative to the tree, fix it in your next
   commit on the branch.
3. Commit message convention: follow whatever style `git log -n 5` shows.
4. Don't push without explicit user approval. Local commits are fine;
   remote-visible actions are not.
