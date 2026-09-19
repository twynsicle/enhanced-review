# Cut the repo to the `er` CLI — plan of plans (ER-36)

Transient: delete this file in the last commit of the branch. No comment in the
code may cite it.

## Goal

The repo contains only `er` and the report it writes. The hosted app (Express,
React Router framework, Postgres, GitHub OAuth, the job runner, Docker) goes;
it stays reachable at the tag `hosted-app-final`. One branch, one PR, two
commits: a pure deletion, then a restructure that strips the dead code the
deletion leaves behind.

## Decisions (locked)

| #   | Decision                                                                                                                                                                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | The hosted app is preserved by the annotated tag `hosted-app-final` on the last hosted commit of `main`, not by a branch.                                                                                                                                                                                                                    |
| D2  | React Router goes entirely. The report reads `?ch=` / `?file=` from the hash through a small hook, `FileSource` becomes a plain context with no fetcher, and a React error boundary replaces `errorElement`.                                                                                                                                 |
| D3  | Two commits: **(1) delete** — remove every file the CLI and report cannot reach, plus the minimum edits to keep the gate green; **(2) restructure** — new layout, dead code inside kept modules removed, guardrails and docs rewritten.                                                                                                      |
| D4  | Layout after commit 2: `src/cli/` (all Node-only code), `src/review/` (the browser-safe review model: narrative, bundle, coverage, diagram, findings, prompt building and parsing), `src/report/` (the React app: entry, reader, diagram, theme, stores), `src/test/`, `src/guardrails/`. `common/` and `config/` dissolve into their users. |
| D5  | Node-only code is marked by folder, not suffix: it lives in `src/cli/`. `.server.ts` disappears. A guardrail keeps `src/review` and `src/report` off `node:` builtins, the Agent SDK and `src/cli`.                                                                                                                                          |
| D6  | `dependencies` = what `er` needs to run and to build the report; `devDependencies` = test, lint, format, types.                                                                                                                                                                                                                              |
| D7  | No UI regression, proven by before/after screenshots of the report at each commit.                                                                                                                                                                                                                                                           |
| D8  | The Monaco CDN load stays as it is; it is called out for the security review, not changed here.                                                                                                                                                                                                                                              |

## Assumptions

| #   | Assumption                                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | `er` stays installed by clone + `npm install` + `npm link`; distribution is out of scope.                                                                                          |
| A2  | What the model sees does not change: a `--stub` run's `system.md`, `prompt.md`, `context.json`, `review.json` and `findings.json` are byte-identical before and after each commit. |
| A3  | The report's localStorage keys are unchanged, so a reader's stored preferences survive.                                                                                            |
| A4  | The hosted-only prompt path (`buildNarrativePrompt`, `SERVER_WORKING_TREE`, the inline-diff delivery and its fixture) goes; the local prompt is untouched.                         |
| A5  | The integration Vitest project goes (its only tests are the db and hosted-run ones); CI runs `npm run check` with no Postgres service.                                             |
| A6  | Backlog items written for the hosted app (ER-10, ER-12) carry the Linear label `Hosted only`; the `linear` skill names that label.                                                 |

## Phases

Each phase gets its own just-in-time plan section below before it starts.

### P0 — Baselines

- Screenshots of the report from `viewer:dev` (port 5181) on the sample bundle,
  via headless Chrome to files under `screenshots/baseline/`: light and dark ×
  summary, a chapter with an insight, a judgement call, a diagram, the file
  view, an open diff (split), the file tree sidebar, the report-problem page.
- A `--stub` run of `er review` against a throwaway repo; keep its run folder
  as the A2 reference.

**Exit:** baseline files on disk; the stub run folder saved outside the repo.

### P1 — Delete (commit 1)

Remove what the closure of `src/cli/er.ts` + `src/web/viewer/main.tsx` +
`vite.viewer.config.ts` does not reach, and the infrastructure around it.
Minimal edits only: split `topbar.tsx` so the report keeps `TopbarFrame` /
`StaticBrand`; retarget guardrails that name deleted areas; fix
`comment-paths` hits; trim `vitest.config.ts`, CI, `package.json`, scripts,
`.claude/launch.json`; update AGENTS.md and the rule files enough to be true.

**Exit:** `npm run check` green with no `.env`; A2 holds; screenshots match
baseline; no `express`, `prisma`, `pg`, `pino`, `remix-auth*`, `@octokit/*`,
`@react-router/*` in `package.json`.

### P2 — Restructure and strip (commit 2)

Moves per D4/D5, React Router out per D2, dead code out of kept modules
(GitHub file source, `findings` prop and `FindingsNotice` if unreachable,
`actions` prop, `useHydrated` / `skipHydration` residue, hosted prompt path,
`GithubResult` naming in `bundle.ts`), guardrails rewritten for the new
areas, dependency split per D6, viewer stamp inputs updated, README / AGENTS.md
/ `.claude/rules` rewritten for a CLI-only repo.

**Exit:** as P1, plus: no `react-router` dependency; no `.server.ts` files;
every guardrail passes against the new layout; docs describe only the CLI.

