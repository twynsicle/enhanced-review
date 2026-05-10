# enhanced-review — architecture overview

A web-based AI code-review tool. Successor to the `diffy` Electron POC,
narrowed to the narrative-review experience and re-platformed for
multi-user use.

For local setup see the top-level [README.md](../README.md) and the
detailed [RUNNING.md](RUNNING.md). For day-2 operations on a running
deployment (allowlist mgmt, key rotation, log tailing, re-running stuck
jobs) see [OPERATIONS.md](OPERATIONS.md). For the AWS deployment shape
and CD pipelines see [ecs-migration/](./ecs-migration/) — start with
[00-overview.md](./ecs-migration/00-overview.md).

## Decisions

### Identity & access

- **Auth**: GitHub OAuth via [Auth.js v5](https://authjs.dev) (NextAuth)
  with the Drizzle adapter. Server-side flow at
  `/api/auth/signin/github`. Database session strategy (not JWT).
- **GitHub access**: per-user OAuth tokens persisted in the
  `accounts.access_token` column. Reads go through
  `getGithubTokenFor(userId)` in `src/lib/github/`.
- **Tenancy**: multi-user, **invite-only closed beta**. Allowlist is the
  Postgres `allowed_users` table, gated in two layers: (1) the Auth.js
  `signIn` callback refuses the OAuth handshake when the GitHub login
  isn't allowlisted; (2) `src/proxy.ts` middleware re-checks every
  request as defense-in-depth. OAuth login is rejected and the user is
  redirected to `/denied`.
- **Deployed access**: in production an outer Cognito user pool gates
  the ALB (so the public URL requires a Cognito sign-in) before the
  GitHub OAuth flow runs inside the app. Local dev skips Cognito.
- **Visibility**: every beta member can see every other member's reviews
  (shared workspace).

### Feature scope

- Narrative review only — the Workspace (staged/unstaged diff browser) mode is dropped.
- Browse-your-repos picker → pick a PR or branch → click Review.
- Manual triggers only (no webhooks).
- Reviews live in the webapp; no write-back to the GitHub PR.

### Execution

- Async jobs with streamed updates; row-driven via the Postgres
  `review_jobs` table. The API route fire-and-forgets the runner
  in-process.
- **Review runner runs inside the Next.js process.** No separate worker.
  At the project's scale (10–20 users, ~5 concurrent jobs max) the
  process boundary wasn't paying for itself.
- **Streaming** via app-owned SSE backed by Postgres `LISTEN`/`NOTIFY`.
  The runner emits `pg_notify` after each chunk insert; SSE handlers
  hold a dedicated `pg.Client` doing `LISTEN job_<id>` per subscription.
  Each chunk insert is fire-and-forget; the runner drains in-flight
  promises before flipping `status='done'` so a subscriber that
  observes `done` already sees the full chunk stream.
- **Cross-page notifications** via a per-user channel `user_<userId>:terminal`
  that fires on terminal job state transitions (so the topbar can
  surface "your job finished" anywhere in the app).
- **Re-run semantics**: every review pins to a commit SHA; UI shows a
  "PR has new commits since this review" staleness badge when HEAD has
  moved.
- **Cancellation**: the cancel route updates the row to `status='cancelled'`
  and signals an `AbortController` registered in
  `src/lib/jobs/runner/registry.ts`. The runner propagates the signal
  into the clone process and the SDK iterator so both tear down promptly.
- **Crash recovery**: `instrumentation.ts` runs orphan-job recovery on
  boot — orphaned `running` rows after a crash/deploy flip to `error`.
  Same script (`scripts/recover-jobs.cjs`) is also available as
  `npm run db:recover`.

### Repo handling

- **Shallow clone per review** (`git clone --depth=1`), deleted after.
- File-filter pre-curates which files appear in the diff sent to the model.
- Claude runs **agentically** with `cwd` set to the clone and read-only
  tools (`Read`, `Glob`, `Grep`) so it can pull surrounding context.

### AI model

- Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) calling Anthropic's
  Claude models in-process — no external CLI binary required.
