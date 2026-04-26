# Phase 6 — Review reader UI

## Goal

Port the POC's narrative review UI — chapter cards, insight callouts, inline diff chunks, chapter navigation — to the webapp. Add the staleness badge and re-run flow. By the end, looking at a finished review feels at least as good as the Electron POC.

## Demoable at end

- A `done` review renders in chapter format with insights and inline diffs, matching POC quality.
- Chapter navigation (keyboard `←/→`, `Home/End`, `1–9`; sidebar list) works.
- Inline diff chunks render with syntax highlighting via Monaco.
- A "PR has new commits since this review" badge appears when the target's current HEAD differs from the review's pinned `head_sha` (works for both PR and branch targets).
- Clicking "Re-run" creates a new `review_jobs` row at the latest SHA and navigates to it. The old review remains in history.
- The `/history` page shows reviews from all beta members, with target + author + avatar + status.
- A `diff_truncated=true` review surfaces a prominent "Diff was truncated" banner.
- Viewing a review for a repo you don't have access to renders the chapters/insights/markdown plus a per-chunk "no access" notice instead of broken inline diffs.

## Decisions (resolved during discussion)

| Topic                  | Decision |
| ---------------------- | -------- |
| Diff source            | Re-fetch base + head file blobs from GitHub at view time using the **viewer's** OAuth token. No persisted blobs. 403/404 falls back to a per-chunk "no access" notice; chapters/insights/markdown still render. |
| Diff viewer            | Monaco `DiffEditor`, full POC parity (side-by-side, `hideUnchangedRegions`, per-snippet line-number offsets, "Show Full File" toggle). Loaded via dynamic import + `next/dynamic` so SSR doesn't try to render it. |
| Markdown               | `react-markdown` + `remark-gfm` + `rehype-highlight`. Replaces the POC's hand-rolled parser. GFM tables/task lists/strikethrough supported. Default sanitization (no `rehype-raw`). |
| Chapter state          | URL search param `?ch=<id>`. Deep-linkable, browser back/forward navigates between chapters, refresh keeps you in place. Default (no `ch`) lands on the synthesised summary section. |
| Chapter nav layout     | Sidebar list of chapter titles on the left; main column on the right. Active chapter highlighted. The POC's top `ChapterNavBar` (Prev/Next + counter) is dropped. |
| PR / branch metadata   | Re-fetched from GitHub at view time (`GET /repos/{o}/{r}/pulls/{n}` + `…/files` for PRs; compare API for branches). Powers the SummaryCard (title, author, base/head ref, file count, +/− line counts, body). Same graceful-fallback rules as the diff fetch. |
| Truncation banner      | Prominent yellow banner at the top of `/reviews/:id` when `reviews.diff_truncated=true`. Text: "Diff was truncated to fit the token budget — some files may not be in the review." |
| Re-run UX              | Persistent Re-run button in the header (always available on a `done` review) **and** a separate Re-run CTA inside the staleness banner. Both call the same endpoint. |
| Staleness check        | PR targets: compare against `pull.head.sha`. Branch targets: compare against `branch.commit.sha`. If different, show "{N} new commits since this review" with a link to re-run. The N is computed via the GitHub compare API (`compare/{review.head_sha}...{current.head_sha}`). |
| `/reviews/:id` URL     | `:id` is the **`review_jobs.id`** (preserves the `/jobs/:id` → `/reviews/:id` link Phase 5 wired in). The page joins to `reviews where job_id=:id`. |
| Re-run target URL      | New job's `/jobs/:newId` (consistent with the POST /api/jobs response Phase 3 already returns). |
| Workspace cue          | `@author` chip on the SummaryCard and history rows. No visual differentiation between yours and others'. |
| Avatars                | `https://github.com/{login}.png` (no API call, browser-cached). `<Image>` with `unoptimized` to avoid Next.js image-optimisation overhead for tiny avatars. Failed loads degrade to initials. |
| Cancelled/errored jobs | `/reviews/:id` only renders when a `reviews` row exists (i.e., status=done). Cancelled/error users stay on `/jobs/:id`, which Phase 5 already covers (frozen chapter checklist + error message + partial-output preserved). 404 from `/reviews/:id` for non-done jobs links back to `/jobs/:id`. |
| GitHub data caching    | Server-side: `fetch(url, { next: { revalidate: 30 } })` for read-only GitHub calls so refreshes don't pound the API. Per-request, not cross-user — tokens are user-specific and cache keys include the auth header. |

