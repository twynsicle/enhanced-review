# Phase 2 — Report build target

**Parent:** [00-overview.md](00-overview.md) (D2, D3, D11, D15, A5, A9, A11).
**Status:** done.

This phase produces `build/viewer/viewer.html`: one file holding the reader,
opened straight from disk. It renders an embedded `ReviewBundle` through the
Phase 1 seams. No CLI yet: bundles come from a committed sample, or from any
local JSON file.

## Design

**Entry** (`src/web/viewer/`, which sits in `web` for layering, so it may
import React and the narrative components but nothing `.server`):

- `index.html` is the page. Its body has
  `<script id="er-bundle" type="application/json"></script>`, the one
  placeholder both the dev server and the render stage fill. It has no
  pre-paint scripts: those exist in `root.tsx` for SSR, and the report renders
  on the client only, where `MantineProvider` applies the stored scheme in a
  layout effect before anything paints.
- `main.tsx` does `createRoot`, then `MantineProvider` with the app's `theme`,
  `cssVariablesResolver` and `colorSchemeManager`, then
  `RouterProvider(createHashRouter([...]))`. `theme.css` is imported, so fonts
  and base styles are the app's own.
- `viewer-page.tsx` reads and parses the placeholder once, then renders one of
  three things:
  - a valid bundle: `PageShell` → a slim header → `EmbeddedFileSource` →
    `ChapterReader` with `meta`, and no `actions`;
  - a version mismatch: "This report was made by a different version of
    enhanced-review. Regenerate it.";
  - invalid or missing data: an error page with the Zod message.
- The header is the app's `TopbarFrame` holding the brand mark, the
  colour-scheme toggle and the layout-width toggle, all existing components.
  It has no nav, user menu or notifications.

**Bundle in HTML** (`src/domain/review/bundle-html.ts`, pure strings, so the
CLI can import it in Phase 3):

- `injectBundle(html, bundle)` fills the placeholder. The JSON is escaped
  (`<` becomes `\u003c`), so a file containing `</script>` cannot break out.
- `readBundleText(doc)` is the inverse that the page uses.
- Both are unit-tested, including a `</script>` round trip.

**Build** (`vite.viewer.config.ts`, at the repo root):

- `root: src/web/viewer`, output to `build/viewer/`.
- No React Router framework plugin and no `@vitejs/plugin-react`: Vite 8's
  built-in transform handles TSX. In dev, an edit means a full page reload
  rather than Fast Refresh, which is fine for a static page.
- One JS chunk (`rolldownOptions.output.codeSplitting: false`): dynamic
  imports are inlined, including Monaco's wrapper and the diagram modal.
- `assetsInlineLimit` is effectively infinite, so fonts become data URIs
  (A11).
- A small local plugin inlines the emitted JS and CSS into `viewer.html` and
  deletes the separate files. It avoids a new dependency whose support for
  Vite 8 and Rolldown is unproven.
- Monaco keeps `@monaco-editor/react`'s CDN loader, unchanged (D3).

**Dev** (`npm run viewer:dev`): the same config in serve mode. A dev-only
`transformIndexHtml` hook fills the placeholder with the sample bundle, or
with the JSON file named by `ER_BUNDLE` (a root config, so it is outside the
`env-access` guardrail, like `vitest.config.ts`). Edits to the reader show up
on reload, with no Claude run (D15).

**Sample** (`src/web/viewer/sample-bundle.ts`, a refinement of A9):

- It is its own neutral fixture (`acme/widgets`), not `STUB_REVIEW`.
  `STUB_REVIEW` has no diff chunks, so it cannot exercise Monaco, and it is
  server-only.
- It covers:
  - a summary with an overview diagram and a description;
  - a risk assessment;
  - chapters with a sequence diagram and Monaco chunks for a modified, an added and a
    removed file;
  - a `too-large` file;
  - one chunk whose file the bundle lacks (the both-sides error);
  - a file list.
- Hunks are written by hand to match the synthetic contents.
- A test parses it with `parseBundle` and checks that every chunk's file is
  embedded, except the deliberate missing one.

**Gate:** `npm run check` runs `viewer:build` after `build`, so reader changes
that break the report fail the gate. `tsconfig.json` includes the new config.

## Commits

1. **Monaco from `file://` (proof).**
   - Adds `vite.viewer.config.ts` with the inlining plugin, a bare
     `index.html` + `main.tsx` (providers, hash data router, one
     `InlineDiffChunk` over a hard-coded `EmbeddedFileSource`), and the
     `viewer:dev` / `viewer:build` scripts.
   - Build it, open `build/viewer/viewer.html` from disk in Chrome and Edge,
     and check that the diff editor renders with add/delete decorations and
     that the page is a single file.
   - Record in this plan whether Monaco's workers started or fell back to the
     main thread.
   - If Monaco cannot render from `file://`, stop and switch to the fallback
     in overview §6 (serve on localhost) before going further.
   - _Result:_ it works, so no fallback is needed. The page is one 1.1 MB
     file (JS 449 kB, CSS with the inlined fonts 652 kB). From `file://`, in
     Chrome through Playwright and in headless Edge:
     - Monaco 0.55.1 loads from jsDelivr;
     - its two workers start as real `blob:null` workers, with no fallback to
       the main thread;
     - the diff shows add and delete decorations, with no console errors.

     The inlining moved out of `generateBundle` into `closeBundle`, after the
     write, because Rolldown's bundle object ignores `delete`.
