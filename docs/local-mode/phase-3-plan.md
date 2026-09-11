# Phase 3 — CLI without Claude

**Parent:** [00-overview.md](00-overview.md) (D4, D6–D10, D12, D13, A1–A5,
A8, A10). **Status:** done (see Result).

This phase builds `er review`, run from inside the repository under review,
for all three targets, through every stage except a real Claude run. A
`--stub` run stage writes a mechanical review (one chapter per changed file,
citing its real hunk ids), so the whole pipeline can be exercised on a real
diff for free. It is kept after Phase 4 as the no-cost way to check the
report on a real change (D15).

## Shape

```
src/cli/
  er.ts          bin entry: parseArgs → review command; exit codes; the only
                 place that installs signal handlers
  review.ts      the review command: target, then the stages in order
  terminal.ts    all output, written to process.stdout/stderr (no-console
                 bans only console.*): stage lines, warnings, errors
  platform.ts    everything OS-specific (D13): temp dir, opening a file in the
                 browser, the tool's own root
  git.ts         Shell: git (via the shared git-runner) and gh, bound to one
                 directory; both runners injectable for tests
  targets.ts     resolve pr / branch / staged → Target {kind, slug, base, head,
                 meta, repoRoot}
  run-folder.ts  er-reviews/<slug>/<timestamp>/; latest-for-slug; paths of
                 each stage's files
  context.ts     RunContext Zod schema (context.json) + the gather stage
  prompt.ts      the prompt stage (local delivery section)
  stub-run.ts    the --stub run stage
  parse.ts       the parse stage
  render.ts      the render stage: the viewer shell, rebuilt when stale, plus
                 the bundle
  worktree.ts    the PR worktree lifecycle
```

The CLI is a new area. The layering guardrail gains
`cli → cli, domain, config, common`, and nothing imports `cli`. A new
`cli-imports` guardrail walks the CLI's import graph and fails if it reaches
`src/config/env.ts`, `src/common/logger.ts`, `src/db/` or a server-only
package other than the Agent SDK (A4). `config/host-env.ts` is fine: it reads
`process.env` without validating the server's secrets. The shared
`git-runner.server.ts` and `diff-files.server.ts` are therefore reusable.

## Stage files

One run folder: `<repo root>/er-reviews/<slug>/<yyyymmdd-hhmmss>/`, where
the slug is `pr-<n>`, `branch-<name>` or `staged` (a second run in the same
second gets `-2`). `er-reviews/` holds a `.gitignore` of `*`, so it ignores
itself and the reviewed repository needs no entry. (This repository lists
`/er-reviews/` in its own `.gitignore` anyway, because Prettier reads only the
root one.) `--from <stage>` reuses
the newest folder for that slug and runs from that stage onwards.

| Stage  | Reads                         | Writes                                                                                          |
| ------ | ----------------------------- | ----------------------------------------------------------------------------------------------- |
| gather | git, gh                       | `context.json`; `context/diff/<path>.diff` per reviewed file; `context/pr.md` when there is one |
| prompt | `context.json`                | `system.md` (the instructions), `prompt.md` (the local delivery section)                        |
| run    | `system.md`, `prompt.md`      | `raw.txt` (and `events.jsonl` from Phase 4). Phase 3 has only `--stub`                          |
| parse  | `raw.txt`, `context.json`     | `review.json` (`NarrativeReview`, with `files` from context)                                    |
| render | `review.json`, `context.json` | `review.html`, then opens it unless `--no-open`                                                 |

`context.json` (`RunContextSchema`) holds:

- the target: kind, base and head SHAs, the ref names, and the repo root;
- `meta: ReviewMeta`;
- `files: ReviewFile[]`, every changed file, each skipped one carrying its
  reason (`generated`, `vendored`, `built-in` or `binary`);
- `renamedFrom`, the old path of each renamed or copied file;
- `hunks: DiffHunk[]`, from the reviewed files only, numbered across the
  change in file order (each file is diffed on its own, so user diff
  settings cannot hide a hunk from the catalog);
- `contents`, a record of `EmbeddedFile` for every reviewed file. It uses the
  bundle's own shape, so render copies it straight across. A rename's base
  side is read from its old path. Either side over 1 MB is `too-large`
  (A10);
- `commits`, the subjects and bodies of the commits under review (none for
  staged), for the prompt when there is no PR description;
- `dirty`, the working-tree changes the review leaves out.

The hunk files annotate each hunk with its id on the line above its `@@`
header, so the agent can match the table to the text.

Splitting `system.md` from `prompt.md` refines D9's single `prompt.md`: the
SDK takes them separately. For Phase 3, `system.md` is the server's existing
instructions, exported unchanged. Phase 4 moves them into the shared
instructions module and adjusts the wording for local targets.