## Tasks

1. **Port shared narrative components** from `diffy/src/renderer/screens/narrative-review/`:
   - `ChapterCard`, `SummaryCard`, `InsightCallout`, `InlineDiffChunk` — adapt `chunk.hunks` shape, drop Electron `window.api` calls.
   - **Drop** the POC's `MarkdownText` in favour of `react-markdown`. Keep the import-site name (`MarkdownText`) as a thin wrapper so future changes are isolated.
   - **Drop** Electron-only / replaced components: `SourceSelect`, `PrInput`, `GeneratingOverlay`, `RawResponseModal`, `NarrativeToolbar`, `ChapterNav`, `ChapterNavBar`, `NarrativeView`, `NarrativeShell` — Phase 2 + Phase 5 already cover their replacements; the new sidebar nav + `/reviews/:id` page replace the rest.
   - Convert CSS Modules → Tailwind utility classes (matches Phase 1's chosen styling).

2. **Monaco diff viewer integration** — wrap `@monaco-editor/react`'s `DiffEditor` in a client component loaded via `next/dynamic({ ssr: false })`. Port `inline-diff-snippets.ts` and `inline-diff-snippets.test.ts` as-is (it's pure logic). Keep the snippet line-offset, "show changes only / show full file" toggle, and `hideUnchangedRegions` config from the POC.

3. **GitHub view-time data layer** — new file `src/lib/github/view-time.ts`:
   - `getFileAtRef({ owner, repo, path, ref, token })` — fetch base/head blob via `GET /repos/{o}/{r}/contents/{path}?ref={sha}`. Return `{ ok: true, original, modified, originalLineCount, modifiedLineCount, language }` matching the POC's `FileAtRefResult` shape. Returns `{ ok: false, error: 'no-access' | 'not-found' | 'rate-limited' | 'unknown' }` on failure.
   - `getPullMetadata({ owner, repo, number, token })` — returns the data the SummaryCard needs.
   - `getBranchHead({ owner, repo, ref, token })` — returns `{ sha, commitsAhead }` for the staleness check.
   - All helpers use `fetch` with `Authorization: Bearer ${token}`, `next: { revalidate: 30 }`, and `Accept: application/vnd.github+json`.

4. **`InlineDiffChunk` rewrite** — replace the POC's `window.api.getFileAtRef` call with a `useEffect` that hits a server route `GET /api/github/file?owner=…&repo=…&path=…&ref=…`. Server route reads the viewer's session token via `@supabase/ssr` and proxies to GitHub (so the token never reaches the browser). 403/404 → render the same "Diff for {filename}" header but with a "You don't have access to this repo on GitHub" body in place of the editor.

5. **Chapter keyboard navigation hook** — port `use-narrative-keyboard.ts` to drive URL state instead of Redux dispatch. Web-friendly modifiers (no `Cmd`). Keep the same key bindings (`←/→`, `Space`, `Home`/`End`, `1–9`).

6. **Sidebar chapter nav** — new component `ChapterSidebar`. Vertical list of `[Summary, ...chapters]`. Active item highlighted. Click sets `?ch=<id>`. Sticky at viewport top so long chapters don't scroll the nav off-screen.

7. **`/reviews/:id` page** —
   - Server component fetches `review_jobs` + joined `reviews` row (RLS already lets workspace members read both). If no row, 404.
   - Hydrates a client component with the `NarrativeReview` content, the active chapter id parsed from `?ch`, the viewer's session, and the `target`.
   - Client component fires the GitHub view-time fetches (PR metadata, branch head, file blobs as chapters render).
   - Layout: sticky sidebar (chapter list) + main column (SummaryCard or active ChapterCard) + persistent header (target, @author chip, status, Re-run button).

8. **Staleness badge**:
   - Server-side, in the `/reviews/:id` page: call `getBranchHead` (branch target) or `getPullMetadata` (PR target) and pass `currentHeadSha + commitsAhead` to the client.
   - Client renders the banner above the SummaryCard when `currentHeadSha !== review.head_sha`. Text: "{N} new commit{s} since this review · Re-run".
   - On `getBranchHead`/`getPullMetadata` failure (no access etc.), suppress the banner silently — the user can't act on it anyway.

