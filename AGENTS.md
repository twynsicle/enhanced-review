<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# Repo orientation for agents

Web-based AI code-review tool (closed beta). Sign in with GitHub, pick a repo + PR/branch, the server clones it, runs the Claude Agent SDK against it, and streams a chaptered narrative review back. Successor to the diffy POC.

## Authoritative docs — read these first

| File                 | When to read                                                                            |
| -------------------- | --------------------------------------------------------------------------------------- |
| `README.md`          | Top-level summary, scripts table, prerequisites.                                        |
| `docs/README.md`     | Architecture, decisions, repo layout table.                                             |
| `docs/RUNNING.md`    | First-time local setup (PB binary, OAuth app, allowlist).                               |
| `docs/OPERATIONS.md` | Day-2 runbook: allowlist, key rotation, logs, stuck jobs, health, log-shape, env knobs. |
| `docs/rr-migration/` | Active re-platform plan (React Router + Prisma). Read 00-overview.md first.             |

If a question is covered there, read the doc rather than re-deriving from code.

## Tech stack (anchors for navigation)

- Next.js 16 App Router + React 19 + TypeScript strict, Turbopack default.
- Tailwind v4 + shadcn/ui (Radix base) — `components.json` configures the generator.
- PocketBase (single binary, SQLite) for auth, CRUD, and realtime SSE. Schema lives in `pb_migrations/` (JSVM).
- Review runner runs **in-process inside Next.js** — no separate worker. Fire-and-forget from the API route, AbortController registry for cancel.
- Vitest + Testing Library, ESLint + Prettier, GitHub Actions CI on PR (`format:check`, `lint`, `typecheck`, `test`).

## Repo layout

```
src/
  app/                         App Router pages + route handlers
    api/
      auth/post-signin         Mirrors PB OAuth result into gh_access_token cookie + backfills github_login
      auth/sign-out
      github/repos, github/file
      health                   Public ops endpoint
      jobs/route.ts            POST creates row, fires runner in-process
      jobs/[id]/cancel
      jobs/[id]/rerun
    jobs/[id]                  Live streaming view
    reviews/[id]               Final narrative reader
    history, login, denied, relink
  proxy.ts                     Next 16 middleware (renamed). Auth + allowlist gate, session rolling.
  components/                  home, narrative, notifications, theme, topbar, ui
  hooks/                       use-toast.ts
  lib/
    pb/                        pbBrowser / pbServer / pbAdmin clients + UserRecord type + cookie keys
    auth/                      allowlist gate (allowed_users collection)
    github/                    Octokit factory, token cookie reader, fetcher, view-time helpers
    jobs/                      concurrency, target schema, start-review, partial-narrative-parse
    jobs/runner/               In-process review runner: clone/, executor/ (claude + stub), prompt/, registry, run.ts, writes.ts, github.ts
    narrative/                 inline-diff-snippets, language-map
    log.ts                     pino logger (job_id / executor child loggers)

packages/
  github-client/               Octokit wrapper used by API routes (workspace package)
  review-types/                Shared NarrativeReview shape (chapters + insights + diffChunks)

pb_migrations/                 PocketBase JSVM migrations. Auto-applied on PB startup.
scripts/                       pb.mjs (launcher), pb-install.mjs (downloader, pinned version)
tools/pocketbase/              PB binary (gitignored — npm run pb:install populates)
pb_data/                       PB SQLite + settings (gitignored, persists OAuth config + allowlist + data)
docs/                          README, RUNNING, OPERATIONS, rr-migration/
test/                          server-only.shim.ts (Vitest alias for next/server-only)
.github/workflows/ci.yml       Format / lint / typecheck / test on PR + push to main
```

## How the system fits together

- **Auth**: GitHub OAuth via PB (popup). Provider config lives in `pb_data/settings.json` (set in admin UI, not committed). Per-request session cookie `pb_auth`; HttpOnly `gh_access_token` mirrored from PB's `meta.accessToken` by `/api/auth/post-signin`. Token never persisted in DB.
- **Allowlist gate**: `proxy.ts` runs on every matched request. Hydrates PB from cookie, refreshes token past half-life, blocks anything not in `allowed_users` collection (rules all `null` — admin-only). Public exits: `/api/auth/*`, `/api/health`, `/login`, `/denied`.
- **Job lifecycle**: `POST /api/jobs` → resolve head SHA via Octokit → insert `review_jobs` row (`status=pending`) → register `AbortController` in `src/lib/jobs/runner/registry.ts` → fire `runJob(...)` (no await) → return `{ id }`. The route arms a `setTimeout(REVIEW_TIMEOUT_MIN)` that writes `status=error` and aborts.
- **Runner** (`src/lib/jobs/runner/run.ts`): parse target → fetch PR metadata if PR → shallow clone (`git clone --depth=1`) → list changed files → build `PrData` → executor (`claude` via the Claude Agent SDK, or `stub`) streams chunks → each chunk inserted fire-and-forget into `review_chunks` → drain in-flight before flipping `status=done` → `finally` cleans clone dir + re-applies `cancelled` if signal aborted.
- **Streaming**: client subscribes to PB realtime SSE on `review_chunks` (deduped by `seq`). Drain-before-done means a subscriber that observes `done` already has every chunk.
- **Cancel**: `POST /api/jobs/[id]/cancel` updates row to `cancelled` under user's PB session, then signals the registry. Runner propagates the abort signal into the clone process and the SDK iterator.
- **Output shape**: `packages/review-types/src/narrative.ts` — `NarrativeReview` = `prTitle` + `overviewSummary` + `chapters[]` (each with `insights[]` and `diffChunks[]`).