## Targets (A2, A3)

- **Default branch:** from `git symbolic-ref refs/remotes/origin/HEAD`,
  falling back to `gh repo view`. (This repo's own clone has no
  `origin/HEAD`, so the fallback is the common path.)
- **Fetch:** `git fetch origin <default>` runs first. If it fails (offline),
  the command warns and uses the local `origin/<default>`.
- **Branch mode:** base is `merge-base HEAD origin/<default>` (or `--base`),
  head is `HEAD`. `gh pr view` for the current branch attaches the title,
  body, number and author when an open PR exists, and its base branch then
  replaces the default branch (a refinement of A3: a branch whose PR targets
  `release` is reviewed against `release`). Otherwise the title is the branch
  name. A branch with no commits past its base is an error.
- **PR mode:** `gh pr view <n>` gives the title, body, author, refs and
  `headRefOid`. Then `git fetch origin pull/<n>/head <base>`. Head is the
  fetched commit, which must equal `headRefOid`; base is its merge-base with
  `origin/<base>`.
- **Staged mode:** head is `commit-tree $(write-tree) -p HEAD` and base is
  `HEAD`. An empty index is an error ("nothing staged").
- **Repo label:** from the origin URL, falling back to the folder name.

**Dirty tree (A1):** for branch and staged reviews, `git status --porcelain`
entries that are not part of the review are listed in one warning line. For a
branch review that is anything uncommitted; for a staged review, anything
unstaged or untracked. `er-reviews/` itself is ignored. The list goes into
`context.json` for Phase 4's prompt.

## Skip tier (D8)

A file is skipped when any of these holds:

- `isExcludedFromAI` matches it (reason `built-in`);
- `git check-attr --source=<head> linguist-generated linguist-vendored`
  sets either attribute (`generated` or `vendored`);
- it is binary (numstat `-`).

A skipped file gets no hunk ids, no hunk file and no embedded contents. It
still appears in the reader's file list, marked, and its file view explains
why rather than claiming the file is missing. That needs one reader change:
`ReviewFile` gains an optional `skipped` reason, so the hosted app can use
the marker later too.

## PR worktree (A1)

The worktree is needed only for the agent's working directory, so it exists
only when the run stage is in range (a real run from Phase 4, or `--stub`).

- **Named** `<tmp>/er-pr<n>-<pid>-<stamp>`. The pid is the owning `er`, so
  a review running in another terminal keeps its worktree.
- **At the start of the run stage**, stale ones are swept:
  `git worktree list --porcelain` entries under the OS temp dir with that
  name whose process is gone are force-removed, then `git worktree prune`.
- **Created with** `git -c core.hooksPath=<null device> worktree add --detach`
  and `GIT_LFS_SKIP_SMUDGE=1`: a post-checkout hook is the reviewed repo's
  code, and the agent can review a diff from LFS pointers.
- **Removed in** a `finally`, and from SIGINT/SIGTERM handlers that remove it
  synchronously before exiting 130/143. `--keep-worktree` skips the removal
  and prints the path; the next run's sweep removes it.

## Render (A5)

- **The shell** is `build/viewer/viewer.html` in the tool's own clone, which
  the CLI finds from its own file location.
- **Staleness:** a sidecar `build/viewer/viewer.stamp` holds a hash of the
  sources that feed the shell (`src/web`, `src/domain`,
  `vite.viewer.config.ts`, `tsconfig.json`, `package-lock.json`, tests left
  out). The viewer build writes it, so a hand-run `npm run viewer:build`
  leaves a fresh stamp too. When the shell is missing or the stamp differs
  (after a `git pull`), render runs `npm run viewer:build` in the tool root
  first.
- **Output:** the bundle is `{ meta, review, files: context.contents }`,
  injected with `injectBundle`, then opened with `explorer.exe` (the default
  browser) unless `--no-open`.
- **Without `--stub`**, until Phase 4, the command stops after the prompt
  and says so; `--from run` requires `--stub`.

## Commits

1. **`er` on PATH (proof).**
   - `package.json` gets `bin: { er: "src/cli/er.ts" }`, with a minimal
     `er.ts` (usage, `--version`) and `terminal.ts`.
   - Adds the `cli` area to layering and the `cli-imports` guardrail.
   - Run `npm link`, then `er --help` from another folder in PowerShell and
     Git Bash, and record what happened.
   - Fallback if Node refuses to strip types through the link: a `.js` bin
     that imports the `.ts` entry.
   - **Result:** npm writes `er`, `er.cmd` and `er.ps1` shims to the global
     prefix. From `C:\workspace\diffy`, `er --version` and `er --help` work in
     PowerShell, cmd and Git Bash, with exit codes 0 and 1 as intended. Node
     strips the types through the link, so the `.ts` bin stays and no shim
     is needed.
