---
paths:
  - 'src/cli/**'
  - 'vite.viewer.config.ts'
---

# `src/cli/` — `er`, the local review CLI

Loaded when you open a CLI file. `er review` runs inside the repository under
review and writes one `review.html` — everything inlined but the Monaco editor,
which the page fetches — that renders the same reader as the hosted app. It runs on an engineer's laptop with none
of the server's configuration, so the `cli-imports` guardrail keeps its whole
import graph clear of `env.ts`, the logger, the db layer and server-only
packages. Output goes through `terminal.ts` (stdout/stderr, never `console`).

```
src/cli/
  er.ts            the bin (`npm link` puts it on PATH): parseArgs → review; usage errors reprint the usage;
                   the only SIGINT/SIGTERM handlers (run interrupts.ts cleanups, exit 130/143)
  review.ts        the review command: target, then gather → prompt → run → parse → render; --stub, --from, --no-open,
                   --keep-worktree, --model, --max-turns, --timeout; prints each warning finding after the parse
                   line and returns WARNED (2) when there was one; deps (Shell, render, open, query) injectable
                   for the end-to-end test
  targets.ts       resolveTarget: branch (against the open PR's base or origin's default, fetched first), pr (fetch
                   pull/<n>/head, merge-base with its base), staged (the index as a dangling commit on HEAD); --base;
                   locateTarget (repo root + slug only, for --from); TargetSchema
  git.ts           Shell: git (the shared non-interactive runner, run with the engineer's own gitconfig so
                   their credentials, proxy and safe.directory apply) and gh, bound to one directory
  run-folder.ts    <repo root>/er-reviews/<slug>/<stamp>/ and each stage's file; latestRunFolder; the runs folder
                   ignores itself; hunkFileName (Windows-safe)
  context.ts       the gather stage → context.json (RunContextSchema): files with skip reasons, hunks numbered
                   across the change, embedded contents (bundle shape, >1 MB too-large), commits, dirty paths;
                   one annotated hunk file per reviewed file; pr.md
  prompt.ts        system.md (the shared instructions + LOCAL_WORKING_TREE) + prompt.md (the local delivery section)
  claude-run.ts    the run stage: the Agent SDK in the working directory → raw.txt as it streams + events.jsonl
                   (tool uses, refusals, blocked stops, and a result event carrying turns, cost and the token
                   usage); the shared validationStopHook registered on Stop over the run's own copy of the answer,
                   so a disqualified one costs a turn rather than a second run, and each refusal is a `blocked`
                   event and a terminal note; the reviewed repo's own settings (settingSources user/project/local),
                   read-only tools, the engineer's environment inherited by the subprocess; the SDK is imported
                   only when a run happens
  bash-gate.ts     which Bash commands a review may run: the line is split at | && ||, every part must be a known
                   read-only invocation; no redirection (bar 2>/dev/null), substitution or launcher flags
  progress.ts      the live line during the run: elapsed time, the file being read, chapter titles picked out of the
                   answer as it streams; drawn only on a terminal
  stub-run.ts      --stub: raw.txt with one chapter per reviewed file citing all its hunks; no model
  parse.ts         raw.txt → validateReview (the same verdict the hosted run uses) → review.json + findings.json,
                   files taken from context, each carrying its share of the hunk catalog; what the run itself cost
                   is read back off events.jsonl rather than passed down, so --from parse reports the same
                   findings without paying for the model again: refusals → one `commands-refused` warning, a
                   result that is missing or not a clean success → a fatal `run-stopped-early`, blocked stops →
                   `passed-after-retry`. A fatal finding fails the stage, pointing at raw.txt
  render.ts        the bundle into the viewer shell → review.html; viewerShell rebuilds build/viewer when stale
  viewer-stamp.ts  hash of the viewer's sources; the viewer build writes it, render compares it
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
  organisation cannot install a GitHub App. The hosted app is parked: it stays
  green in CI and shares the reader, the prompt and the parser, but it gets no
  new features while this is the way the tool is used.
- **There is never a second reader.** The report renders
  `src/web/components/narrative/` — the same components the hosted app serves.
  A change to the reader has to work for both, which is what `FileSource` and
  the bundle contract are for.
- **One `review.html`**, opened from disk: every script, style and font
  inlined, and Monaco fetched from a CDN when a diff is opened. That last part
  is a decision, not a gap — bundling the editor would cost 24 MB and the file
  is meant to be emailable — so the report is not offline-capable and is not
  going to be. Chromium only; Firefox is out of scope.
- **The prompt is agentic, not inline.** It carries the file list and a compact
  hunk table, and the hunks themselves are files on disk the agent opens. This
  is the opposite of the hosted path, which pastes the diff in, and it is why
  the local run gets `Bash` and a working directory it can explore.
- **A PR review runs in a throwaway worktree** of the PR's head, so the
  engineer's checkout is never touched and never has to be clean. Branch and
  staged reviews run where the engineer already is, and warn about edits that
  are not part of the review.
- **The model runs as the engineer**, headless through the Agent SDK, with
  their own credentials and the reviewed repository's own Claude config. `er`
  reads no credential itself; a sign-in problem is theirs to fix in their own
  terminal.
- **Five stages, each resumable**, because the model run is the only one that
  costs money: `gather → prompt → run → parse → render`. Nothing should ever
  have to be paid for twice.
- **Local and hosted reviews never meet.** No import, no upload, no hosting a
  report anywhere.
- **Windows and macOS.** `platform.ts` is the single seam every OS difference
  goes through — where the tool root is, how it runs its own npm scripts, the
  temp dir a PR worktree lives in, and how a report is opened. A third OS
  needs only a branch there, not a change anywhere else.

Also deliberately absent, and not oversights: user-configurable exclusions,
distribution as a Claude Code plugin or skill, and reviewing unstaged changes.