## PocketBase collections (see `pb_migrations/1745539200_initial_schema.js`)

| Collection                  | Rules                                                                         | Notes                                                  |
| --------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------ |
| `users` (auth, PB built-in) | default                                                                       | Extended by migrations to add `github_login`.          |
| `allowed_users`             | all `null`                                                                    | Admin-only. Unique index on `github_login`.            |
| `review_jobs`               | list/view: any auth; update: owner while pending/running; create/delete: null | Status enum: pending, running, done, error, cancelled. |
| `reviews`                   | list/view: any auth; mutations null                                           | One per completed job (unique index on `job`).         |
| `review_chunks`             | list/view: any auth; mutations null                                           | Streamed partials. Unique on `(job, seq)`.             |

All status writes from the runner use `pbAdmin()` to bypass rules.

## Common scripts

| Script                            | What                                                       |
| --------------------------------- | ---------------------------------------------------------- |
| `npm run dev`                     | Next.js dev server (Turbopack) on `localhost:3000`         |
| `npm run build`                   | Production build                                           |
| `npm run lint`                    | ESLint                                                     |
| `npm run typecheck`               | `tsc --noEmit`                                             |
| `npm run format` / `format:check` | Prettier write / check                                     |
| `npm test` / `test:watch`         | Vitest                                                     |
| `npm run pb`                      | Local PocketBase server (`127.0.0.1:8090`, admin at `/_/`) |
| `npm run pb:install`              | Download pinned PB binary into `tools/pocketbase/`         |

## Environment

`.env.example` is the canonical list. Keys you'll see: `NEXT_PUBLIC_POCKETBASE_URL`, `POCKETBASE_URL`, `POCKETBASE_ADMIN_EMAIL`, `POCKETBASE_ADMIN_PASSWORD`, `REVIEW_EXECUTOR` (`stub`|`claude`), `REVIEW_MODEL`, `ANTHROPIC_API_KEY`, `REVIEW_TIMEOUT_MIN`, `MAX_JOBS_PER_USER`, `LOG_LEVEL`, `LOG_PRETTY`. Defaults and meaning are documented in `docs/OPERATIONS.md` (Tunable knobs).

## Conventions worth knowing before editing

- Path alias `@/*` → `src/*` (see `tsconfig.json`). Workspace deps `@enhanced-review/github-client` and `@enhanced-review/review-types` are transpiled by Next (`transpilePackages` in `next.config.ts`) — no build step.
- Server-only modules import `'server-only'` at the top. Vitest aliases this to `test/server-only.shim.ts` so they can be unit-tested. Do not import them from a client component.
- `proxy.ts` is the Next 16 rename of `middleware.ts` — runs on the Node runtime, so PB admin client is fine there.
- Use `pbServer()` for per-request session-bound work; `pbAdmin()` for rule-bypassing server-only writes; `pbBrowser()` for client components only.
- The runner is single-process: ~5 concurrent jobs is the design budget. Don't add cross-process queues without revisiting `docs/README.md`.
- No webhooks, no write-back to GitHub PRs, narrative-only (no Workspace mode). These are intentional cuts vs the diffy POC.

## Working on Windows

The user runs Windows. `bash` (Git Bash) and `powershell` are both available; the docs and scripts are written to work in either. When you suggest commands to the user, use forward-slash paths and POSIX-friendly syntax (Git Bash) — the one quirk noted in `docs/RUNNING.md` is the PB superuser-create command, which differs between shells.

## Keeping this file up to date

Treat AGENTS.md as a living map. **Update it in the same change that introduces structural drift, then commit the AGENTS.md edit with that change.** Triggers:

- New top-level directory, or a `src/lib/<area>` / `src/app/api/<route>` that didn't exist before.
- A new package under `packages/`.
- A new PocketBase collection, or a rule change on an existing one.
- A new env var, npm script, or executor backend.
- Renames or removals of any of the above.
- A change to the high-level data flow (auth, job lifecycle, streaming, cancel).

Pure refactors inside an already-named area (e.g. splitting `run.ts` into helpers under the same dir) do **not** require an AGENTS.md update — the directory entry still describes the area accurately.

When you do update it, also commit it. After making changes in this repo:

1. If `AGENTS.md` itself is part of the diff, include it in the same commit as the code change that triggered it (one commit, one logical change). Do not split it into a separate "docs" commit.
2. If you're touching the repo and notice AGENTS.md is stale relative to current state (a directory referenced no longer exists, an env var was renamed, etc.), fix it in your next commit on the branch — don't leave a known-stale map for the next agent.
3. Commit message convention: follow whatever style `git log -n 5` shows. Keep AGENTS.md updates terse — one line in the body is plenty (e.g. `Refresh AGENTS.md repo layout for new src/lib/foo`).
4. Don't push without explicit user approval. Local commits are fine; remote-visible actions are not.