9. **Re-run flow** — new `POST /api/jobs/:id/rerun`:
   - Looks up the source job, copies `target`, resolves a fresh `head_sha` from GitHub, and inserts a new `review_jobs` row owned by the current viewer (not the original requester).
   - Returns `{ id }` of the new job; client navigates to `/jobs/:newId`.
   - Wired to both the persistent header button and the staleness banner CTA.

10. **Truncation banner** — when `reviews.diff_truncated=true`, render a prominent yellow banner at the top of the page: "Diff was truncated to fit the token budget — some files may not be included in this review."

11. **History list enrichment** — `/history` page:
    - Add `<img src="https://github.com/{login}.png" />` to each row (rendered via `next/image` with `unoptimized`).
    - Add the existing `target` description, status pill, created/completed timestamps, link to `/jobs/:id` (running) or `/reviews/:id` (done).
    - Keep the existing status filter chips.

12. **Empty / error states** —
    - `/reviews/:id` 404 page links back to `/jobs/:id` ("This review hasn't finished yet — see the live job →") if the job exists.
    - Per-chunk "no access" body when the GitHub blob fetch 403/404s.
    - Per-chunk error body if the blob fetch errors otherwise (with retry button).

## Out of scope (deferred)

- Inline commenting on review chunks.
- Posting a chapter back to the GitHub PR as a comment.
- Diff between two consecutive reviews of the same PR.
- Persisting file blobs server-side (re-fetching at view time was chosen to avoid the storage cost; if rate limits or access loss become real pain points, Phase 7 can revisit).
- Advanced markdown features beyond what `remark-gfm` covers (e.g. math, mermaid).

## Tests

- **Frontend unit tests** (Vitest):
  - `inline-diff-snippets.test.ts` — ported wholesale from the POC.
  - `view-time.test.ts` — `getFileAtRef`, `getPullMetadata`, `getBranchHead` happy + 403/404/rate-limit paths (msw-style fetch mocks).
  - `use-narrative-keyboard.test.tsx` — `←/→/Home/End/1–9` updates `?ch=`; ignores keys when focus is in input/textarea.
- **Component smoke tests**:
  - `ChapterSidebar` — active highlight follows `?ch=`; clicks update URL.
  - `InlineDiffChunk` — renders Monaco when fetch resolves; renders "no access" body on 403; renders error body on other failures.
- **API route tests**:
  - `GET /api/github/file` — proxies token correctly; returns 401 when no session; returns 403 when GitHub returns 403.
  - `POST /api/jobs/:id/rerun` — creates a new job at a fresh SHA; copies target; rejects when source job target is not visible to caller.

## Risks

- **Monaco bundle weight.** `@monaco-editor/react` ships ~3MB gzip. Lazy-load it from the chapter card only (not on the page shell) so a `done` review with an empty chapter list still loads fast. If real-world load times suffer, Phase 7 can swap to `git-diff-view` — the `InlineDiffChunk` API surface is small.
- **GitHub rate limits.** Authenticated user tokens get 5000/hr. A multi-chapter review with many files could spend dozens of requests on a single page render. The 30-second `revalidate` cache amortises refreshes, and Monaco's lazy mount means only mounted chunks fetch. If real users hit 429s, add a per-request `If-None-Match` ETag flow and/or a server-side LRU.
- **Token availability for non-owner viewers.** Workspace visibility means alice may try to read a review bob ran on a private repo alice can't access. The "no access" fallback handles this for inline diffs, but the SummaryCard data also disappears. Acceptable for closed beta; revisit if it becomes a real annoyance.
- **react-markdown vs POC behavioural drift.** The POC parser was minimal; `react-markdown` is more permissive. Some opencode markdown edge cases (un-closed code fences, oddball list indentation) may render differently. Capture a handful of real `overviewSummary` and `insight.text` strings from Phase 4 runs as snapshot test fixtures.
- **Chapter id stability.** URL `?ch=<id>` assumes opencode emits stable chapter ids. The POC parser does generate them; if a re-run changes ids, deep links from history rot silently. Acceptable — history rows link to `/reviews/:id`, not to a specific chapter.
