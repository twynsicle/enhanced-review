<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# Repo orientation for agents

Web-based AI code-review tool (closed beta). Sign in with GitHub, pick a repo + PR/branch, the server clones it, runs the Claude Agent SDK against it, and streams a chaptered narrative review back. Successor to the diffy POC.

## Authoritative docs — read these first

| File                  | When to read                                                                            |
| --------------------- | --------------------------------------------------------------------------------------- |
| `README.md`           | Top-level summary, scripts table, prerequisites.                                        |
| `docs/README.md`      | Architecture, decisions, repo layout table.                                             |
| `docs/RUNNING.md`     | First-time local setup (Postgres via docker-compose, OAuth app, allowlist seed).        |
| `docs/OPERATIONS.md`  | Day-2 runbook: allowlist, key rotation, logs, stuck jobs, health, log-shape, env knobs. |
| `docs/ecs-migration/` | Active migration plan (Postgres + ECS + Cognito). Read 00-overview.md first.            |
| `docs/archive/`       | Historical migration plans — context only, not current state.                           |

If a question is covered there, read the doc rather than re-deriving from code.

## Tech stack (anchors for navigation)

- Next.js 16 App Router + React 19 + TypeScript strict, Turbopack default.
- Tailwind v4 + shadcn/ui (Radix base) — `components.json` configures the generator.
- **Postgres + Drizzle ORM** for data; **Auth.js v5** (NextAuth) with the Drizzle adapter for auth (database sessions). Local Postgres via the repo-root `docker-compose.yml`.
- **Realtime**: app-owned SSE backed by Postgres `LISTEN/NOTIFY`. The runner emits NOTIFY after each commit; SSE handlers `LISTEN` per subscription.
- Review runner runs **in-process inside Next.js** — no separate worker. Fire-and-forget from the API route, AbortController registry for cancel.
- Vitest + Testing Library, ESLint + Prettier, GitHub Actions CI on PR (`format:check`, `lint`, `typecheck`, `test`).

## Repo layout

```
src/
  app/                         App Router pages + route handlers
    api/
      auth/[...nextauth]       Auth.js v5 catch-all (signin/callback/signout/session)
      github/repos, github/file
      health                   Public ops endpoint
      jobs/route.ts            POST creates row, fires runner in-process
      jobs/[id]/cancel
      jobs/[id]/rerun
      jobs/[id]/stream         Per-job SSE (LISTEN/NOTIFY)
      me/notifications         Per-user terminal SSE
    jobs/[id]                  Live streaming view
    reviews/[id]               Final narrative reader
    history, login, denied, relink
  proxy.ts                     Next 16 middleware (renamed). Auth.js session + Drizzle allowlist gate.
  components/                  home, narrative, notifications, theme, topbar, ui
  hooks/                       use-toast.ts
  lib/
    auth/                      Auth.js v5 config (auth.ts) + Drizzle allowlist gate
    db/                        Drizzle schema (schema.ts) + pg.Pool / Drizzle handle (client.ts)
    github/                    Octokit factory, accounts-table token reader, fetcher, view-time helpers
    jobs/                      concurrency, target schema, start-review, partial-narrative-parse
    jobs/runner/               In-process review runner: clone/, executor/ (claude + stub), prompt/, registry, run.ts, writes.ts (Drizzle + NOTIFY), shutdown.ts, github.ts
    narrative/                 inline-diff-snippets, language-map
    log.ts                     pino logger (job_id / executor child loggers)

packages/
  github-client/               Octokit wrapper used by API routes (workspace package)
  review-types/                Shared NarrativeReview shape (chapters + insights + diffChunks)

drizzle/                       Generated SQL migrations + migrate.mts (compiled to migrate.mjs at Docker build)
docker-compose.yml             Local Postgres + web service. Two flows: full Docker, or postgres-only + host npm dev.
Dockerfile                     Multi-stage build (deps → build → runtime) for the web container, pinned linux/amd64
.dockerignore                  Excludes node_modules, .next, .env*, docs, .github, etc.
drizzle.config.ts              drizzle-kit config (schema → drizzle/)
instrumentation.ts             Next 16 boot hook: SIGTERM handler. (Recovery moved to scripts/recover-jobs.cjs.)
next-auth.d.ts                 Type augmentation: Session.user gains githubLogin + id
scripts/                       db-seed.ts (allowlist seeder), recover-jobs.cjs (orphan-job flip), entrypoint.sh (Docker)
terraform/                     AWS infra. Two root modules:
  bootstrap.sh                 Creates S3 state bucket + DynamoDB lock table (idempotent, run once per AWS account)
  platform/                    Shared infra: VPC, ECS cluster, ALB+listener, Cognito user pool, Route 53 zone, wildcard ACM cert, GitHub OIDC provider, ECR repos. One apply per AWS account.
  apps/enhanced-review/        Per-app: ECS task+service, EFS, listener rule, Cognito client, Route 53 record, secrets, scoped IAM, log group, SGs. Reads platform via terraform_remote_state.
docs/                          README, RUNNING, OPERATIONS, ecs-migration/, archive/
test/                          server-only.shim.ts (Vitest alias for next/server-only)
.github/workflows/
  ci.yml                       Format / lint / typecheck / test + docker-build verification on PR + push to main; exposes workflow_call so deploy-image.yml can reuse it
  deploy-image.yml             Push-to-main image CD: build + push to ECR, live-fetch task-def, register revision, UpdateService. OIDC role: enhanced-review-github-image-deploy
  deploy-infra.yml             Plan-on-PR / apply-on-merge for both terraform/ modules. Production-environment-gated apply. OIDC role: enhanced-review-github-tf
```