- Single backend env var (`ANTHROPIC_API_KEY`) for the Anthropic key
  (operator-paid, not per-user). In production the key is sourced from
  AWS Secrets Manager and injected as a task env var.

### Output format

- Same shape as the POC's narrative: chapters + insights + inline diff chunks.
- Stored in Postgres (`reviews.content` JSONB); full per-user history;
  re-runnable.

## Tech stack

- **Frontend**: Next.js 16 (App Router) + React 19 + TypeScript + Tailwind v4 + shadcn/ui (Radix base).
- **Backend (API)**: Next.js Route Handlers + Server Actions.
- **DB**: Postgres 17 + [Drizzle ORM](https://orm.drizzle.team) +
  drizzle-kit migrations. Local Postgres via repo-root
  `docker-compose.yml`; production Postgres as a sidecar container in
  the same ECS task with EFS-backed storage.
- **Auth**: Auth.js v5 (NextAuth) with the Drizzle adapter; database
  session strategy.
- **Realtime**: app-owned SSE backed by Postgres `LISTEN`/`NOTIFY`.
- **Review runner**: in-process inside Next.js; uses
  `@anthropic-ai/claude-agent-sdk`'s `query()` iterator directly — no
  subprocess.
- **Deployment**: AWS ECS Fargate, single task with two containers
  (Next.js web + Postgres sidecar), EFS-backed Postgres data, ALB +
  Cognito user pool gate, Route 53 + ACM for TLS, Secrets Manager for
  secrets, GitHub OIDC for CD without long-lived AWS keys.
  Infrastructure-as-code in `terraform/` (split into `platform/` and
  `apps/enhanced-review/`).

## Repo layout

| Path                              | Purpose                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/app/`                        | Next.js App Router pages and route handlers (incl. `api/auth/[...nextauth]`, `api/jobs/[id]/stream`)         |
| `src/proxy.ts`                    | Next 16 middleware (renamed). Auth.js session check + Drizzle allowlist gate                                 |
| `src/lib/auth/`                   | Auth.js v5 config and the `signIn` allowlist callback                                                        |
| `src/lib/db/`                     | Drizzle schema (`schema.ts`) and `pg.Pool` / Drizzle handle (`client.ts`)                                    |
| `src/lib/github/`                 | Octokit factory, accounts-table token reader, fetcher                                                        |
| `src/lib/jobs/runner/`            | The in-process review runner (clone, executor, prompt, writes, registry, shutdown)                           |
| `packages/github-client/`         | Octokit wrapper used by API routes (workspace package)                                                       |
| `packages/review-types/`          | Shared `NarrativeReview` shape                                                                               |
| `drizzle/`                        | drizzle-kit-generated SQL migrations + `migrate.mts` (compiled to `migrate.mjs` in the Docker build)         |
| `scripts/`                        | `db-seed.ts` (allowlist seed), `recover-jobs.cjs` (orphan-job recovery), `entrypoint.sh` (container start)   |
| `docker-compose.yml`              | Local Postgres + optional web service. Two flows: full Docker, or postgres-only + host `npm run dev`         |
| `Dockerfile`                      | Multi-stage build (deps → build → runtime) for the web container, pinned `linux/amd64`                       |
| `terraform/platform/`             | Shared infra: VPC, ECS cluster, ALB, Cognito user pool, Route 53 zone, ACM cert, ECR, GitHub OIDC            |
| `terraform/apps/enhanced-review/` | Per-app: ECS task + service, EFS, listener rule, Cognito client, Route 53 record, secrets, scoped IAM        |
| `.github/workflows/`              | `ci.yml` (PR gate), `deploy-image.yml` (push-to-main image CD), `deploy-infra.yml` (Terraform plan/apply CD) |
| `docs/ecs-migration/`             | Active migration plan + cost/ops + proposal docs. Start at `00-overview.md`                                  |
| `docs/archive/`                   | Historical migration plans kept for context                                                                  |
