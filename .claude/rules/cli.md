---
paths:
  - 'src/cli/**'
  - 'vite.viewer.config.ts'
---

# `src/cli/` — `er`, the local review CLI

Loaded when you open a CLI file. `er review` runs inside the repository under
review and writes a self-contained `review.html` that renders the same reader
as the hosted app (docs/local-mode). It runs on an engineer's laptop with none
of the server's configuration, so the `cli-imports` guardrail keeps its whole
import graph clear of `env.ts`, the logger, the db layer and server-only
packages. Output goes through `terminal.ts` (stdout/stderr, never `console`).

```
src/cli/
  er.ts            the bin (`npm link` puts it on PATH): parseArgs → review; usage errors reprint the usage;
                   the only SIGINT/SIGTERM handlers (run interrupts.ts cleanups, exit 130/143)
  review.ts        the review command: target, then gather → prompt → run → parse → render; --stub, --from, --no-open,
                   --keep-worktree; deps (Shell, render, open) injectable for the end-to-end test
  targets.ts       resolveTarget: branch (against the open PR's base or origin's default, fetched first), pr (fetch
                   pull/<n>/head, merge-base with its base), staged (the index as a dangling commit on HEAD); --base;
                   locateTarget (repo root + slug only, for --from); TargetSchema
  git.ts           Shell: git (the shared non-interactive runner) and gh, bound to one directory
  run-folder.ts    <repo root>/er-reviews/<slug>/<stamp>/ and each stage's file; latestRunFolder; the runs folder
                   ignores itself; hunkFileName (Windows-safe)
  context.ts       the gather stage → context.json (RunContextSchema): files with skip reasons, hunks numbered
                   across the change, embedded contents (bundle shape, >1 MB too-large), commits, dirty paths;
                   one annotated hunk file per reviewed file; pr.md
  prompt.ts        system.md (the hosted instructions, unchanged) + prompt.md (the local delivery section)
  stub-run.ts      --stub: raw.txt with one chapter per reviewed file citing all its hunks; no model
  parse.ts         raw.txt → the hosted lenient parser → review.json, files taken from context
  render.ts        the bundle into the viewer shell → review.html; viewerShell rebuilds build/viewer when stale
  viewer-stamp.ts  hash of the viewer's sources; the viewer build writes it, render compares it
  worktree.ts      a PR's run happens in a detached worktree of its head in the temp dir (er-pr<n>-<pid>-<stamp>),
                   added without hooks or LFS downloads, removed after the run or on interrupt; the sweep removes
                   worktrees whose process is gone
  interrupts.ts    the cleanup registry the signal handlers run (synchronous: the process exits straight after)
  platform.ts      everything OS-specific (Windows now, macOS later): the tool root, npm scripts, the temp dir,
                   path comparison, opening a file
  terminal.ts      stage lines, notes, warnings, errors
```

- Stages read only what earlier stages wrote, so `--from prompt|run|parse|render`
  resumes the newest run folder for the same target without touching the
  network or the diff.
- Tests drive real git against `src/test/git-repo.ts` (a throwaway repository
  with a bare origin) and hand gh canned JSON through `Shell`'s runners.
- Until the Claude run lands, `er review` without `--stub` stops after the
  prompt.