## How the system fits together

- **Auth**: GitHub OAuth via Auth.js v5 (server-side flow at `/api/auth/signin/github`). The Drizzle adapter persists `users` / `accounts` / `sessions` / `verification_tokens`. The GitHub access token lives in `accounts.access_token`; reads go through `getGithubTokenFor(userId)`. Session strategy is `database`, not JWT.
- **Allowlist gate**: Two layers. (1) Auth.js `signIn` callback in `src/lib/auth/auth.ts` refuses the OAuth handshake when the GitHub login isn't in `allowed_users`. (2) `src/proxy.ts` middleware re-checks every request (defense-in-depth). Public exits: `/api/auth/*`, `/api/health`, `/login`, `/denied`.
- **Job lifecycle**: `POST /api/jobs` → `auth()` → resolve head SHA via Octokit → transactional concurrency-check + `db.insert(reviewJobs)` → register `AbortController` in `src/lib/jobs/runner/registry.ts` → fire `runJob(...)` (no await) → return `{ id }`. The route arms a `setTimeout(REVIEW_TIMEOUT_MIN)` that writes `status=error` + emits NOTIFYs and aborts.
- **Runner** (`src/lib/jobs/runner/run.ts`): parse target → fetch PR metadata if PR → shallow clone (`git clone --depth=1`) → list changed files → build `PrData` → executor (`claude` via the Claude Agent SDK, or `stub`) streams chunks → each chunk goes through `insertChunk` (Drizzle + NOTIFY, idempotent on `(jobId, seq)`) fire-and-forget → drain in-flight before flipping `status=done` → `finally` cleans clone dir + re-applies `cancelled` (skipped when `signal.reason === 'timeout'`).
- **Streaming**: client opens `EventSource('/api/jobs/[id]/stream')`. The handler holds a dedicated `pg.Client` doing `LISTEN job_<id>`, sends an initial snapshot, then forwards `chunk` / `status` / `terminal` events. Drain-before-done means a subscriber that observes `done` already has every chunk.
- **Cancel**: `POST /api/jobs/[id]/cancel` runs `UPDATE review_jobs SET status='cancelled' WHERE id = ? AND user_id = ? AND status IN ('pending','running') RETURNING id` — empty result → 409. On success, signals the registry and emits NOTIFYs.
- **Cross-page notifications**: `JobNotifications` (mounted in root layout when authed) subscribes to `EventSource('/api/me/notifications')`. The handler `LISTEN`s on `user_<userId>:terminal` and forwards each terminal event the runner emits.
- **Boot**: `instrumentation.ts` (Next 16's `register()` hook) installs the SIGTERM handler and runs `recoverInterruptedJobs()` to flip orphan `running` rows to `error` after a crash/deploy.
- **Output shape**: `packages/review-types/src/narrative.ts` — `NarrativeReview` = `prTitle` + `overviewSummary` + `chapters[]` (each with `insights[]` and `diffChunks[]`).

## Postgres tables (see `src/lib/db/schema.ts`)

| Table                 | Notes                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `users`               | Auth.js standard fields + custom `github_login` (unique).                                                         |
| `accounts`            | Auth.js standard. Stores the GitHub access token in `access_token`.                                               |
| `sessions`            | Auth.js standard (database session strategy).                                                                     |
| `verification_tokens` | Auth.js standard (unused for OAuth-only flows but required by the adapter).                                       |
| `allowed_users`       | App-level allowlist. Unique on `github_login`.                                                                    |
| `review_jobs`         | `status` enum {pending, running, done, error, cancelled}. `target` JSONB. Indexes on status, user_id, created_at. |
| `reviews`             | One per completed job (`job_id` unique). `content` JSONB (`NarrativeReview`).                                     |
| `review_chunks`       | Streamed partials. Unique on `(job_id, seq)` — runner relies on this for idempotent chunk inserts.                |

All runner writes use the same connection pool (no separate admin/user split). NOTIFY channels: `job_<id>` (per-job stream) and `user_<userId>:terminal` (per-user terminal).

## Common scripts

| Script                            | What                                                         |
| --------------------------------- | ------------------------------------------------------------ |
| `npm run dev`                     | Next.js dev server (Turbopack) on `localhost:3000`           |
| `npm run build`                   | Production build                                             |
| `npm run lint`                    | ESLint                                                       |
| `npm run typecheck`               | `tsc --noEmit`                                               |
| `npm run format` / `format:check` | Prettier write / check                                       |
| `npm test` / `test:watch`         | Vitest                                                       |
| `npm run db:generate`             | `drizzle-kit generate` (regenerate SQL after schema edits)   |
| `npm run db:migrate`              | Apply pending migrations against `DATABASE_URL`              |
| `npm run db:seed`                 | Insert `SEED_GITHUB_LOGIN` into `allowed_users` (idempotent) |
| `npm run db:recover`              | Flip orphan `running` jobs to `error` after a host crash     |
| `docker compose up postgres -d`   | Local Postgres on 127.0.0.1:5432                             |
| `docker compose up --build`       | Full stack (postgres + web) — Flow 1 / closest-to-prod       |

## Environment

`.env.example` is the canonical list. Keys you'll see: `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `SEED_GITHUB_LOGIN`, `REVIEW_EXECUTOR` (`stub`|`claude`), `REVIEW_MODEL`, `ANTHROPIC_API_KEY`, `REVIEW_TIMEOUT_MIN`, `MAX_JOBS_PER_USER`, `LOG_LEVEL`, `LOG_PRETTY`. Defaults and meaning are documented in `docs/OPERATIONS.md` (Tunable knobs).

## Conventions worth knowing before editing

- Path alias `@/*` → `src/*` (see `tsconfig.json`). Workspace deps `@enhanced-review/github-client` and `@enhanced-review/review-types` are transpiled by Next (`transpilePackages` in `next.config.ts`) — no build step.
- Server-only modules import `'server-only'` at the top. Vitest aliases this to `test/server-only.shim.ts` so they can be unit-tested. Do not import them from a client component.
- `proxy.ts` is the Next 16 rename of `middleware.ts` — runs on the Node runtime, so the Postgres pool is fine there.
- Drizzle JS field names are camelCase (`headSha`, `createdAt`, `riskScore`); DB columns stay snake_case. The legacy PB-shape view types (`ReviewJobRow` etc. in `src/lib/jobs/types.ts`) are still used by consumers — Drizzle rows go through `toJobRow` / `toChunkRow` / `toReviewRow` adapters at the read sites.
- Use `auth()` for the per-request session; `db` from `@/lib/db/client` for queries (Drizzle); `pool` from the same module for raw `pg_notify` calls. There is no admin-vs-user split — runtime access control lives in route handlers.
- The runner is single-process: ~5 concurrent jobs is the design budget. Don't add cross-process queues without revisiting `docs/README.md`.
- No webhooks, no write-back to GitHub PRs, narrative-only (no Workspace mode). These are intentional cuts vs the diffy POC.

## Deployment

Production runs the same Docker image as local, plus a `postgres:17-alpine` sidecar in the same Fargate task. Two Terraform modules:

- **`terraform/platform/`** — shared infra, applied once per AWS account: VPC, ECS cluster, ALB + listener (default 404 fixed-response), Cognito user pool, Route 53 zone, wildcard ACM cert, GitHub OIDC provider, ECR repos.
- **`terraform/apps/enhanced-review/`** — per-app, applied per app: ECS task + service, EFS, ALB target group + listener rule (host header `enhanced-review.<domain>`, action: `authenticate-cognito + forward`), Cognito user pool client, Route 53 ALIAS record, Secrets Manager entries, scoped IAM, log group, security groups. Reads platform outputs via `terraform_remote_state`.

Bring-up walkthrough in `terraform/README.md`; design in `docs/ecs-migration/06a-platform.md` + `06b-application.md`; commit-by-commit playbooks in `docs/ecs-migration/phase-c-plan.md` (infra) and `docs/ecs-migration/phase-d-plan.md` (CD + cutover). Day-2 ops (kill switch, secret rotation, allowlist via ECS Exec, manual backups) in `docs/ecs-migration/09-cost-and-operations.md`.

CD via GitHub Actions, OIDC, no long-lived keys. `.github/workflows/deploy-image.yml` ships the image on push to `main`; `.github/workflows/deploy-infra.yml` plans Terraform on PR (one comment per module) and applies on merge gated by the `production` environment. Two IAM roles: `enhanced-review-github-image-deploy` (scoped image-deploy perms, in app module) and `enhanced-review-github-tf` (broader infra perms scoped by `enhanced-review-*` / `platform-*` name prefix, in platform module). The image deploy live-fetches the current task definition from ECS — there is no checked-in `task-definition.json`. See [07](docs/ecs-migration/07-cd-image.md) and [08](docs/ecs-migration/08-cd-infra.md).

## Working on Windows

The user runs Windows. `bash` (Git Bash) and `powershell` are both available; the docs and scripts are written to work in either. When you suggest commands to the user, use forward-slash paths and POSIX-friendly syntax (Git Bash).

## Keeping this file up to date

Treat AGENTS.md as a living map. **Update it in the same change that introduces structural drift, then commit the AGENTS.md edit with that change.** Triggers:

- New top-level directory, or a `src/lib/<area>` / `src/app/api/<route>` that didn't exist before.
- A new package under `packages/`.
- A new Postgres table, or a rule/index change on an existing one.
- A new env var, npm script, or executor backend.
- Renames or removals of any of the above.
- A change to the high-level data flow (auth, job lifecycle, streaming, cancel).
- A change to the Terraform module shape — new resource type, renamed output, new app under `terraform/apps/`, new platform-level concept.
- A change to how secrets are wired (which secrets exist, which container reads them).

Pure refactors inside an already-named area (e.g. splitting `run.ts` into helpers under the same dir) do **not** require an AGENTS.md update — the directory entry still describes the area accurately.

When you do update it, also commit it. After making changes in this repo:

1. If `AGENTS.md` itself is part of the diff, include it in the same commit as the code change that triggered it (one commit, one logical change). Do not split it into a separate "docs" commit.
2. If you're touching the repo and notice AGENTS.md is stale relative to current state (a directory referenced no longer exists, an env var was renamed, etc.), fix it in your next commit on the branch — don't leave a known-stale map for the next agent.
3. Commit message convention: follow whatever style `git log -n 5` shows. Keep AGENTS.md updates terse — one line in the body is plenty (e.g. `Refresh AGENTS.md repo layout for new src/lib/foo`).
4. Don't push without explicit user approval. Local commits are fine; remote-visible actions are not.
