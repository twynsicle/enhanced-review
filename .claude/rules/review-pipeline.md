---
paths:
  - 'src/domain/**'
  - 'src/jobs/**'
  - 'src/db/review-jobs.ts'
  - 'src/db/reviews.ts'
  - 'src/db/review-chunks.ts'
  - 'server/index.ts'
---

# `src/domain/` and how a review runs

Loaded when you open a domain, jobs or review-repository file. `domain` is
shared between server and browser; `*.server.ts` marks the server-only modules
(the rule is in `AGENTS.md` under Layering).

```
src/domain/
  auth/              github-profile.server.ts (GET /user, Zod), sign-in.server.ts (upsert user)
  github/            all *.server.ts on one @octokit/core instance per request: client (createOctokit, GithubAuthError,
                     classifyGithubError, toResult), repos, pulls, branches (GraphQL), resolve-target (re-pin SHAs),
                     pull-metadata (runner), view-time (getFileAtRef, getBranchHead, getCommitsAhead); types.ts shared
  review/            shared: narrative.ts (NarrativeReview Zod schema + types; chapter.diagram? + overviewDiagram?;
                     ProseSchema — overviewSummary and chapter.description are a `{ lede, body? }`, the lede one
                     short sentence and the body Markdown, because one free-text field is what produced the
                     50-word sentences this replaced; Insight.filename? — the file an insight is about, drawn on
                     that diff card rather than above all of them;
                     ReviewFile.skipped? — why a changed file was left out: generated, vendored, built-in, binary;
                     ReviewFile.hunks? — the file's share of the hunk catalog, so a stored review knows what was
                     reviewable and not only what was cited; SUMMARY_SECTION_ID / RISK_SECTION_ID /
                     UNDISCUSSED_SECTION_ID, the reader's synthesised sections),
                     coverage.ts (the backstop for the instruction that the model cite every hunk: withFileHunks
                     attaches the catalog to the files — the local CLI at parse, the hosted runner at finalize;
                     reviewCoverage subtracts what the chapters cite, per hunk, and returns `uncited`, one
                     FileCoverage per file with leftovers (its own DiffChunk on it), plus byFile, chaptersCiting,
                     citedChunk (every chapter's hunks for one file merged into a single chunk, deduplicated and in
                     file order, so the file view draws one diff rather than one per citing chapter) and
                     describeCoverageGap, the one sentence the CLI and the reader's card share; a file
                     without a catalog reports nothing),
                     diagram.ts (Diagram Zod schema — 4 kinds over 2 structures: architecture/state/beforeAfter share one
                     node/edge graph, sequence is its own; per-node/edge change marks, optional file+hunk grounding,
                     DIAGRAM_LIMITS, hasUniformChange), target.ts (ReviewTarget schema, describeTarget),
                     review-meta.ts (ReviewMeta: the reader's summary header; reviewMetaFromJob for hosted jobs),
                     skip-reasons.server.ts (why each changed file is left out, for both review paths: the built-in
                     list, then the reviewed repository's own `.gitattributes` — `git check-attr` at the head commit,
                     which resolves a nested `.gitattributes` for the paths beneath it — then binary; the git call is
                     injected, since the hosted runner and `er` deliberately differ over whose git config applies;
                     toReviewFiles stamps the reasons onto the changed files a review stores),
                     bundle.ts (ReviewBundle: a review + meta + both sides of each file, for offline rendering;
                     schemaVersion, no back-compat; parseBundle, filePair), bundle-html.ts (the bundle as the text of
                     the report's er-bundle element: injectBundle escapes every <, readEmbeddedBundle),
                     language-map.ts, partial-narrative-parse.ts (live-view checklist), inline-diff-snippets.ts (reader maths)
    clone/           *.server.ts: git-runner (spawn, non-interactive, the host's system and global gitconfig ignored
                     unless a call asks for `hostConfig`, abort → SIGTERM; argBatches, the path-list split that keeps a
                     command line inside Windows' limit), clone-runner (init + fetch head +
                     verify SHA + fetch base + diff, which refuses the diff drivers a repository's own
                     `.gitattributes` can name; headRefFor, githubCloneUrl),
                     diff-files (listChangedFileDetails/parseChangedFiles: per-file counts joined to statuses over
                     `-z` output under the same diff pins, each rename's old path and the binary flag; output that
                     ends mid-record throws rather than yielding a short list)
    prompt/          pure: ai-file-filter (the rules that need no repository to state them — builtInSkipReason over
                     lockfiles, bundles and snapshots, binarySkipReason; skip-reasons.server.ts layers the
                     repository's own marks between them),
                     diff-hunk-catalog (H0001… ids; PromptGrounding/groundingFor, what a model's answer is
                     checked against), narrative-prompt (system + user; the prompt reviews exactly the files
                     carrying no `skipped` reason, drops the patch of anything the built-in rules match even
                     when the file list missed it, and lists the rest under Not Reviewed; hunk ids are numbered
                     over the whole filtered diff, so ids mean the same thing to the coverage backstop, and the
                     result carries both `catalog`, every hunk, for coverage, and `grounding`, which resolves only
                     the hunks the truncated prompt showed while knowing every reviewed file's name;
                     NARRATIVE_SYSTEM_PROMPT, formatFileList, formatHunkCatalog and formatSkippedSection are
                     shared with the local CLI's prompt),
                     parse-narrative (lenient sanitising, validated by NarrativeReviewSchema; a failed JSON.parse is
                     retried once with escapeStrayQuotes, which escapes a quote the model left unescaped inside a string;
                     fails the whole review — never silently drops or keeps a chapter — when a chapter ends up with no
                     diffChunks after hunk-id resolution and the prompt showed at least one hunk to cite, since prose
                     with nothing to show for it is a generation defect, not a valid review; a diff with nothing
                     reviewable at all is exempt, since then no chapter could have cited anything;
                     sanitizeProse takes a `{ lede, body? }` object or a bare string, which is promoted to the
                     lede, as is a body that arrived without one; a chapter's diffChunks are merged to one per
                     filename, since the reader keys a file's insights and its count on the name; and an insight's
                     `filename` survives only when the chapter's own diffChunks cite it — anchored elsewhere it
                     would be drawn nowhere, so the anchor goes and the insight stays),
                     parse-diagram (same leniency for diagrams: drops the invalid part, validates each diagram on its own
                     so a bad picture cannot fail the review; a node's filename checked against the reviewed file
                     list and its hunk ids against the hunks the prompt showed), types.ts (PrData),
                     instructions.ts (the review instructions and output schema, shared with the local CLI, plus one
                     closing paragraph per path: SERVER_WORKING_TREE, LOCAL_WORKING_TREE; the assembled server prompt is
                     pinned byte-for-byte by __fixtures__/server-prompt.txt)
    executor/        types.ts (ReviewExecutor, errors; the output's optional `hunks` is the prompt's catalog, which
                     the runner attaches to `files[]` — the stub has none); stub-executor.server.ts (STUB_REVIEW in fragments);
                     claude-executor.server.ts (Agent SDK, read-only tools, sandbox, settingSources: [], env allowlist);
                     sdk-loop.server.ts (the message loop both this and the local CLI run on: text, tool uses and the
                     result out — subtype, turns, cost and token usage, cost counted even when the run ran out of
                     turns — nothing thrown: each caller decides what a failure means)
    run.server.ts    runJob(input, deps) → 'done' | 'skipped' | 'aborted' | 'errored'; defaultRunJobDeps(); formatJobError
  jobs/              all *.server.ts: registry (AbortControllers on globalThis[JOBS_REGISTRY_KEY]), timeout (armTimeout),
                     start-review (startReview / rerunJob / launchJob), cancel-job, recover-jobs, boot (bootJobs, once per process),
                     jobs (read side: parseJob/parseReview, getJob (non-UUID → null), listJobs, getReview, listChunksAfter,
                     listRecentActivity, toJobView);
                     shared: errors.ts (JobInFlightError, …), status.ts (JOB_STATUSES), job-view.ts (JobView, jobHref), activity.ts
src/jobs/            cli.ts (`npm run job -- <name>`), recover-jobs.ts, errors.ts
```

