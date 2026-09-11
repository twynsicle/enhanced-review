# Phase 1 — Bundle contract + reader seams

**Parent:** [00-overview.md](00-overview.md) (D2, D11, A6). **Status:** in progress.

The reader has four ties to its environment: file reads, the PR header, the
rerun button and URL state. This phase cuts the first three so the same
components can later render from an embedded bundle, and defines the bundle
itself. **The hosted app must look and behave exactly as it does now.**

## Where the ties are today

| Tie        | Where                                                                                                                                                                          | After this phase                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| File reads | `InlineDiffChunk` calls `useFetcher` on `/api/github/file`; `owner/repo/baseRef/headRef` are threaded through `ChapterReader` → `ChapterCard` / `FileView` → `InlineDiffChunk` | A `FileSource` context. The components stop carrying repo and ref props |
| PR header  | `SummaryCard` reads `ReviewTarget` + `PullMetadata` + `byline`, and derives title, refs, author and PR number itself                                                           | `SummaryCard` reads one `ReviewMeta`; the hosted loader builds it       |
| Rerun      | `ChapterReader` renders `<RerunButton jobId>` itself                                                                                                                           | An `actions` slot; the route passes the button                          |
| URL state  | `ChapterReader` uses `useSearchParams`                                                                                                                                         | Unchanged: the report wraps the reader in a hash router (A5, Phase 2)   |

## Design

**`ReviewMeta`** (`src/domain/review/review-meta.ts`, browser-safe Zod):
`repo` (display label, e.g. `owner/name`), `title` (used when the review has
no `prTitle`), `prNumber`, `baseRefName`, `headRefName`, `authorLogin`,
`description`, and `stats` (`changedFiles`, `additions`, `deletions`; used only
when `review.files` is empty). Every field except `repo` and `title` is
nullable. `reviewMetaFromJob(target, pullMetadata, jobAuthor)` reproduces
exactly the fallbacks `SummaryCard` computes today, and moves them into a
unit-tested function.

**`ReviewBundle`** (`src/domain/review/bundle.ts`, browser-safe Zod):
`schemaVersion: 1`, `generatedAt`, `meta: ReviewMeta`,
`review: NarrativeReview`, and `files`, a record mapping a path to
`{ base, head }`. Each side is `{ kind: 'content', content }`,
`{ kind: 'absent' }` or `{ kind: 'too-large' }`. `parseBundle(unknown)` returns
either the bundle or a typed `version-mismatch` / `invalid` failure. `filePair(bundle, path)` turns the
embedded sides into the same `{ base, head }` of `GithubResult<FileAtRef>` that
the GitHub route returns: `absent` becomes `not-found`, language comes from
`detectLanguage`, and the line count is computed. A path the bundle does not
hold becomes `not-found` on both sides.

**`FileSource`** (`src/web/components/narrative/file-source.tsx`): a context
carrying a `useFilePair(path)` hook. The hook returns `{ base, head }`, or
`undefined` while loading. The provider fixes it once, so the order of hook
calls never changes between renders.

- `GithubFileSource({ owner, repo, baseRef, headRef })`: today's
  `useFetcher` + effect, moved out of `InlineDiffChunk` without changing
  behaviour.
- `EmbeddedFileSource({ bundle })`: a synchronous `filePair` lookup, with no
  hooks.

`InlineDiffChunk` keeps `resolveFileState` and everything downstream of it.
Only the source of the pair changes.

**`ChapterReader` props** become `review`, `meta`, `initialActiveId` and
`actions?`. The route wraps it in `GithubFileSource`, builds `meta` in the
loader, and passes `<RerunButton jobId>` as `actions`.

**One deliberate text change.** When a file is missing on both sides, the
message becomes source-neutral: "This file isn't available at either commit".
It used to say GitHub returned 404. Nothing else visible changes.

## Commits

1. **`ReviewMeta` + `reviewMetaFromJob`**, with unit tests covering the PR
   target, the branch target, missing `pullMetadata`, and the title fallback
   order. No consumers yet.
2. **`ReviewBundle` + `parseBundle` + `filePair`**, with unit tests covering
   round-trip, version mismatch, `absent` → `not-found`, `too-large`, and an
   unknown path.
3. **Baselines.** Capture the hosted reader on the current code: summary,
   risk, chapter 1 with Monaco diffs, a file view, and a both-sides-404 diff,
   in light and dark at 1280 px. Files go to
   `screenshots/local-mode/phase-1/before/`, which is gitignored; nothing is
   committed.
4. **`FileSource` seam.** Add the context and both providers. `InlineDiffChunk`
   reads the context. `ChapterCard`, `FileView` and `ChapterReader` drop their
   repo and ref props. The route wraps the reader in `GithubFileSource`.
   `inline-diff-chunk.test.tsx` runs the same cases through both providers.
5. **`SummaryCard` on `ReviewMeta`, plus the `actions` slot.** The loader
   returns `meta`, `ChapterReader` takes `meta` and `actions`, and
   `summary-card.test.tsx` moves to `ReviewMeta`. `web.md` in
   `.claude/rules/` is updated for the new files and seams.

## Verification

- `npm run check` is green after every commit.
- After commit 5, the step-3 captures are retaken into `after/`. Pairs are
  compared by pixel hash; any pair that differs gets a side-by-side composite
  and is explained or fixed. The both-404 message is the only expected
  difference.
- The dev server (`web-3001`) runs the reader against a seeded done review
  (`screenshots/tools/dev-session.ts --mint --seed-done`) with
  `/api/github/file` mocked, as in earlier phases.

## Exit criteria

- The hosted reader matches its baselines, apart from the one intended message
  change.
- The reader tests pass against both a GitHub-backed and an embedded
  `FileSource`.
- No narrative component imports `ReviewTarget`, `PullMetadata`, or anything
  under `jobs/`.
