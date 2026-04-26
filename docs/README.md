# enhanced-review — Plan of Record

A web-based AI code-review tool. Successor to the `diffy` Electron POC, narrowed to the narrative-review experience and re-platformed for multi-user use.

For getting it running locally see the top-level [README.md](../README.md). For operating a running deployment (allowlist mgmt, key rotation, log tailing, re-queueing stuck jobs, retention SQL) see [OPERATIONS.md](OPERATIONS.md).

## Decisions

### Identity & access

- **Auth**: GitHub OAuth SSO via Supabase Auth.
- **GitHub access**: per-user OAuth tokens (no GitHub App).
- **Tenancy**: multi-user, **invite-only closed beta**. Allowlist is a Supabase table of GitHub usernames; OAuth login is rejected if username is not present.
- **Visibility**: every beta member can see every other member's reviews (shared workspace).

### Feature scope

- Narrative review only — the Workspace (staged/unstaged diff browser) mode is dropped.
- Browse-your-repos picker → pick a PR or branch → click Review.
- Manual triggers only (no webhooks).
- Reviews live in the webapp; no write-back to the GitHub PR.

### Execution

- Async jobs with streamed updates; **Postgres-backed queue** in Supabase (`review_jobs` table).
- **Separate worker container** owns the opencode subprocess. The frontend/API never invokes opencode directly — modular so a Claude-Code-SDK worker can replace it later.
- **Streaming** via Supabase Realtime on Postgres changes (`review_chunks` table).
- **Re-run semantics**: every review pins to a commit SHA; UI shows a "PR has new commits since this review" staleness badge when HEAD has moved.
- **Cancellation**: user can abort a running review; worker kills the opencode subprocess.

### Repo handling

- **Shallow clone per review** (`git clone --depth=1`), deleted after.
- File-filter pre-curates which files opencode is allowed to read (see Phase 4).
- opencode runs **agentically** with `cwd` set to the clone.

### AI model

- opencode CLI invoking GLM 5.1 via opencode-zen.
- Single backend env var for the opencode-zen API key (operator-paid, not per-user).

### Output format

- Same shape as the POC's narrative: chapters + insights + inline diff chunks.
- Stored in Postgres; full per-user history; re-runnable.

## Tech stack

- **Frontend**: Next.js (App Router) + React + TypeScript.
- **Backend (API)**: Next.js Route Handlers / Server Actions.
- **DB / Auth / Realtime**: self-hosted Supabase via `docker-compose`.
- **Worker**: separate container; Node + TypeScript; spawns `opencode` CLI as a subprocess.
- **Deployment target**: any host that runs `docker-compose` (worry about hosting later).

## Phase order

Each phase ends in something demoable. Don't start a phase until the previous one is shipped.

1. [Phase 1 — Foundation: infra + auth shell](PHASE-1-foundation.md)
2. [Phase 2 — Repo & target picker](PHASE-2-repo-picker.md)
3. [Phase 3 — Review job lifecycle (stub worker)](PHASE-3-job-lifecycle-stub.md)
4. [Phase 4 — Worker: real repo + real opencode](PHASE-4-worker-opencode.md)
5. [Phase 5 — Streaming output end-to-end](PHASE-5-streaming.md)
6. [Phase 6 — Review reader UI](PHASE-6-review-reader-ui.md)
7. [Phase 7 — Polish](PHASE-7-polish.md)

## Cross-cutting concerns (handled inside phases, not as separate phases)

- **RLS policies** — sketched in Phase 1, fleshed out in Phase 3 when the review tables land.
- **OAuth token refresh** — handled in Phase 2 when GitHub API calls begin; revisited in Phase 4 for git-clone auth.
- **Diff viewer component** — built in Phase 6 alongside the chapter UI.
