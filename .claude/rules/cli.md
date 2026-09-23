---
paths:
  - 'src/cli/**'
---

# `src/cli/` — `er`, the local review CLI

Loaded when you open a CLI file. `er review` runs inside the repository under
review and writes one `review.html` — everything inlined but the Monaco editor,
which the page fetches. The `sdk-import` guardrail holds the Agent SDK to
type-only or dynamic imports so nothing but a real run loads it. Output goes
through `terminal.ts` (stdout/stderr, never `console`), and the environment
comes only through `host-env.ts`.

```
src/cli/
  er.ts            the bin (`npm link` puts it on PATH): parseArgs → review; usage errors reprint the usage;
                   the only SIGINT/SIGTERM handlers (run interrupts.ts cleanups, exit 130/143)
  review.ts        the review command: target, then gather → prompt → run → parse → render; --stub, --from, --no-open,
                   --keep-worktree, --model, --max-turns, --timeout, --allow-large; past 300 reviewed files a model run is
                   refused (a fresh one inside gather, before any blob is read; a resumed one before the run),
                   past 50 it warns, and --stub is held to neither; prints each warning finding after the parse
                   line and returns WARNED (2) when there was one — --from render reads them back with
                   readFindings, so rendering again says the same thing about the review; deps (Shell, render,
                   open, query) injectable for the end-to-end test
  targets.ts       resolveTarget: branch (against the open PR's base or origin's default, fetched first), pr (fetch
                   pull/<n>/head), both measured from where head forked off the base: the merge-base, or the
                   fork point from the base's reflog when the base was rewritten since and `git cherry` finds every
                   commit in between still in it (a rebased stack); commits it no longer has at all are reviewed
                   as the change's own; either way a warning names the --base for the other answer; staged (the
                   index as a dangling commit on HEAD); --base;
                   locateTarget (repo root + slug only, for --from); TargetSchema
  git.ts           Shell: git (git-runner's non-interactive runner, run with the engineer's own gitconfig so
                   their credentials, proxy and safe.directory apply) and gh, bound to one directory
  git-runner.ts    spawn git non-interactively, the host's system and global gitconfig ignored unless a call asks
                   for `hostConfig` (the tests run without it), abort → SIGTERM; argBatches, the path-list split
                   that keeps a command line inside Windows' limit
  host-env.ts      the only process.env reader: hostEnv(), what a spawned git, gh or SDK
                   subprocess inherits
  diff-files.ts    listChangedFileDetails/parseChangedFiles: per-file counts joined to statuses over `-z` output,
                   each rename's old path and the binary flag; output that ends mid-record throws rather than
                   yielding a short list
  skip-reasons.ts  why each changed file is left out: the built-in list, then the reviewed repository's own
                   `.gitattributes` (`git check-attr` at the head commit, which resolves a nested
                   `.gitattributes` for the paths beneath it), then binary; toReviewFiles stamps the reasons on
  run-folder.ts    <repo root>/er-reviews/<slug>/<stamp>/ and each stage's file; latestRunFolder; the runs folder
                   ignores itself
  context.ts       the gather stage → context.json (RunContextSchema): files with skip reasons, hunks numbered
                   across the change, embedded contents (bundle shape, >1 MB too-large), commits, dirty paths;
                   one diff file carrying every reviewed file's annotated patch, its line count carried as
                   `diffLines` so the prompt can ask the agent to Read it in one call; pr.md
  prompt.ts        system.md (NARRATIVE_SYSTEM_PROMPT + LOCAL_WORKING_TREE) + prompt.md: header, description,
                   commits, where the agent is, Files Changed, Not Reviewed, the hunk table, and where the diff
                   file is, with its length
  claude-run.ts    the run stage: the Agent SDK in the working directory → raw.txt as it streams + events.jsonl
                   (tool uses, refusals, blocked stops, and a result event carrying turns, cost and the token
                   usage); validationStopHook registered on Stop over the run's own copy of the answer,
                   so a disqualified one costs a turn rather than a second run, and each refusal is a `blocked`
                   event and a terminal note, and a hook that throws is a `hook-error` event and a warning rather
                   than a stranded run; the engineer's user settings, plus the working tree's
                   project/local settings only when it is their own checkout (never a PR's worktree), read-only tools, the engineer's environment inherited by the subprocess; the SDK is imported
                   only when a run happens
  sdk-loop.ts      the SDK message loop: text, tool uses and the result out — subtype, turns, cost and token
                   usage, cost counted even when the run ran out of turns — nothing thrown; howItEnded, the one
                   reading of a result
  validation-stop-hook.ts
                   the retry, as a Stop hook: validates the text accumulated so far and refuses the stop up to
                   MAX_VALIDATION_RETRIES times, naming the defect and asking for the whole block again — without
                   spelling the tag pair, which the parser would then find; onBlock gets the defects apart from
                   the reason sent to the model, and onError allows the stop when the hook itself throws rather
                   than stranding the run; SDK types only
  bash-gate.ts     which Bash commands a review may run: the line is read as bash reads it, quotes removed, and
                   split at | && ||; every part must be a known read-only invocation; no redirection (bar
                   2>/dev/null), substitution, variables, backslashes, launcher flags or a glob that could be a flag
  progress.ts      the run log: one elapsed-time-stamped line per tool use, carrying the SDK's own turn number
                   (one turn however many tools it asked for at once), plus a line per chapter title picked out
                   of the answer as it streams, and a heartbeat line while a turn is quiet
  stub-run.ts      --stub: raw.txt with one chapter per reviewed file citing all its hunks; no model. It also
                   overwrites events.jsonl with one clean result event, so the parse stage reads how this run
                   ended and never an earlier run's log
  parse.ts         raw.txt → validateReview (the same verdict the Stop hook uses) → review.json + findings.json,
                   files taken from context, each carrying its share of the hunk catalog; what the run itself cost
                   is read back off events.jsonl rather than passed down, so --from parse reports the same
                   findings without paying for the model again: refusals → one `commands-refused` warning, a
                   result that is missing or not a clean success → a fatal `run-stopped-early`, blocked stops →
                   `passed-after-retry`; no events.jsonl at all is itself a fatal `run-stopped-early`, since an
                   empty findings list and no record of the run must not read alike, and any other read error is
                   rethrown. A fatal finding fails the stage, having written findings.json and deleted any
                   review.json first, so the record of the failure survives it and no later --from render draws a
                   stale review; the failure points at raw.txt only when the defect is in the answer, since a
                   run-stopped-early is about turns nobody can put back by editing it. readFindings reads that
                   file back for the render stage, and refuses one that is missing, half-written or fatal
  render.ts        the bundle into the report shell → review.html; reportShell rebuilds build/report when stale
  shell-stamp.ts   hash of the report's sources; the report build writes it, render compares it
  worktree.ts      a PR's run happens in a detached worktree of its head in the temp dir (er-pr<n>-<pid>-<stamp>),
                   added without hooks or LFS downloads, removed after the run or on interrupt; the sweep removes
                   worktrees whose process is gone
  interrupts.ts    the cleanup registry the signal handlers run (synchronous: the process exits straight after)
  platform.ts      everything OS-specific (Windows and macOS): the tool root, npm scripts, the temp dir,
                   path comparison, opening a file
  terminal.ts      stage lines, notes, warnings, errors
```