2. **Sample bundle** and its test. (Swapped with the bundle-in-HTML step so the
   dev hook has a default to fall back on.)
3. **Bundle in HTML.** `bundle-html.ts` with tests, the placeholder, the dev
   hook with `ER_BUNDLE`, and the version-mismatch and invalid screens. The
   proof page's hard-coded bundle goes; the dev hook defaults to the sample.
   - _Result:_ the full reader renders from the sample in `viewer:dev` and
     from `file://`, including `#/?ch=` deep links, the too-large and missing
     states, and the mismatch screen. The shell is now 1.63 MB, with dagre,
     markdown and highlight.js inlined.
   - Found in passing: snippets misalign by one line around insertion-only
     and deletion-only hunks. This is shared reader code, so the hosted app
     has it too. Filed as ER-14 and not fixed here; the sample shows it in
     "Pausing and the due queue".
4. **Report page.**
   - `viewer-page.tsx` with the slim header, `ChapterReader` +
     `EmbeddedFileSource`, and the document title from the review.
   - The header is the app's own: `Topbar`'s frame is split out as
     `TopbarFrame`. The report fills it with a brand that is not a link and
     "Local review" on the left, and the width and scheme toggles on the
     right. It shows no title or repo, because the summary already carries
     both.
   - `check` gains `viewer:build`.
   - Map files: `web.md` (the `viewer/` entry), `AGENTS.md` (scripts table,
     layout line for `vite.viewer.config.ts`), and `container.md` if anything
     about `build/` changes.
   - The shell size (report minus review data) is recorded here.

## Verification

- `npm run check` is green after every commit.
- **Parity with the hosted reader.** A local, gitignored comparison bundle
  (`screenshots/tools/`) carries the seeded hosted review and the same file
  contents as `github-fixtures.ts`, with `meta` equal to what the hosted
  loader builds. `viewer.html` holding that bundle is captured from `file://`
  in the same five views, light and dark, at 1280 px. Only the reader region
  (`ChapterReader`'s grid) is compared, because the page chrome is
  deliberately different. Any pixel difference is explained or fixed, as in
  Phase 1.
- Keyboard navigation (`j`/`k`, and whatever `use-narrative-keyboard` binds),
  the `?ch=` / `?file=` deep links under `#`, and the browser back button are
  checked by hand in Chrome.
- Edge: one pass over the same views, looking for rendering differences
  rather than comparing hashes.

## Exit criteria

- `viewer.html` with the sample opens from disk in Chrome and Edge. It shows
  the summary, risk, chapters with Monaco diffs and diagrams, the file view,
  and the missing and too-large states, in light and dark.
- The reader region matches the hosted captures for the comparison bundle.
- A bundle with a different `schemaVersion` shows the regenerate screen.
- The shell size is recorded.

## Result

All exit criteria hold.

- **Parity.** The reader grid was captured from the hosted app and from
  `viewer.html` opened off disk, holding the hosted review's own loader data
  and the same file contents. 8 of 10 pairs are pixel-identical, Monaco diffs
  included. The two summary pairs differ only because the report has no
  Re-run button. Without it the eyebrow row is the caption's 17.6 px instead
  of the button's 32 px, so everything below sits 14.4 px higher. That is the
  intended consequence of an empty `actions` slot.
- **Hosted app unchanged.** It still hash-matches the Phase 1 `after`
  captures after the `TopbarFrame` split and the brand-mark move.
- **Navigation.** In Chrome from `file://`, these all work:
  - arrow keys, `End` and number keys;
  - back and forward;
  - file clicks;
  - reload on a `#/?file=` URL.
- **Edge.** Headless Edge renders the sample's summary, risk, both diff
  chapters and a file view from disk, in dark.
- **Shell size.** `viewer.html` without review data is 1.63 MB. It inlines
  React, Mantine, dagre, react-markdown, highlight.js and both variable
  fonts. Monaco, which loads from jsDelivr, is not included.
- **Found and fixed along the way:**
  - `BrandMark` pointed at `/brand-mark.svg` in `public/`, which a file on
    disk cannot reach. The SVG now sits beside the component and is imported,
    so the report inlines it.
  - `viewer:dev` shared Vite's dependency cache with the app's dev server.
    Each one re-optimised the other's dependencies, and the app answered 504
    until it restarted. The viewer now has its own `cacheDir`.
- **Found, not fixed:** ER-14, the off-by-one snippet alignment around
  zero-length hunks, in shared reader code.
