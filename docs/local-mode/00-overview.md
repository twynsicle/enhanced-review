# 00 — Local mode overview (plan of plans)

**Status:** decisions locked 2026-09-11 — Phase 1 next.
**Branch:** `feat/er-13-local-review-cli`, cut from `main` (`639b79d`).
**Issue:** [ER-13](https://linear.app/lemon-dev/issue/ER-13).
**Audience:** the maintainer and any agent picking this up cold.

This is the index document for adding a **local mode** to `enhanced-review`.
An engineer runs one command inside the repository they are reviewing. The
command:

- gathers the change with `git` and `gh`,
- runs Claude headless on their own laptop, with their own org API key and
  the whole repository readable, and
- writes a single `review.html` that renders the same narrative reader the
  hosted app uses.

It needs no server, no sign-in and no GitHub App.

Every phase below gets its own `phase-N-plan.md`, written **just before that
phase starts**, with ordered commits and verification steps. This file is the
map. It does not change except to record when each phase completes. The whole
`docs/local-mode/` folder is deleted in the last phase.

---

## 1. Why

- Installing a GitHub App, or any org-level GitHub integration, in the
  maintainer's organisation is blocked by process for roughly the next 3–4
  months. The hosting infrastructure the hosted app was meant to prove is
  deprioritised for the same period.
- Everything a review needs is already on each engineer's laptop: the repo,
  `gh` signed in to the org, Claude Code with an org API key, and Node 24.
  Local mode uses what is there instead of asking for anything to be granted.
- The local path lifts the hosted app's biggest quality limit. The agent can
  read the whole repository, not just the diff and the PR description (see
  ER-11 for why the server cannot).
- Checking an agent's work before it is pushed is what this tool was first
  built for. A server that only sees GitHub cannot do that; a local command
  can.
- The effort in this project goes into the reader and the prompt. Both are
  shared, so local mode is a new way to launch the product rather than a
  second product.

---

## 2. Decisions (locked — do not re-litigate)

| #   | Question                | Decision                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Product direction       | Local mode is the primary product until early 2027. The **hosted app is parked**. It stays green in CI and gets the shared reader and prompt improvements for free, but no hosted-only features. Whether to retire it or move it onto this pipeline is decided when the infrastructure work resumes.                                                                                                            |
| D2  | One reader              | The report renders the **existing** narrative components (`src/web/components/narrative/`). There is never a second reader implementation. Where the hosted reader depends on its environment (GitHub file reads, the PR header, rerun), the dependency is **injected, not forked**.                                                                                                                            |
| D3  | Report format           | One self-contained `review.html`, with JS, CSS, fonts and review data all inlined, opened straight from disk. Chromium only (Chrome and Edge); Firefox is unsupported. Monaco keeps loading from the jsDelivr CDN, as the hosted app already does.                                                                                                                                                              |
| D4  | Targets                 | `er review` reviews the current branch: from its merge-base with `origin/<default>` to `HEAD`, with the PR's title, description and author attached when `gh pr view` finds one. `er review <n>` reviews PR `n` via `gh`. `er review --staged` reviews **staged changes only**, compared with `HEAD`. Every target resolves to a pair of commits, `base` and `head`. Unstaged edits are never part of a review. |
| D5  | Where Claude runs       | A script drives Claude **headless** through the Agent SDK. It does not start inside Claude Code. The agent uses the engineer's own credentials and environment, with **read-only tools** (Read, Glob, Grep), and loads the reviewed repo's Claude config (`CLAUDE.md`, settings) as a normal session would.                                                                                                     |
| D6  | Agent working directory | **PR reviews** run in a temporary worktree at the PR's head, so the engineer's own checkout is never touched. **Branch and staged reviews** run at the root of the repository in the current directory, where the engineer already is, with `node_modules` and local config present. When the working tree holds edits outside the review, the command warns and tells the agent so (A1).                       |
| D7  | Context delivery        | **Agentic.** The prompt carries the file list and a compact hunk table (id, file, lines, +/−), not the diff. Hunk files for each changed file, plus the PR description, go into a staging folder the agent reads as it needs them, alongside the whole repository. There is no diff token budget or per-file truncation.                                                                                        |
| D8  | Exclusions              | One **skip** tier: the built-in list in this repo (`ai-file-filter.ts`) plus anything `.gitattributes` marks `linguist-generated` or `linguist-vendored` (checked with `git check-attr`). Skipped files get no hunk ids and no embedded contents, and they appear in the reader's file list marked as generated. Users cannot configure it; configurability for the hosted app is a backlog item.               |
| D9  | Pipeline                | Five stages, each writing a file in the run folder: `gather → prompt → run → parse → render`. Any stage can be rerun from the previous stage's output. Only `run` calls Claude.                                                                                                                                                                                                                                 |
| D10 | Output location         | `./er-reviews/<slug>/`, relative to the current directory, holding the stage files and `review.html`. This repo gitignores `er-reviews/`; other repos take no special care.                                                                                                                                                                                                                                     |
| D11 | Report data format      | A Zod-validated `ReviewBundle` with a `schemaVersion`. A reader that meets a different version refuses to render and says "regenerate this review". **No backward compatibility**: reports are ephemeral.                                                                                                                                                                                                       |
| D12 | Progress                | Terminal only: elapsed time, the files the agent is reading, and chapter titles as they stream. The report opens in the browser when it is done.                                                                                                                                                                                                                                                                |
| D13 | Distribution + platform | Clone this repo, `npm install`, `npm link`: `er` is then on PATH. Node 24. **This branch targets Windows.** macOS support and verification are fine-tuned in a separate branch and session afterwards, so OS-specific code (opening a browser, temp paths, the bin shim) is kept in one module to give that work a single place to change.                                                                      |
| D14 | Prompt sharing          | One shared module holds the review instructions, schema and diagram rules. Each path adds its own delivery section (inline diff on the server, staging folder locally). The parser is shared unchanged. The server's prompt text must not change as a side effect.                                                                                                                                              |
| D15 | UI iteration            | A Vite dev server with hot reload runs the report's entry point against a committed sample data file, or any local `er-reviews/` data file. No UI change ever needs a Claude run.                                                                                                                                                                                                                               |
| D16 | Separation              | Local and hosted reviews are fully separate: there is no upload or import in either direction.                                                                                                                                                                                                                                                                                                                  |
| D17 | Planning                | Plans live in `docs/local-mode/`, written just-in-time and deleted at the end. ER-13 tracks the work. There is no separate spike phase: each phase proves its own riskiest assumption in its first commit (§6), and falls back there if it fails.                                                                                                                                                               |

---

## 3. Assumptions

Recommended defaults the phase plans follow unless overridden.

| #   | Assumption                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Working directories (D6).<br>• **PR:** `git worktree add --detach <os-tmp>/er-<id> <head>`, removed in a `finally` and on SIGINT/SIGTERM, with stale `er-*` worktrees swept and `git worktree prune` run at the start of each run.<br>• **Branch and staged:** the agent's cwd is `git rev-parse --show-toplevel`. If `git status` shows edits that are not in the review (anything uncommitted for a branch review, unstaged edits for a staged review), the command prints one warning line listing them. The prompt then tells the agent that the hunk files are the source of truth and that files on disk may hold extra uncommitted edits.<br>• **All targets:** the prompt tells the agent to ignore `er-reviews/`, apart from its own staging folder. |
| A2  | For `--staged`, the head commit is `git commit-tree $(git write-tree) -p HEAD`. It is a dangling commit that touches no branch, index or working file, and git's garbage collection removes it later.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| A3  | Base resolution: `git fetch origin <default>` first. The default branch comes from `git symbolic-ref refs/remotes/origin/HEAD`, falling back to `gh repo view`. Branch mode's base is `git merge-base HEAD origin/<default>`. PR mode fetches `pull/<n>/head` and the PR's base branch, and its base is their merge-base, which is the three-dot diff GitHub shows. `--base <ref>` overrides the base.                                                                                                                                                                                                                                                                                                                                                        |
| A4  | New area `src/cli/`: the entry point, target resolution, worktree lifecycle, one module per stage, and terminal output. The CLI may import `domain` modules only if they never reach `src/config/env.ts` (which requires the server's secrets at import), `src/common/logger.ts` or `src/db`. A new guardrail, `cli-imports`, walks the CLI's import graph to enforce this. `no-console` gains one exemption, `src/cli/terminal.ts`. The CLI reads no `process.env`: flags only, and the SDK inherits the environment.                                                                                                                                                                                                                                        |
| A5  | The report's entry point lives at `src/web/viewer/`, since only `src/web` may import React. It has its own `vite.viewer.config.ts` and builds everything inlined to `build/viewer/viewer.html`. The reader is wrapped in a hash router, so `useSearchParams` and `?ch=` deep links work from `file://`. The render stage copies the built shell and injects the bundle JSON into a `<script type="application/json">` placeholder. It rebuilds the shell when it is missing, or when the source hash stamped in it is stale (after a `git pull`).                                                                                                                                                                                                             |
| A6  | Reader seams, in Phase 1:<br>• A `FileSource` React context that `InlineDiffChunk` reads. The hosted app provides the `/api/github/file` fetcher; the report provides an embedded lookup.<br>• A neutral `ReviewMeta` for `SummaryCard`. The hosted app builds it from `target` + `pullMetadata`; the report builds it from the bundle.<br>• An `actions` slot on `ChapterReader`, which is where the rerun button goes.<br>The banners stay in the route. Rejected alternative: a fake `/api/github/file` loader in the report's router, which changes the reader less but hides the seam.                                                                                                                                                                   |
| A7  | The SDK message loop in `claude-executor.server.ts` moves into a logger-free module that both executors share. The server executor keeps its host-env allowlist, `settingSources: []` and clone-only sandbox. The local one inherits the environment, uses `settingSources: ['user', 'project', 'local']` and scopes reads to its working directory plus the run folder. Both keep the read-only tool set. The local `maxTurns` is raised and settable with a flag, because 60-file PRs will need more than the server's 30.                                                                                                                                                                                                                                  |
| A8  | Flags: `--model` (default: the server's `claude-sonnet-5`), `--base`, `--from <stage>` (reuses the target's latest run folder), `--timeout` (default 15 min), `--keep-worktree`, `--no-open`. Command and bin name: `er`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| A9  | The committed sample data file is built from `STUB_REVIEW` plus synthetic file contents, **not** from the long-lived review-specimen branches, so no answer key ever enters the repo. Real run folders stay gitignored under `er-reviews/`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| A10 | Embedded file contents mirror the hosted limit: a file over ~1 MB on either side is embedded as "too large", and the reader shows the same fallback it already has.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| A11 | Fonts are inlined as woff2 data URIs. The report shell, excluding Monaco and review data, should come in at a few MB at most. Phase 2 measures it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

---

## 4. Target shape

### The pipeline

```
er review [<pr> | --staged] [--from <stage>]
  resolve   target → { base, head, meta, cwd }     git / gh; --staged makes a temporary commit
  cwd       PR: git worktree add --detach <tmp> <head> (removed on exit) · else: repo root
  1 gather  → context.json  changed files, skip list, hunk catalog, file contents (both sides)
            → context/      one hunk file per changed file, pr.md               free, seconds
  2 prompt  → prompt.md     shared instructions + local delivery section         free, instant
  3 run     → events.jsonl, raw.txt   Agent SDK in cwd                 slow, the only paid step
  4 parse   → review.json   parseNarrativeReview(raw, hunkIndex), unchanged      free, instant
  5 render  → review.html   viewer shell + ReviewBundle JSON                     free, instant
```

### Shared, split, new

| Piece                                                | Status                                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `narrative.ts`, `diagram.ts`, `diff-hunk-catalog.ts` | Shared as they are                                                                        |
| `parse-narrative.ts`, `parse-diagram.ts`             | Shared as they are                                                                        |
| `ai-file-filter.ts`                                  | Shared, plus a `linguist-*` input from the CLI                                            |
| `narrative-prompt.ts`                                | **Split**: shared instructions module + server delivery (text unchanged) + local delivery |
| `claude-executor.server.ts`                          | **Split**: shared, logger-free SDK loop + server executor + local executor                |
| `src/web/components/narrative/*`                     | Shared, after the Phase 1 seams (A6)                                                      |
| `ReviewBundle`, `ReviewMeta` (`src/domain/review/`)  | **New**, browser-safe Zod schemas                                                         |
| `src/web/viewer/`, `vite.viewer.config.ts`           | **New**: the report's entry point and build                                               |
| `src/cli/`, `bin` `er`                               | **New**: targets, worktree, stages, terminal                                              |
| `clone-runner.server.ts`, jobs, db, auth, routes     | Hosted only, untouched                                                                    |

---

## 5. Phases

Each phase ends with `npm run check` green, the hosted app unchanged in
behaviour, and a commit series on the branch. Map files (`AGENTS.md`,
`.claude/rules/`) are updated in the same commit as the structural change that
needs them. All verification is on Windows (D13).

| Phase | Outcome                                                                                                                                                                                                                                                                                                                                              | Exit criteria                                                                                                                                                                                                       |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | **Bundle contract + reader seams.** `ReviewBundle` / `ReviewMeta` schemas. `FileSource` context, `SummaryCard` on `ReviewMeta`, `actions` slot (A6). The hosted reader is rewired to the seams with no visible change. UI baselines are captured before anything moves.                                                                              | Hosted reader screenshots match the baselines (light + dark, 1280 px). Reader tests pass against both a GitHub-backed and an embedded `FileSource`.                                                                 |
| **2** | **Report build target.** The first commit proves CDN Monaco, workers included, in a page opened from `file://`. Then `src/web/viewer/`, `vite.viewer.config.ts`, the inlined single-file build, the sample bundle (A9), `npm run viewer:dev` / `viewer:build`, and the version-mismatch screen.                                                      | `viewer.html` with the sample data, opened from disk in Chrome and Edge, matches the hosted reader's screenshots, including Monaco diffs, diagrams and keyboard navigation, in light and dark. Shell size recorded. |
| **3** | **CLI without Claude.** The first commit proves an `npm link`ed `er` bin running a `.ts` entry. Then `src/cli/`, target resolution for all three targets, the PR worktree lifecycle, the dirty-tree warning, the skip tier with `check-attr`, the `gather`, `prompt`, `parse` and `render` stages, `--from`, and the `cli-imports` guardrail.        | On this repo, all three targets produce `context.json` and `prompt.md`. `er review --from parse` on a saved `raw.txt` produces a working report. Ctrl+C during a PR review leaves no worktree behind.               |
| **4** | **Prompt split + `run`.** The first commit proves the Agent SDK driven from a script: auth with an org-style API key, the reviewed repo's settings loaded, tool events streamed. Then the shared instructions module, the local delivery section, the logger-free SDK loop shared by both executors (A7), the local executor, and terminal progress. | The server prompt is byte-identical before and after (snapshot test). Real local reviews of this repo's review-specimen PR and one org-sized PR (roughly 60 files) produce valid reports end to end.                |
| **5** | **Docs + clean-out.** README "Local mode" section: install, `npm link`, the three targets, the stages. Final AGENTS.md / rules pass. Delete `docs/local-mode/`.                                                                                                                                                                                      | A fresh clone → `npm install` → `npm link` → `er review` works on Windows. No `docs/local-mode/` references remain. macOS is handed over to its own branch.                                                         |

Phase plan docs: `phase-1-plan.md` … `phase-5-plan.md`, written just-in-time.

---

## 6. Risks and how each phase handles them

- **CDN Monaco from a `file://` page.** Monaco's workers load across origins,
  and a page opened from disk has a null origin. Phase 2's first commit settles
  it. Fallback: `er` serves the report on `localhost` for as long as it is
  open. That changes launching, not the reader.
- **Node type stripping behind `npm link`.** Node refuses to strip types from
  files under `node_modules`, and the global link is a symlink there. It should
  resolve to the clone, but Phase 3's first commit proves it. Fallback: a
  two-line `.js` bin that imports the `.ts` entry.
- **Agent SDK auth and settings from a script.** Phase 4's first commit proves
  it before any executor code moves.
- **`env.ts` throws at import.** Any CLI import that reaches the logger crashes
  without server secrets. The `cli-imports` guardrail (Phase 3) makes this a
  test failure rather than a runtime surprise. Phase 4's SDK-loop extraction
  removes the one reuse that currently goes through the logger.
- **Hosted regressions from the seams.** Phase 1 captures baselines before
  anything moves, and compares them afterwards.
- **The agent reads more than the review in a working directory.** In branch
  and staged reviews it can see uncommitted edits and earlier `er-reviews/`
  output. A1's warning and prompt wording cover it. Phase 4 checks that a real
  run does not narrate files outside the hunk table.
- **Agent budget on big PRs.** With no token budget, the agent may read too
  little or too much, or run out of turns. Phase 4 measures turns and time on
  the 60-file PR and sets the local `maxTurns` default from that.
- **Server prompt drift.** The split must not change what the server sends. A
  snapshot of the assembled server prompt is taken before the split and must
  still match after it.
- **macOS, untested here.** Git reports paths with `/`, but temp folders, the
  bin shim and opening a browser differ by OS. D13 keeps that code in one
  module for the macOS branch to adjust.
- **The reviewed repo's hooks run under the agent** (D5). This is accepted: it
  is the engineer's own repo, run as their own session.
- **Report size.** Inlined React, Mantine and fonts, plus both sides of every
  changed file. Phase 2 measures the shell; Phase 4 measures a 60-file report.
  The 1 MB per-file cap (A10) bounds the worst case.

---

## 7. Out of scope

- macOS support and verification. It gets its own branch after this one (D13).
- Hosted-only features, including ER-10 (the context box), for as long as the
  app is parked (D1).
- Importing or uploading local reviews to the hosted app, or hosting reports
  anywhere (D16).
- Firefox.
- User-configurable exclusions (backlog).
- Distributing as a Claude Code plugin or skill.
- Reviewing unstaged changes.