2. **Targets.** `git.ts`, `targets.ts`, `platform.ts`. Tests use a temporary
   git repository with an origin remote for branch and staged mode, and
   canned `gh` JSON for PR mode.
3. **Reader: skipped files.** The optional `skipped` reason on
   `ReviewFile`, a marker in the sidebar, and a file view that says the file
   was not reviewed and why. (Moved ahead of gather, whose `context.json`
   uses the field.)
4. **Gather.** The run folder, the skip tier, changed files, the hunk catalog
   and hunk files, embedded contents, `context.json` and the dirty-tree
   warning. Tests again use a temporary repository, including a rename, a
   binary file, a `linguist-generated` file and a file over 1 MB.
5. **Prompt.** Export the existing instructions unchanged; add the local
   delivery section (target, author, description or a pointer to `pr.md`,
   working-directory notes, Files Changed, skipped files, Changed Hunks,
   where the hunk files are).
6. **Stub run, parse, render, `--from`.** Stamp-based shell rebuild; open in
   the browser.
7. **PR worktree lifecycle** and the signal handlers.

Map files are updated in the commit that needs them: `AGENTS.md` (layout,
scripts, the new guardrail) and a new `.claude/rules/cli.md` once the area has
real detail (commit 6).

## Verification

- `npm run check` is green after every commit.
- On this repo, from a separate clone's point of view (run through the
  linked `er`):
  - `er review --staged --stub` with something staged;
  - `er review --stub` on this branch;
  - `er review <n> --stub` on one of this repo's PRs.

  Each must produce `context.json`, `prompt.md` and a report that opens and
  renders from disk.

- `er review --from parse` on a saved `raw.txt` rebuilds the report without
  touching git.
- Ctrl+C during a PR review leaves no `er-*` worktree in
  `git worktree list` and no folder in the temp dir.

## Result

All exit criteria hold except a manual Ctrl+C, which moves to Phase 4.

- **Gate.** `npm run check` is green after every commit: 562 tests, 63 of
  them the CLI's.
- **Runs through the linked `er`**, in a fresh clone of this repository with
  `origin/HEAD` set:
  - `er review --stub` on this branch: 75 files, 121 hunks, a 2.3 MB report.
  - `er review 3 --stub`: 45 files, 79 hunks, reviewed in a worktree that
    lived about 300 ms. `git worktree list` showed only the clone afterwards,
    and no `er-pr*` folder was left in the temp dir.
  - `er review --staged --stub` with a new file and a README edit staged.
    Run again with a further unstaged README edit and an untracked file, it
    reviewed the same two hunks and listed both paths in the warning and in
    the prompt's "Where You Are".
  - `er review --from parse` after editing `raw.txt`: the report carried the
    edited title. Resuming reads only the run folder; git is asked only for
    the repo root (and, for a branch review, the branch name, to find the
    folder).
  - `--keep-worktree` kept the worktree and printed its path; the next run
    swept it.

  Each run wrote `context.json`, `prompt.md` and a report. The reports opened
  in Edge (the default browser) from disk. Headless Edge screenshots show the
  summary, the chapters, Monaco diffs and the skipped-file view. A staged file
  containing `"</script>"` rendered intact.

- **Ctrl+C, not exercised by hand.** A stub run's worktree lives for
  milliseconds, and Windows cannot send SIGINT to another process. An
  end-to-end test runs the interrupt cleanups in the middle of a PR run and
  checks that the worktree and its registration are gone. A hook test proves
  that `core.hooksPath` keeps the reviewed repo's post-checkout hook from
  running; without the setting, the same hook runs. Phase 4's real run lasts
  minutes, so it gets the manual check.
- **Changes from the plan:**
  - The reader change came before gather, because `context.json` uses the
    field.
  - Branch mode follows an open PR's base branch rather than the default
    branch.
  - The viewer build writes the stamp, so a hand-run `viewer:build` leaves it
    fresh.
  - The worktree exists only while the run stage is in range, not from
    before gather.
  - This repository's own `.gitignore` and `.dockerignore` list
    `/er-reviews/`, because Prettier reads only the root `.gitignore`.
  - The file view's no-hunks text changed for the hosted app too: it no
    longer mentions GitHub.
- **Found, not fixed:** a whole-file addition shows a red, empty original
  line opposite the added lines (the base side is `''`). Added to ER-14,
  whose `-0,0` case it is.