- Stages read only what earlier stages wrote, so `--from prompt|run|parse|render`
  resumes the newest run folder for the same target without touching the
  network or the diff.
- Tests drive real git against `src/test/git-repo.ts` (a throwaway repository
  with a bare origin) and hand gh canned JSON through `Shell`'s runners.
- The model run is the only stage that costs anything, and the only one that
  needs the network. It pays for its whole context on every turn, so the
  stage line reports the tokens that went in and what share of them was read
  from cache — that share, not the size of the prompt, is what explains a
  bill. `--stub` replaces it; `--from parse` skips it entirely,
  which is how a report is rebuilt from a `raw.txt` that is already there.
- `Read`, `Glob` and `Grep` are pre-approved; `Bash` is deliberately left out
  of `allowedTools` so every command goes through `bash-gate.ts` in the
  `canUseTool` callback. A refused command comes back to the agent as a tool
  result saying what it may run instead, not as a failed review — but it costs
  a turn, so each refusal is a `denied` event in `events.jsonl` and the parse
  stage turns them into one warning. A gate that keeps refusing reasonable
  reads is a bug in the gate.
- **Exit codes**: `0` a clean review, `2` a review that was written and
  carries warnings — every one of them printed, and all of them in
  `findings.json` — and `1` no review at all (a stage threw, including a fatal
  finding at parse). `130`/`143` are the signal handlers. Warnings exit
  non-zero on purpose: a script that stops on anything but 0 stops on a review
  worth reading, which is the safe way round, and one that cares can tell 2
  from 1.

## Why it is built this way

The plan that produced `er` was deleted when it was finished, as planned. What
it decided, kept here because changing any of it is a decision to re-make and
not an accident to fix:

- **Local mode is the primary product** until roughly early 2027, because the
  organisation cannot install a GitHub App. The hosted app was removed; it is
  kept at the git tag `hosted-app-final`.
- **The report is a static page.** `src/report/` renders a `ReviewBundle`
  embedded in the page, with no server and no router.
- **One `review.html`**, opened from disk: every script, style and font
  inlined, and Monaco fetched from a CDN when a diff is opened. That last part
  is a decision, not a gap — bundling the editor would cost 24 MB and the file
  is meant to be emailable — so the report is not offline-capable and is not
  going to be. Chromium only; Firefox is out of scope.
- **The prompt is agentic, not inline.** It carries the file list, a compact
  hunk table, and the whole change's patch as one diff file on disk the agent
  opens — one file rather than one per reviewed file, so reading the change
  costs a single turn however many files it touches. This is why the local run
  gets `Bash` and a working directory it can explore.
- **A PR review runs in a throwaway worktree** of the PR's head, so the
  engineer's checkout is never touched and never has to be clean. Branch and
  staged reviews run where the engineer already is, and warn about edits that
  are not part of the review.
- **The model runs as the engineer**, headless through the Agent SDK, with
  their own credentials and user settings. The repository's own Claude config
  loads only for a branch or staged review, in the engineer's checkout: a PR's
  worktree is its author's files, and a hook there would run as the reviewer.
  `er` reads no credential itself; a sign-in problem is theirs to fix in their own
  terminal.
- **Five stages, each resumable**, because the model run is the only one that
  costs money: `gather → prompt → run → parse → render`. Nothing should ever
  have to be paid for twice.
- **A report stays local.** No upload, no hosting a report anywhere.
- **Windows and macOS.** `platform.ts` is the single seam every OS difference
  goes through — where the tool root is, how it runs its own npm scripts, the
  temp dir a PR worktree lives in, and how a report is opened. A third OS
  needs only a branch there, not a change anywhere else.

Also deliberately absent, and not oversights: user-configurable exclusions,
distribution as a Claude Code plugin or skill, and reviewing unstaged changes.
