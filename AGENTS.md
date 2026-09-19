# Repo orientation for agents

`er`, a local AI code-review CLI. Run inside a repository, it reviews the
current branch, a pull request or the staged changes with the Claude Agent SDK
and writes a chaptered narrative review as one self-contained `review.html`.
Successor to the diffy POC. An earlier hosted web app was removed from this
tree; it is kept at the git tag `hosted-app-final`.

This file is the map of the tree for anyone changing it, cut to what every
change needs. The detail for each area lives beside it (see "Where the rest
lives"). `README.md` is the product-and-setup document.

Library APIs here (React Router 8, Mantine 9, Vite 8, Vitest 4, Zod 4,
TypeScript 7, oxlint, the Claude Agent SDK) may be newer than your training
data. Check the package's docs in `node_modules/<pkg>` or the current online
docs before writing code against them; heed deprecation notices.

## Tech stack

- Node 24 (Volta-pinned, `engines >=24`). `er` runs TypeScript directly via
  Node's type stripping — no build step for `src/cli/`.
- The report is a client-rendered React 19 page built by Vite 8 into one
  inlined HTML file; React Router 8 (library only) gives it a hash data
  router. Mantine 9 (core/hooks), Tabler icons, Zustand for persisted reader
  preferences, Zod 4 at every boundary. Monaco loads from a CDN at runtime.
- TypeScript 7 (native compiler) strict, `verbatimModuleSyntax`,
  `erasableSyntaxOnly`. Linting is **oxlint** (`.oxlintrc.json`) — TS 7 has
  no JS API, so typescript-eslint cannot run against it. Prettier formats.
- Vitest 4 projects: `unit` (node), `web` (happy-dom), `guardrails`
  (repo-reading convention tests).

## Repo layout

```
vite.viewer.config.ts  the report: src/web/viewer/ → one build/viewer/viewer.html, all inlined but Monaco
src/
  cli/                 `er`, the local review CLI: the package `bin`, put on PATH by `npm link`;
                       runs in the repo under review
  domain/              the review model, shared by `er` and the report; *.server.ts marks the Node-only modules
    github/            types.ts (result and file shapes the bundle reuses)
    review/            narrative + diagram schemas, bundle, coverage, findings, validation; clone/ (git runner,
                       changed files), prompt/, executor/ (the SDK loop and the validation Stop hook)
  common/              plural.ts
  config/              host-env.ts — hostEnv()/pickHostEnv(), the only process.env reader
  guardrails/          *.guard.test.ts — layering, env-access, no-console, server-only, palette (token contrast,
                       type scale, one label), diagram-colour (SVG takes token() only), cli-imports (the SDK
                       imported only where a run happens), comment-paths (a repo path named in a comment still
                       exists — see Comments), monaco-version (the Monaco the reader loads is the one it is
                       typechecked against)
  test/                git-repo.ts (a throwaway repository with a bare origin, for tests that drive real git)
  web/                 the report's React code: components/ (the reader), stores/ (Zustand, persisted), theme/,
                       lib/, viewer/ (the page entry), test/
.github/workflows/ci.yml  npm ci → npm run check
.claude/rules/         area detail, loaded when you open a file in that area (see below)
.claude/skills/        workflows loaded on demand (see below)
```

Layering (enforced by `src/guardrails`): `web → domain, common, config`;
`domain → common, config`; `cli → domain, common, config`;
`common → config`; `config` imports nothing from `src/`. Only `src/web/` may
import React or `react-router`. `config` is Node-only; `domain` is **shared**
between Node and the browser, and a domain module that imports `config`, a
`node:` builtin, the Claude SDK or another `.server` module must be named
`*.server.ts` — rule of thumb: name it `.server.ts` unless the browser is
meant to import it. Nothing in `web` may import a `.server` module.

## Where the rest lives

Each file in `.claude/rules/` declares `paths:` globs, and Claude Code loads it
the first time you read a matching file. Other tools and people can open them
directly.

- `web.md` — file-by-file map of `src/web/`. Loads for `src/web/**`.
- `design-system.md` — type scale, the one label, the reading measure, page
  width, colour tokens and contrast. Loads for components, CSS, the theme and
  the colour guardrails.
- `review-pipeline.md` — file-by-file map of `src/domain/` and how an answer
  is validated. Loads for `src/domain/**`.
- `cli.md` — file-by-file map of `src/cli/` (`er review` and its stages).
  Loads for `src/cli/**` and `vite.viewer.config.ts`.

Skills in `.claude/skills/`, loaded when the task calls for them:

- `linear` — the Linear workflow for bug and feature work (see Task tracking).

## Conventions

- Path alias `@/*` → `src/*` is used in `src/web/` (bundled by Vite).
  Everything Node loads natively — `src/cli`, `src/config`, `src/common`,
  `src/domain` — uses relative imports with explicit `.ts` extensions.
- `process.env` is read only in `src/config`. Code that spawns a subprocess
  gets the environment from `src/config/host-env.ts`.
- No barrel `index.ts` files. Import the module you need
  (`@/web/theme/theme`, not `@/web/theme`).
- **Fail loudly on a review.** Prefer failing to generate a review over
  shipping one that is incomplete or misleading — never patch over a
  generation defect by silently dropping or hiding part of the model's
  answer. If a check downstream of the model finds the answer doesn't hold up
  (e.g. a chapter with nothing to show for it, in `parse-narrative.ts`), the
  right move is to fail the whole review, not to quietly repair it into
  something that looks fine. A human sees a failed run and knows to look; a
  silently-repaired review looks trustworthy and isn't.
- **There is no backwards compatibility here, and nothing should be written as
  though there were.** The only part of this app anywhere near real use is
  `er`'s report generation, and that is stateless: a report is generated,
  read and thrown away. Nothing has to keep reading data an older version
  wrote. So when a shape changes, change it — do not accept the old shape
  beside the new one, do not add a field-was-a-string branch, do not keep a
  fallback for a key a previous prompt used, do not leave a type optional to
  spare data that no longer exists. Delete the old shape and fix every caller.
  Simple code a reader can follow in one pass is worth far more than
  compatibility with a past that cannot reach us. If a comment justifies
  something by appeal to "older reviews" or "older model output", that
  justification is void and the code it guards should go. Leniency toward the
  _model's_ output is a separate and still-live concern — a model is a
  nondeterministic producer, and being forgiving about what it sends back is
  not backwards compatibility. Say which one a comment means.

## Comments

- A comment explains **why**, never what. If the code already says what it
  does, the comment is noise the next reader has to check against it.
- A comment **stands alone**. It is read cold, by someone with no access to a
  plan, a ticket or the conversation that produced it. A reference may add
  colour; it must never be where the reason lives.
- **Never cite a transient document.** Plans here are written just-in-time and
  deleted when the work lands, so a decision id, a phase number or a section
  mark is dead the day it is written, and nothing notices. The `comment-paths`
  guardrail sees one shape of this, the plan cited as a path
  (`docs/plans/phase-2.md`); a bare `A4(b)` or `overview §4` is on you alone.
- **Don't narrate the change.** "Moved here from X", "now does Y instead":
  `git log` carries that, and a year later the comment describes a diff nobody
  can see. Comments describe the code as it stands.
- **Prefer none.** A comment earns its place by recording what the code cannot
  say for itself — a constraint, a trap, a rejected alternative, a non-obvious
  ordering, a why-not.
- **Terse**: a line or two. A block that argues rather than points is the
  exception and may run longer — the module-level doc comment laying out a
  subsystem's shape, a rejected alternative, the reasoning behind a layout.

## Scripts

| Script                                     | What                                                                |
| ------------------------------------------ | ------------------------------------------------------------------- |
| `npm run viewer:dev` / `viewer:build`      | the report: Vite dev server on the sample / one-file build          |
| `npm run typecheck`                        | `tsc --noEmit`                                                      |
| `npm test` / `test:watch`                  | Vitest `unit` + `web` + `guardrails`                                |
| `npm run lint` / `format` / `format:check` | oxlint / Prettier                                                   |
| `npm run check`                            | **The gate**: typecheck + viewer:build + test + lint + format:check |

`er` needs no environment of its own: the model runs as the engineer, with
their own Claude credentials and the reviewed repository's own Claude config.

## Working on Windows

The user runs Windows. `bash` (Git Bash) and `powershell` are both available.
When you suggest commands, use forward-slash paths and POSIX-friendly syntax.
Line endings are normalised to LF by `.gitattributes`.

## Task tracking (Linear)

Bugs, features and improvements to the app are tracked in Linear, team
**enhanced-reviews** (key `ER`). Before starting one, when opening its PR and
when finishing it, load the `linear` skill and follow it.

**A bug you find while you are already in the code is yours to fix.** The
default for something noticed in passing is a commit on the branch you are on,
with the reason in its message — not a new issue. A ticket for a fix that would
have taken twenty minutes costs more than it saves: someone has to read it,
triage it, schedule it, and then rebuild the context you had in front of you at
the time. A backlog of small tickets is a cost, not a record.

File one instead only when you genuinely cannot do it now, and say which of
these is why:

- it turns on a decision that is the user's rather than yours;
- it is big enough to want a review of its own;
- it is somewhere the branch at hand has no business touching;
- fixing it here would bury the change under review.

Scope discipline still applies — this is about small fixes in code you are
already changing, not licence to widen the task. When you fix in band, the
commit message carries what the issue would have: what was wrong, and how you
know it is not any more. When you are unsure which way it goes, ask; do not
file as a way of avoiding the question.

Housekeeping gets no issue: agent config (this file, `.claude/`), docs,
tooling, CI, dependency bumps and small cleanups go straight to a
`<type>/<slug>` branch (for example `chore/split-agents-md`). Out-of-scope
housekeeping is mentioned to the user, not filed. If it is unclear which a
piece of work is, ask.

## Keeping this file up to date

Treat AGENTS.md and `.claude/rules/` as one living map, split by area. **Update
whichever file covers the area in the same change that introduces structural
drift, then commit that edit with the change.** Triggers:

- New top-level directory, or a new `src/<area>`.
- A new `er` command, stage or flag, npm script, or guardrail.
- Renames or removals of any of the above.
- A change to the high-level data flow (the stages, the bundle the report
  reads).

A new area gets a line in the layout above, and a rule file (plus a row in
"Where the rest lives") once it has detail worth more than that line. Keep this
file to what every change needs; anything that matters only inside one area
belongs in that area's rule. Pure refactors inside an already-named area do
**not** require an update.

1. If a map file is part of the diff, include it in the same commit as the
   code change that triggered it. Do not split it into a separate docs commit.
2. If you notice the map is stale relative to the tree, fix it in your next
   commit on the branch.
3. Commit message convention: follow whatever style `git log -n 5` shows.
4. Don't push without explicit user approval. Local commits are fine;
   remote-visible actions are not.