## How a review runs

- **Create / rerun** (`domain/jobs/start-review.server.ts`): refuse when the
  user already has `MAX_JOBS_PER_USER` jobs in flight (`JobInFlightError`),
  re-pin the target's SHAs against GitHub with the caller's token
  (`GithubAuthError` passes through for `/relink`; anything else is
  `HeadShaResolutionError`), insert a `pending` row, then `launchJob`:
  register an `AbortController`, arm the `REVIEW_TIMEOUT_MIN` timeout and
  run `runJob` fire-and-forget. A rerun copies the source target, is owned by
  the viewer and is pinned to the current head.
- **Runner** (`domain/review/run.server.ts`): `markRunning` (conditional
  `pending → running`; false means cancelled before start) → PR metadata →
  init + shallow fetch of `pull/N/head` or the branch → verify the head SHA
  still matches → fetch the base SHA → diff + changed files, each with its skip
  reason → executor. The
  executor streams raw text; each fragment becomes a `review_chunks` row
  (`seq` from 0, inserts fire-and-forget, drained before finalize).
  `finalizeDone` writes the `reviews` row and `running → done` in one
  transaction, the changed files carrying their hunks when the executor
  returned a catalog and `skipped` when `skipReasons` says why the
  prompt left it out; the `job done` log line reports the hunk coverage.
  Failures → `markErrored(formatJobError(err))`, clipped to 500 chars. Every side effect is injected (`RunJobDeps`) so the stub review runs
  end to end from `run.integration.test.ts` against a local git repo.
- **Abort reasons** say who already wrote the terminal status: `cancel`
  (`cancel-job.server.ts` wrote `cancelled` before signalling), `timeout`
  (`timeout.server.ts` wrote `error` first), `shutdown` (nobody — the runner
  writes `error: interrupted: server shutting down`).
- **Executors**: `REVIEW_EXECUTOR=stub` replays `STUB_REVIEW` in fragments
  (local default, all tests); `claude` runs the Agent SDK in the clone with
  read-only tools, the filesystem sandbox pinned to the clone,
  `settingSources: []` (the reviewed repo's `.claude/` cannot register hooks),
  `persistSession: false` and only `CLAUDE_ENV_KEYS` from the host env.
- **Process lifecycle**: `entry.server.tsx` awaits `bootJobs()` once per
  process, which flips orphaned `pending|running` rows to `error`
  ("interrupted: server restarted"); `npm run job -- recover-jobs` does the
  same by hand. `server/index.ts` handles SIGTERM/SIGINT: `abortAll('shutdown')`
  on the registry (reached through `globalThis[JOBS_REGISTRY_KEY]`, since the
  bootstrap sits outside Vite's module graph), `drain` for up to 5 s, then
  close. `/api/health` reports `queueDepth`, `oldestPendingAgeSec`,
  `errorsLast24h`.
- **Reads** go through `domain/jobs/jobs.server.ts`, which parses the JSON
  columns (`target` → `ReviewTargetSchema`, `content` →
  `NarrativeReviewSchema`); repositories return them as `unknown`.
