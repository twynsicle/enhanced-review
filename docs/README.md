# enhanced-review — architecture overview

A web-based AI code-review tool. Successor to the `diffy` Electron POC,
narrowed to the narrative-review experience and re-platformed for
multi-user use.

For local setup see the top-level [README.md](../README.md) and the
detailed [RUNNING.md](RUNNING.md). For day-2 operations on a running
deployment (allowlist mgmt, key rotation, log tailing, re-running stuck
jobs) see [OPERATIONS.md](OPERATIONS.md).

## Decisions

### Identity & access

- **Auth**: GitHub OAuth SSO via PocketBase Auth (popup-based).
- **GitHub access**: per-user OAuth tokens, mirrored from PB's `meta.accessToken`
  into an HttpOnly `gh_access_token` cookie. The token is never persisted
  in the database — it lives only in the cookie and in memory during a job.
- **Tenancy**: multi-user, **invite-only closed beta**. Allowlist is the
  PB `allowed_users` collection (server-only rules; only a superuser can
  read it). OAuth login is rejected by middleware if the GitHub login is
  not present.
- **Visibility**: every beta member can see every other member's reviews
  (shared workspace).

### Feature scope

- Narrative review only — the Workspace (staged/unstaged diff browser) mode is dropped.
- Browse-your-repos picker → pick a PR or branch → click Review.
- Manual triggers only (no webhooks).
- Reviews live in the webapp; no write-back to the GitHub PR.

### Execution

- Async jobs with streamed updates; row-driven via PB `review_jobs`
  collection. No queue, no `LISTEN`/`NOTIFY` — the API route
  fire-and-forgets the runner in-process.
- **Review runner runs inside the Next.js process.** No separate worker.
  At the project's scale (10–20 users, ~5 concurrent jobs max) the
  process boundary wasn't paying for itself.
- **Streaming** via PocketBase realtime SSE on `review_chunks` inserts.
  Each chunk insert is fire-and-forget; the runner drains in-flight
  promises before flipping `status='done'` so a subscriber that observes
  `done` already sees the full chunk stream.
- **Re-run semantics**: every review pins to a commit SHA; UI shows a
  "PR has new commits since this review" staleness badge when HEAD has
  moved.
- **Cancellation**: the cancel route updates the row to `status='cancelled'`
  and signals an `AbortController` registered in
  `src/lib/jobs/runner/registry.ts`. The runner propagates the signal
  into clone + executor so subprocesses tear down promptly.

### Repo handling

- **Shallow clone per review** (`git clone --depth=1`), deleted after.
- File-filter pre-curates which files appear in the diff sent to the model.
- Claude runs **agentically** with `cwd` set to the clone and read-only
  tools (`Read`, `Glob`, `Grep`) so it can pull surrounding context.

### AI model

- Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) calling Anthropic's
  Claude models in-process — no external CLI binary required.
- Single backend env var (`ANTHROPIC_API_KEY`) for the Anthropic key
  (operator-paid, not per-user).

### Output format

- Same shape as the POC's narrative: chapters + insights + inline diff chunks.
- Stored in PocketBase; full per-user history; re-runnable.

## Tech stack

- **Frontend**: Next.js 16 (App Router) + React 19 + TypeScript.
- **Backend (API)**: Next.js Route Handlers / Server Actions.
- **DB / Auth / Realtime**: PocketBase (single binary, SQLite-backed).
- **Review runner**: in-process inside Next.js; uses `@anthropic-ai/claude-agent-sdk`'s `query()` (which the SDK runs as a managed Node subprocess).
- **Deployment target**: AWS-friendly (PB on a Fargate task with EFS for
  `pb_data/`, Next.js on another Fargate task) but local-first today.

## Repo layout

| Path                      | Purpose                                                                  |
| ------------------------- | ------------------------------------------------------------------------ |
| `src/app/`                | Next.js App Router pages and route handlers                              |
| `src/lib/pb/`             | PocketBase client factories: `pbBrowser`, `pbServer`, `pbAdmin`          |
| `src/lib/jobs/runner/`    | The in-process review runner (clone, executor, prompt, writes, registry) |
| `src/lib/auth/`           | Allowlist gate                                                           |
| `src/lib/github/`         | GitHub token + API helpers                                               |
| `packages/github-client/` | Octokit wrapper used by API routes                                       |
| `packages/review-types/`  | Shared `NarrativeReview` shape                                           |
| `pb_migrations/`          | PocketBase JSVM migrations (auto-applied on PB startup)                  |
| `tools/pocketbase/`       | The PB binary (gitignored; downloaded by `npm run pb:install`)           |
| `pb_data/`                | PB's SQLite DB and settings (gitignored)                                 |
| `docs/archive/`           | Historical migration plans kept for context                              |