#### P2 plan (just-in-time)

**Status of P0/P1.** P0 done: 16 baseline views (8 × light/dark), captured
stably (Monaco cursor/scrollbars hidden, animations off, waits for every diff
editor), and a reference `--stub` run. P1 done: 174 files deleted, gate green,
A2 holds, all 16 views pixel-identical to baseline.

**File moves.**

| From                                                                                                                                                               | To                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| `domain/review/clone/{git-runner,diff-files}.server.ts`, `executor/{sdk-loop,validation-stop-hook}.server.ts`, `skip-reasons.server.ts`, `config/host-env.ts`      | `cli/` (suffix dropped)                               |
| `domain/review/{narrative,diagram,findings,coverage,validate-review,bundle,bundle-html,review-meta,language-map}.ts`, `domain/review/prompt/*`, `common/plural.ts` | `review/` (prompt/ kept as a subfolder)               |
| `domain/github/types.ts`                                                                                                                                           | folded into `review/bundle.ts` under names of its own |
| `web/viewer/*`                                                                                                                                                     | `report/` root (`viewer-page` → `report-page`)        |
| `web/components/narrative/*` (+ `domain/review/inline-diff-snippets.ts`)                                                                                           | `report/reader/`                                      |
| `web/components/narrative/diagram/*`                                                                                                                               | `report/diagram/`                                     |
| `web/components/{topbar/*,page-shell,brand-mark*,caption}`                                                                                                         | `report/chrome/`                                      |
| `web/{stores,theme,test}/*`                                                                                                                                        | `report/{stores,theme,test}/`                         |

**D9 (new): "viewer" becomes "report" everywhere.** `vite.viewer.config.ts` →
`vite.config.ts` (the only Vite config left); scripts `report:dev` /
`report:build`; output `build/report/shell.html` + its stamp;
`viewer-stamp.ts` → `shell-stamp.ts`; `viewerShell` → `reportShell`; the
terminal line says "report shell". `.claude/launch.json` entries renamed
`report-5180/5181/5182`.

**React Router out (D2).** A `useHashParams` hook over `location.hash`
(`#/?ch=…&file=…`, same URLs as today) via `useSyncExternalStore`, listening to
`popstate`/`hashchange` and notified on its own `pushState`; no scroll
reset, as `preventScrollReset` gave. `FileSource` → a plain context of the
embedded pairs (no fetcher, no GitHub kind). A class error boundary renders
`ReportCrashed`. Tests drop `createRoutesStub`; the render helper sets the
hash where a test needs `?ch=`/`?file=`.

**Dead code to remove** (each confirmed unused after the moves): `findings`
prop + `FindingsNotice`; `actions` slot; `useHydrated` and the `hydrated`
branches; `github-api.ts`; `describeError`/`GithubError` handling in
`inline-diff-chunk` beyond the missing-file case the bundle can produce;
`reviewMetaFromJob` + `target.ts` if only it used them;
`buildNarrativePrompt`, `SERVER_WORKING_TREE`, `PrData`, the server-prompt
fixture and their tests; git-runner options only the hosted clone used; any
export an unused-export scan finds with no importer. `skipHydration` / `bind*`
on the stores stay unless the screenshots prove removing them changes
nothing: they decide what is painted on the first frame.

**Guardrails.** `layering` rewritten for `cli → review`, `report → review`,
`review →` nothing but itself; `review` and `report` barred from `node:`
builtins, the Agent SDK and `cli`; only `report` may import React/Mantine.
`server-only` deleted (folder-based now). `env-access` → `process.env` only in
`cli/host-env.ts`. `cli-imports` keeps only the SDK-is-type-only-or-dynamic
rule. Palette, diagram-colour, comment-paths, monaco-version: paths updated.
Vitest projects `unit` (cli + review, node) and `report` (happy-dom).

**Dependencies (D6).** `dependencies`: the SDK, zod, react, react-dom,
`@mantine/{core,hooks}`, zustand, react-markdown, remark-gfm,
rehype-highlight, highlight.js, `@monaco-editor/react`, `@tabler/icons-react`,
`@dagrejs/dagre`, `@fontsource-variable/*`, vite, postcss presets — `er`
rebuilds the report shell on the engineer's machine, so the build is runtime.
`devDependencies`: typescript, `@types/*`, `monaco-editor` (types only),
vitest, happy-dom, testing-library, oxlint, prettier.

**Docs.** README rewritten for the CLI. AGENTS.md layout/layering/
conventions for the new tree. Rules: `web.md` → `report.md`,
`review-pipeline.md` → `review.md`, `cli.md` gains the moved files,
`design-system.md` paths updated.

**Verification.** Gate green; A2 holds (terminal lines may change, the run
folder may not); all 16 views pixel-identical to baseline; `er review` on the
fixture opens and navigates (`?ch=`, `?file=`, back/forward) in the built
`review.html` from `file://`.

### P3 — PR

Push (on approval), open the PR with `Fixes ER-36`, before/after screenshots
on the issue, issue to In Review. Delete this file in the last commit.
