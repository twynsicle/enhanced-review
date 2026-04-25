# Phase 6 — Review reader UI

## Goal

Port the POC's narrative review UI — chapter cards, insight callouts, inline diff chunks, chapter navigation — to the webapp. Add the staleness badge and re-run flow. By the end, looking at a finished review feels at least as good as the Electron POC.

## Demoable at end

- A `done` review renders in chapter format with insights and inline diffs, matching POC quality.
- Chapter navigation (keyboard `←/→`, `Home/End`, `1–9`; sidebar list) works.
- Inline diff chunks render with syntax highlighting.
- A "PR has new commits since this review" badge appears when the PR's current HEAD differs from the review's pinned `head_sha`.
- Clicking "Re-run" creates a new `review_jobs` row at the latest SHA and navigates to it. The old review remains in history.
- The `/history` page shows reviews from all beta members, with target + author + status.

## Tasks

1. **Port shared narrative components** from `diffy/src/renderer/screens/narrative-review/`:
   - `ChapterCard`, `ChapterNav`, `ChapterNavBar`, `SummaryCard`, `PrSummary`, `InsightCallout`, `InlineDiffChunk`, `MarkdownText`.
   - Drop the Electron-specific ones (`SourceSelect`, `PrInput`, `GeneratingOverlay`, `RawResponseModal`, `NarrativeToolbar`) — Phase 2 + Phase 5 already cover their replacements.
   - Adapt CSS Modules → whatever styling system Phase 1 chose.

2. **Diff viewer for inline chunks** — Monaco is heavy for the web; consider [`@git-diff-view/react`](https://github.com/MrWangJustToDo/git-diff-view) or a simple custom diff renderer. Decide during planning. Must support the same `InlineDiffChunk` shape as the POC.

3. **Chapter keyboard navigation hook** — port `use-narrative-keyboard.ts`. Web-friendly modifiers (no `Cmd`).

4. **`/reviews/:id` page** — fetches `reviews` row + associated job; renders chapters. Shared layout with the in-progress `/jobs/:id` page so the transition from streaming → rendered is seamless.

5. **Staleness badge**:
   - Server-side: when rendering a review for a PR target, fetch the PR's current head SHA from GitHub.
   - If `pr.head.sha !== review.head_sha`, render a badge: "PR has 3 new commits since this review · Re-run".
   - Badge links to the re-run flow.

6. **Re-run flow** — button creates a new `review_jobs` row at the _current_ HEAD SHA (resolved fresh from GitHub) and navigates to `/jobs/:newId`.

7. **History list** — `/history` page enriched: target title, requester avatar, status pill, created/completed timestamps, link to review.

8. **Empty / error states** — review failed to parse, opencode errored, cancelled mid-flight (show partial output if any).

9. **Workspace-visibility cues** — show "Reviewed by @alice" so it's clear which reviews are yours vs others'.

## Out of scope (deferred)

- Inline commenting on review chunks.
- Posting a chapter back to the GitHub PR as a comment (originally rejected; revisit in a later milestone if wanted).
- Diff between two consecutive reviews of the same PR.

## Open questions

- **Web diff viewer choice** — Monaco (heavy, exact POC parity) vs git-diff-view (lighter, web-native) vs a hand-rolled component (most control, most work). Pick during planning.
- **Markdown rendering** — `react-markdown` + `rehype-highlight`? Match POC's `MarkdownText` behavior. Decide which features (tables, GFM, math) are required.
- **Workspace visibility UX** — should other users' reviews look visually distinct? Or do we just show "by @alice" in the header? Cheap UX choice, low stakes.
