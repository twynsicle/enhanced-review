# Phase 3 — Domain port

**Goal:** everything that makes a review exist — GitHub access, clone + diff,
prompt, executors, the in-process runner, and the job lifecycle
(create / cancel / rerun / timeout / recovery / shutdown) — lives in
`src/domain/*` on top of Prisma repositories, with the legacy unit tests
ported and a stub review running end to end from an integration test. No page
or resource route is ported (Phase 4); the only web-visible change is
`/api/health` regaining its queue snapshot.

Parent: [00-overview.md](./00-overview.md) — D3, D5, D6, D8, D9, D10, D12;
A4, A10, A12.

Builds on: [phase-2-plan.md](./phase-2-plan.md) (P2-D2 schema, P2-D7/P2-D8
generated client + native jobs, P2-D9 env defaults, P2-D10 "repositories next
to their first caller").

---

## Phase-level decisions

| #      | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P3-D1  | **All GitHub traffic goes through one `@octokit/core` instance per request.** `@octokit/core` ships `request` (typed REST routes) and `graphql` together, so it replaces the `octokit` meta-package (eleven transitive packages: apps, webhooks, OAuth) with one. Legacy split calls between Octokit (repos, pulls, branches, head-SHA resolution) and hand-rolled `fetch` (runner metadata, view-time helpers); this phase routes every call through the same instance so there is one place that sets `Authorization`, the user agent and the API version, and one error classification (`RequestError.status`: 401 → `GithubAuthError`, 403 with `x-ratelimit-remaining: 0` → rate-limited, 404, 429). Endpoint functions take the `Octokit` instance as their first argument, so tests pass a fake `{ request, graphql }` exactly as the legacy `github-client` tests did. Responses are narrowed with Zod where the typed route does not already pin the shape (GraphQL).                                                                         |
| P3-D2  | **Status transitions are conditional updates in the repository.** `markRunning` flips only `pending → running`, `finalizeDone` only `running → done` (review insert + status flip in one transaction), `markErrored` only `pending\|running → error`, `cancel` only `pending\|running → cancelled` **and** `user_id = viewer`. Each returns whether a row changed. The runner stops when `markRunning` reports no change (already cancelled), which closes the legacy "cancel raced markRunning" window instead of patching it in `finally`. Cancel's 409 still conflates wrong-owner with wrong-status on purpose (does not leak ownership).                                                                                                                                                                                                                                                                                                                                                                                                          |
| P3-D3  | **Domain layout (D9), concretely.** `domain/github/` — client, repos, pulls, branches, resolve-target, pull-metadata, view-time. `domain/review/` — clone (git runner, clone-and-diff, changed files), prompt (file filter, hunk catalog, narrative prompt, parse), executor (types, stub, claude), `run.ts`. `domain/jobs/` — registry, timeout, `start-review.ts` (create + rerun share it), `cancel-job.ts`, `recover-jobs.ts`, `errors.ts`. `packages/` and `lib/jobs/runner/writes.ts` disappear; writes go through `src/db`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| P3-D4  | **`domain` is shared between server and browser; `*.server.ts` marks the server-only parts.** This replaces A12's "domain is server-only by construction". A domain module that imports `db`, `config`, the logger, a `node:` builtin, a server-only package (`@octokit/core`, `@anthropic-ai/claude-agent-sdk`) or another `.server` module **must** be named `*.server.ts`; the layering guardrail enforces this, and browser-bound `web` modules may import any domain module that is not `.server`. Rule of thumb in AGENTS.md: name it `.server.ts` unless the browser is meant to import it. Consequences: the narrative types, `ReviewTarget` (+ Zod schema + `describeTarget`), `detectLanguage`, `extractChapterTitles` and `buildInlineDiffSnippets` live in `src/domain/review/` as plain `.ts`; the runner, clone, executors and every `domain/jobs` module are `.server.ts`; Phase 2's `domain/auth/{allowlist,sign-in,github-profile}.ts` are renamed to `.server.ts` in commit 1 (their importers in `src/web/auth` and routes follow). |
| P3-D5  | **`process.env` stays behind `src/config`.** The git runner spawns with the host environment and the Claude executor forwards an allowlist of keys to the SDK subprocess; both used to read `process.env` directly. `src/config/host-env.ts` exports `hostEnv()` (a snapshot) and `pickHostEnv(keys)` so the env-access guardrail holds. New keys in `env.ts` + `.env.example`: `REVIEW_EXECUTOR` (`stub\|claude`, default `claude`), `REVIEW_MODEL` (default `claude-haiku-4-5`), `REVIEW_TIMEOUT_MIN` (int ≥ 1, default 15), `MAX_JOBS_PER_USER` (int ≥ 1, default 1), `ANTHROPIC_API_KEY` (optional; the SDK also accepts `CLAUDE_CODE_OAUTH_TOKEN`, so not enforced).                                                                                                                                                                                                                                                                                                                                                                              |
| P3-D6  | **Orphan recovery runs from the `recover-jobs` one-shot (D8) _and_ at server boot.** `domain/jobs/recover-jobs.ts` flips every `pending\|running` row to `error` with `error_message = "interrupted: server restarted"` and `completed_at = now`. Because the server is a single process, nothing can legitimately be in flight when it starts, so the web server calls the same function once on boot (inside the Vite-loaded graph, from `entry.server.tsx`), which makes `npm run dev` restarts self-healing. The one-shot remains for the container entrypoint ordering (migrate → seed → recover → web, Phase 5) and for ops.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| P3-D7  | **The registry owns shutdown, on `globalThis`.** `domain/jobs/registry.ts` keeps the `AbortController` map on a `globalThis` slot (like the Prisma singleton) so Vite HMR module re-evaluation in dev does not orphan controllers, and registers its own `SIGTERM`/`SIGINT` handler that aborts every in-flight job with reason `shutdown`. `server/index.ts` cannot do this: under Vite the server graph is a separate module instance from anything Node imports natively, so a natively imported registry would always be empty. The runner writes `error: "interrupted: server shutdown"` best-effort; whatever does not land is caught by P3-D6 at the next boot.                                                                                                                                                                                                                                                                                                                                                                                 |
| P3-D8  | **Timeout is a job-level `setTimeout`, as today.** `domain/jobs/timeout.ts` arms `REVIEW_TIMEOUT_MIN` minutes, marks the row `error: "timeout: job exceeded N min"` (conditional, P3-D2) and then aborts with reason `timeout`. The runner's abort handling distinguishes `cancel` (viewer) → `cancelled`, `timeout` → already `error`, `shutdown` → `error` (P3-D7).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| P3-D9  | **Concurrency cap semantics unchanged.** `findInFlightJob(userId, cap)` is a count-then-insert check inside `startReview`, non-atomic, as on `main` (closed beta, one human clicking). The knob stays `MAX_JOBS_PER_USER`. A partial unique index would make it atomic only for cap = 1 and is not worth a second migration now; recorded as a known window in OPERATIONS.md (Phase 6).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| P3-D10 | **The runner is dependency-injected so the stub review runs end to end from an integration test without GitHub.** `runJob(input, deps)` takes `{ executor, git, cloneUrlFor, getPullMetadata }` with production defaults. The integration test builds a real local git repository (two commits, one changed file) with the host `git`, passes `cloneUrlFor: () => 'file://<path>'`, and asserts the job ends `done` with `review_chunks` (seq starting at **0**) and a `reviews` row carrying `files` and `risk_score`. Postgres-unreachable → skipped like every other integration file. `git` is already in the Dockerfile and on CI runners.                                                                                                                                                                                                                                                                                                                                                                                                        |
| P3-D11 | **Health regains the queue snapshot (A10).** `/api/health` adds `queueDepth`, `oldestPendingAgeSec`, `errorsLast24h` from three repository counts alongside Phase 2's `db`; still always 200, nulls on query failure. `src/web/routes/health.ts` is the only route touched this phase.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| P3-D12 | **Legacy `github_login` on jobs is gone; lists join `users`.** History, Recent and the `/jobs/:id` header read `user.githubLogin` via a Prisma `include` (`select: { githubLogin: true }`) — the repository returns a flat `ReviewJobRow` with `githubLogin` so Phase 4 pages never see the join.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

---

## Target state after Phase 3

```
src/
├── config/
│   ├── env.ts                      + REVIEW_EXECUTOR, REVIEW_MODEL, REVIEW_TIMEOUT_MIN, MAX_JOBS_PER_USER, ANTHROPIC_API_KEY
│   └── host-env.ts                 hostEnv(), pickHostEnv(keys)  (P3-D5)
├── db/
│   ├── review-jobs.ts              create, findById, findInFlight, list (history/recent/activity), terminalSince,
│   │                               markRunning, finalizeDone (tx), markErrored, cancel, recoverOrphans, health counts
│   ├── reviews.ts                  findByJobId   (create happens inside finalizeDone)
│   ├── review-chunks.ts            insert, listAfter(jobId, afterSeq)
│   └── *.integration.test.ts
├── domain/
│   ├── auth/                       allowlist.server.ts, sign-in.server.ts, github-profile.server.ts  (renamed, P3-D4)
│   ├── github/                     every module .server.ts (token handling)
│   │   ├── client.server.ts        createOctokit(token), GithubAuthError, isAuthError, classifyRequestError
│   │   ├── repos.server.ts         listRepos(octokit)             GET /user/repos
│   │   ├── pulls.server.ts         listOpenPulls(octokit, o, r)   GET /repos/{o}/{r}/pulls
│   │   ├── branches.server.ts      listRecentBranches(octokit, o, r)  GraphQL, 30-day window, sorted locally
│   │   ├── resolve-target.server.ts resolveFreshReviewTarget(octokit, target)  fresh head/base SHAs + PR title
│   │   ├── pull-metadata.server.ts getPullMetadata(octokit, …)   one function for runner (title/body/author) and reader
│   │   ├── view-time.server.ts     getFileAtRef, getBranchHead, getPullReviewers, getCommitsAhead
│   │   ├── types.ts                RepoSummary, PullSummary, BranchSummary, PullMetadata, … (browser-safe)
│   │   └── *.test.ts               fake { request, graphql }
│   ├── review/
│   │   ├── narrative.ts            NarrativeReview + Insight/DiffChunk/RiskAssessment types, SUMMARY_SECTION_ID  (shared)
│   │   ├── target.ts               ReviewTarget, ReviewTargetSchema (Zod), describeTarget()                     (shared)
│   │   ├── language-map.ts         detectLanguage()                                                             (shared)
│   │   ├── partial-narrative-parse.ts  extractChapterTitles()   live-view checklist                             (shared)
│   │   ├── inline-diff-snippets.ts buildInlineDiffSnippets, groupSelectedHunks, formatSelectedHunkLabel         (shared)
│   │   ├── clone/
│   │   │   ├── git-runner.server.ts   spawn git, non-interactive env, abort → SIGTERM
│   │   │   ├── clone-runner.server.ts init + fetch head + verify SHA + fetch base + diff; cleanupWorkDir
│   │   │   └── diff-files.server.ts   listChangedFiles / mergeFileLists
│   │   ├── prompt/
│   │   │   ├── ai-file-filter.ts      isExcludedFromAI                (pure)
│   │   │   ├── diff-hunk-catalog.ts   buildDiffHunkIndex              (pure)
│   │   │   ├── narrative-prompt.ts    buildNarrativePrompt (truncation, catalog)  (pure)
│   │   │   └── parse-narrative.ts     parseNarrativeReview + risk sanitising      (pure)
│   │   ├── executor/
│   │   │   ├── types.ts               ReviewExecutor, Input/Output, ExecutorParseError, ExecutorProcessError
│   │   │   ├── stub-executor.server.ts   STUB_REVIEW streamed in fragments
│   │   │   └── claude-executor.server.ts Claude Agent SDK query(), read-only tools, sandbox, no settings
│   │   ├── run.server.ts           runJob(input, deps): markRunning → metadata → clone → files → executor → finalize
│   │   └── *.test.ts, run.integration.test.ts
│   └── jobs/                       every module .server.ts (db access)
│       ├── registry.server.ts      register/signal/unregister/abortAll on globalThis; SIGTERM/SIGINT hook (P3-D7)
│       ├── timeout.server.ts       armTimeout(jobId, controller)
│       ├── start-review.server.ts  startReview({ user, token, target }) and rerunJob({ user, token, sourceJobId })
│       ├── cancel-job.server.ts    cancelJob({ jobId, userId }) → 'cancelled' | 'not-cancellable'
│       ├── recover-jobs.server.ts  recoverOrphanedJobs() → count
│       ├── errors.ts               JobInFlightError(activeJobId), JobNotFoundError, HeadShaResolutionError
│       └── *.test.ts               repositories + runner mocked
├── guardrails/
│   └── layering.guard.test.ts      + "domain modules touching server-only code are named .server" (P3-D4)
├── jobs/
│   ├── cli.ts                      + 'recover-jobs'
│   └── recover-jobs.ts
└── web/
    ├── entry.server.tsx            + one-time recoverOrphanedJobs() on boot (P3-D6)
    └── routes/health.ts            + queueDepth, oldestPendingAgeSec, errorsLast24h (P3-D11)
```

`legacy/lib/{github,jobs,narrative}`, `legacy/packages/*` and
`legacy/app/api/jobs/**` are fully absorbed after this phase; `legacy/README.md`
marks them ported. The directory itself is deleted at the end of Phase 4.

### Dependencies

Runtime: `@octokit/core` (P3-D1; brings `@octokit/request`, `@octokit/graphql`,
`@octokit/request-error`, `@octokit/types`). `@anthropic-ai/claude-agent-sdk`
is already a dependency (0.2.119, the version `main` used). The `octokit`
meta-package is **not** added.

Dev: none.

### Repository API (`src/db`)

| Module             | Function                                                                      | Notes                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `review-jobs.ts`   | `createJob({ userId, target, headSha })`                                      | `status: 'pending'`; returns `ReviewJobRow`                                                              |
|                    | `findJobById(id)`                                                             | joins `users.githubLogin` (P3-D12)                                                                       |
|                    | `findInFlightJob(userId, cap)`                                                | newest `pending\|running` when count ≥ cap, else null                                                    |
|                    | `listJobs({ status?, limit })`                                                | history page; newest first                                                                               |
|                    | `listRecentJobs(limit)` / `listCreatedSince(date)`                            | Recent card + 14-day sparkline (two separate queries — the Phase 0 "Recent always empty" bug is PB-only) |
|                    | `listTerminalJobsSince(userId, since)`                                        | D6 polling                                                                                               |
|                    | `markRunning(id)`                                                             | `pending → running`, sets `started_at`; returns boolean                                                  |
|                    | `finalizeDone(id, review, { diffTruncated })`                                 | transaction: insert `reviews`, `running → done`, `risk_score`; boolean                                   |
|                    | `markErrored(id, message)`                                                    | `pending\|running → error`, message clipped to 500 chars; boolean                                        |
|                    | `cancelJob(id, userId)`                                                       | `pending\|running` and owner → `cancelled`; boolean                                                      |
|                    | `recoverOrphans(message)`                                                     | every `pending\|running` → `error`; returns count                                                        |
|                    | `countByStatus(status)`, `oldestPendingCreatedAt()`, `countErrorsSince(date)` | health                                                                                                   |
| `reviews.ts`       | `findReviewByJobId(jobId)`                                                    | `content` parsed through `NarrativeReviewSchema` (Zod, lenient) at the boundary                          |
| `review-chunks.ts` | `insertChunk(jobId, seq, content)`, `listChunksAfter(jobId, afterSeq = -1)`   | D5 polling reads `seq > after`                                                                           |

Rows come back as plain objects (`ReviewJobRow`, `ReviewChunkRow`,
`ReviewRow`) with `target` already parsed by `ReviewTargetSchema`; a row whose
JSON fails to parse is logged and treated as not found rather than crashing a
list.

### Job lifecycle (`src/domain/jobs`)

```
startReview / rerunJob
  ├─ findInFlightJob(user, MAX_JOBS_PER_USER)        → JobInFlightError(activeJobId)   [Phase 4: 409]
  ├─ resolveFreshReviewTarget(token, target)        → GithubAuthError                [Phase 4: 401 → /relink]
  │                                                 → HeadShaResolutionError         [Phase 4: 502]
  ├─ createJob(pending)
  ├─ controller = new AbortController(); registry.register(jobId, controller); armTimeout(...)
  └─ runJob(...).finally(clearTimeout, unregister)  fire-and-forget; rejection logged
runJob (domain/review/run.ts)
  ├─ markRunning: false → return (cancelled before start)
  ├─ PR: getPullMetadata; clone + diff; listChangedFiles; branch: git log for author/body
  ├─ executor.run({ onChunk }) — chunk inserts fire-and-forget, seq from 0, drained before finalize
  ├─ finalizeDone(review + files)
  └─ catch: signal.aborted ? (reason cancel → cancelJob already wrote; timeout → already error;
            shutdown → markErrored best-effort) : markErrored(formatJobError(err))
     finally: drain chunks, cleanupWorkDir
cancelJob({ jobId, userId })
  ├─ db.cancelJob(jobId, userId): false → 'not-cancellable'                     [Phase 4: 409]
  └─ registry.signal(jobId, 'cancel') (no-op if not running here)
recoverOrphanedJobs()  → db.recoverOrphans('interrupted: server restarted')     boot + one-shot
registry SIGTERM/SIGINT → abortAll('shutdown')
```

### Env additions

| Key                  | Rule                                         | `.env.example`                                               |
| -------------------- | -------------------------------------------- | ------------------------------------------------------------ |
| `REVIEW_EXECUTOR`    | `stub \| claude`, default `claude`           | `REVIEW_EXECUTOR=stub` (as on `main`: local default is stub) |
| `REVIEW_MODEL`       | non-empty string, default `claude-haiku-4-5` | commented                                                    |
| `REVIEW_TIMEOUT_MIN` | int ≥ 1, default 15                          | commented                                                    |
| `MAX_JOBS_PER_USER`  | int ≥ 1, default 1                           | commented                                                    |
| `ANTHROPIC_API_KEY`  | optional string                              | commented                                                    |

`vitest.config.ts` gains `REVIEW_EXECUTOR=stub` so no test can reach the SDK
by accident.

### Tests

Ported (same assertions, new imports): `partial-narrative-parse`,
`inline-diff-snippets`, `language-map`, `parse-narrative`, `claude-executor`,
`repos`, `pulls`, `branches`, `errors` (fake Octokit, as before), `view-time`
(rewritten from a `fetch` stub to a fake Octokit; same cases), the rerun route
test (becomes `start-review.test.ts` for both create and rerun), the health
route test (becomes a loader test with the repository mocked).

New unit: `mergeFileLists`, `buildDiffHunkIndex`, `buildNarrativePrompt`
(filtering + truncation flag), `stub-executor` (fragments, abort), `run.test.ts`
with fake deps (done path, cancel-before-start, executor error, abort reasons),
`registry`, `timeout`, `cancel-job`, `recover-jobs`, `host-env`.

New integration: `review-jobs`, `review-chunks`, `reviews` repositories
(transitions return the right booleans, `finalizeDone` is atomic, `seq 0`
round-trips); `run.integration.test.ts` (P3-D10).

Guardrails: `layering` gains the P3-D4 check (a domain module that imports
`db`, `config`, the logger, `node:*`, `@octokit/*`, the Claude SDK or a
`.server` module must itself be `.server`), and its browser-bound check now
allows non-`.server` domain imports. `env-access` is what forces P3-D5.

### Docs touched in this phase

- `AGENTS.md`: layout (config/host-env, db repos, domain github/review/jobs,
  jobs/recover-jobs), the P3-D4 layering rule, "How a review runs" section,
  env table, scripts (`recover-jobs`).
- `docs/RUNNING.md` interim block: `REVIEW_EXECUTOR=stub`, `npm run job -- recover-jobs`.
- `legacy/README.md`: rows for `lib/github`, `lib/jobs`, `lib/narrative`,
  `packages/*` marked ported.
- `00-overview.md`: status line → "Phases 0–3 complete, Phase 4 next"; A12
  gets a "superseded by P3-D4" note.

---

## Commit series

| #   | Commit                                                                                                                                                                                                                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Shared domain rule + review types + config.** Layering guardrail P3-D4 check, `domain/auth` renames, shared `src/domain/review/{narrative,target,language-map,partial-narrative-parse,inline-diff-snippets}.ts` with ported tests, `src/config/host-env.ts`, env keys + `.env.example` + vitest default. |
| 2   | **Job repositories.** `src/db/{review-jobs,reviews,review-chunks}.ts` with integration tests; health route gains the queue snapshot (P3-D11) with its test.                                                                                                                                                |
| 3   | **domain/github.** `@octokit/core`, `client.server.ts` + endpoint modules + `resolve-target`, `pull-metadata`, `view-time`; ported and rewritten tests.                                                                                                                                                    |
| 4   | **domain/review.** clone, prompt, executors, `run.server.ts`; ported tests + new unit tests + `run.integration.test.ts` (stub end to end against a local git repo).                                                                                                                                        |
| 5   | **domain/jobs + recover-jobs + docs.** registry, timeout, start/rerun, cancel, recovery, boot hook in `entry.server.tsx`, `recover-jobs` one-shot, tests; AGENTS.md, RUNNING interim, legacy/README, overview status.                                                                                      |

Each commit leaves `npm run check` green; commits 2, 4 and 5 also pass
`npm run test:integration` against compose Postgres.

---

## Verification

1. `npm run check` green after every commit; `npm run check:all` green at the
   end with Postgres up, and integration files skip (exit 0) with it down.
2. `run.integration.test.ts`: local git repo → stub executor → job `done`,
   `review_chunks` seq `0..n` present, `reviews.content.files` has the changed
   file, `review_jobs.risk_score = 2` (the stub's score), work dir removed.
3. Cancel path (unit + integration): job cancelled before `markRunning` → the
   runner returns without writing; cancelled mid-executor → `cancelled`, partial
   chunks preserved.
4. Timeout path (unit, fake timers): row flips to `error: "timeout: …"`, signal
   reason `timeout`, runner writes nothing further.
5. `recover-jobs`: insert a `running` row by SQL → `npm run job -- recover-jobs`
   logs `recovered: 1`, row is `error` with the restart message; run again →
   `recovered: 0`. Start `npm run dev` with an orphan present → the boot hook
   flips it (log line) before the first request.
6. Shutdown: start the dev server, start a stub job through a one-off script
   that calls `startReview` (no UI yet), send Ctrl-C → the job row ends `error:
"interrupted: server shutdown"` (or is recovered on next boot), no zombie
   `git` process.
7. `/api/health` → `{ ok, version, db, queueDepth, oldestPendingAgeSec, errorsLast24h }`.
8. Real executor smoke (needs `ANTHROPIC_API_KEY` and a GitHub token): deferred
   to Phase 4's exit criterion, where the UI exists to start one. The
   `claude-executor` unit tests pin the SDK options (`tools`, `allowedTools`,
   `permissionMode: 'dontAsk'`, `settingSources: []`, `persistSession: false`,
   sandbox, no `allowDangerouslySkipPermissions`).
9. `grep -r "pocketbase\|from 'octokit'\|@enhanced-review/" src server` → no hits.
10. Layering guardrail: temporarily add `import { prisma } from '@/db/client'`
    to a plain `.ts` domain module → the guardrail fails naming the file.

## Exit criteria (from the overview, made concrete)

- Stub review runs end to end from an integration test and lands `done` with
  chunks + review row (verification 2).
- `recover-jobs` flips orphans (verification 5).
- Every legacy unit test under `lib/github`, `lib/jobs`, `lib/narrative`,
  `packages/*`, `app/api/jobs`, `app/api/health` has a ported equivalent.
- `npm run check` green; `check:all` green in CI.

## Maintainer actions

None required for this phase. Optional: set `REVIEW_EXECUTOR=stub` in `.env`
now so Phase 4's first UI runs are free.

## Deviations recorded during execution

- **JSON columns are parsed in `domain`, not in the repositories.** The
  layering rule keeps `db` below `domain`, so `review-jobs.ts` / `reviews.ts`
  return `target` and `content` as `unknown`; `domain/jobs/jobs.server.ts`
  (`parseJob`, `parseReview`, `getJob`, `listJobs`, `getReview`) applies
  `ReviewTargetSchema` / `NarrativeReviewSchema`. The runner does the same
  for the stored target on rerun.
- **P3-D7 shutdown, revised.** The registry does not install its own
  SIGTERM/SIGINT handler. It publishes itself on
  `globalThis[Symbol.for('enhanced-review.jobs.registry')]`
  (`JOBS_REGISTRY_KEY`), and `server/index.ts` — outside Vite's module graph,
  hence unable to import the live instance — reaches it by that key:
  `abortAll('shutdown')`, `drain(5000)` so the runners can write their
  "interrupted" status, then `server.close()`. One shutdown path instead of
  two racing handlers.
- **`domain/jobs/boot.server.ts`** wraps the boot-time recovery (P3-D6) in a
  once-per-process guard on `globalThis`, so Vite re-evaluating
  `entry.server.tsx` in development does not error jobs that are running.
  `entry.server.tsx` awaits `bootJobs()` at module top level; it was created
  with `react-router reveal` (the `entry.client.tsx` it also emits was not
  kept) and its `console.error` became a logger call.
- **`runJob` surface.** Besides `{ executor, git, cloneUrlFor,
getPullMetadata }`, deps accept `makeWorkDir?` and `store?` (the four
  repository writes), so the unit tests fake the database without
  `vi.mock`; the function returns an outcome
  (`'done' | 'skipped' | 'aborted' | 'errored'`) that `launchJob` resolves
  with. `defaultRunJobDeps()` does the production wiring and picks the
  executor from `REVIEW_EXECUTOR`. A runner that _rejects_ (a bug, not a
  review failure) is caught by `launchJob`, which marks the job
  `runner crashed: …` so nothing stays `running` forever.
- **`parseNarrativeReview` validates its output with
  `NarrativeReviewSchema`** after the lenient sanitising pass (unknown keys
  are stripped), so `reviews.content` is guaranteed to parse back at read
  time. `ReviewExecutorInput` dropped the unused `filteredDiff` and `target`.
- **`GithubResult` for pull metadata.** The runner's `getPullMetadata` dep
  returns the same `GithubResult<PullMetadata>` the reader uses; a failure
  becomes `PullMetadataError` → `github: …` in the job's error message.
- **Stub review copy** no longer says "Phase 4 produces a real AI-generated
  narrative"; it points at `REVIEW_EXECUTOR=claude`.
- **Verified against the SDK (0.2.119):** `Options.env`, `sandbox`,
  `settingSources`, `persistSession`, `abortController`, `maxTurns` all
  exist; the executor test pins them.
- **`git-runner.server.test.ts` shells out to the host `git`** (`--version`,
  an unknown subcommand) in the unit project; git is on every dev machine,
  CI runner and in the image.
- **Verification 8 (real Claude executor smoke) was not run** — it needs
  `ANTHROPIC_API_KEY` and a GitHub token; the unit tests pin the SDK options.
