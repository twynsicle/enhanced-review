# Repo orientation for agents

> **Migration in progress (React Router re-platform).** The app is being
> rebuilt phase by phase on `migrate-react-router`; it is **not runnable
> end-to-end until Phase 4 lands**. The plan of record is
> `docs/rr-migration/00-overview.md` — read it before anything else. Phase
> plans (`phase-N-plan.md`) say what the current phase is doing.
> `README.md`, `docs/RUNNING.md` and `docs/OPERATIONS.md` still describe the
> old Next.js + PocketBase app and are rewritten in Phase 6.

Web-based AI code-review tool (closed beta). Sign in with GitHub, pick a repo +
PR/branch, the server clones it, runs the Claude Agent SDK against it, and
streams a chaptered narrative review back. Successor to the diffy POC.

Library APIs here (React Router 8, Mantine 9, Prisma 7, Vite 8, Vitest 4,
Zod 4, TypeScript 7, oxlint) may be newer than your training data. Check the
package's docs in `node_modules/<pkg>` or the current online docs before
writing code against them; heed deprecation notices.

## Authoritative docs — read these first

| File                                | When to read                                                              |
| ----------------------------------- | ------------------------------------------------------------------------- |
| `docs/rr-migration/00-overview.md`  | Locked decisions (D1–D13), assumptions, target layout, phases, risks.     |
| `docs/rr-migration/phase-N-plan.md` | What the current phase builds, its commit series and exit criteria.       |
| `legacy/README.md`                  | Map from the quarantined old code to where each piece is ported.          |
| `README.md`, `docs/*.md`            | **Stale** (PocketBase era) until Phase 6. Use only for product behaviour. |

## Tech stack

- Node 24 (Volta-pinned, `engines >=24`). The Express server runs TypeScript
  directly via Node's type stripping — no build step for `server/`.
- React Router 8 framework mode (SSR) on Vite 8; Express 5 via
  `@react-router/express` in `server/index.ts`. Single process: the review
  runner (Phase 3) lives in-process, so never run under a forking manager.
- React 19, Mantine 9 (core/hooks/notifications/form/dates), Tabler icons,
  Zustand for persisted client prefs, Zod 4 at every boundary.
- Prisma 7 + `@prisma/adapter-pg` on Postgres 18 (Phase 2). Polling instead of
  realtime.
- Pino logging (`src/common/logger.ts`); `console.*` is banned by guardrail.
- TypeScript 7 (native compiler) strict, `verbatimModuleSyntax`,
  `erasableSyntaxOnly`. Linting is **oxlint** (`.oxlintrc.json`) — TS 7 has
  no JS API, so typescript-eslint cannot run against it. Prettier formats.
- Vitest 4 projects: `unit` (node), `web` (happy-dom), `guardrails`
  (repo-reading convention tests), `integration` (real Postgres, self-skips).

## Repo layout (Phase 1 state)

```
server/index.ts        Express bootstrap: dev = Vite middleware, prod = build/
src/
  common/              logger.ts (pino), time-ago.ts — imports only config from src/
  config/              env.ts — Zod-parsed process.env; the only process.env reader
  db/                  (Phase 2) Prisma client + repositories
  domain/              (Phase 3) auth/ github/ review/ jobs/
  jobs/                (Phase 5) one-shot tasks: recover-jobs, seed-allowlist
  guardrails/          (Phase 1 commit 3) *.guard.test.ts
  web/
    root.tsx           Layout, MantineProvider, ColorSchemeScript, ErrorBoundary
    routes.ts          route table — every file in routes/ must be listed here
    routes/            skeleton.tsx (placeholder index), health.ts (/api/health)
    theme/             (commit 2) Editorial Iris tokens → Mantine theme
    test/              setup.ts (jest-dom, matchMedia/ResizeObserver stubs), render helper
  test/                integration-setup.ts
legacy/                READ-ONLY old code awaiting port; excluded from every tool. Deleted end of Phase 4.
public/                brand-mark.png, favicon.ico
prisma/                (Phase 2)
docs/rr-migration/     plan of record
```

Layering (enforced by guardrails from commit 3): `web → domain, db, common,
config`; `domain → db, common, config`; `db → common, config`;
`jobs → domain, db, common, config`; `common → config`; `config` imports
nothing from `src/`. Only `src/web/` and `server/` may import React or
`react-router`.

## Conventions

- Path alias `@/*` → `src/*`, resolved by Vite/Vitest/tsc. **Exception:**
  `server/index.ts`, `src/config/env.ts` and `src/common/logger.ts` are loaded
  natively by Node and use relative imports with explicit `.ts` extensions.
- Server-only modules use the React Router `*.server.ts` filename convention
  (A12). Domain/db code is server-only by construction.
- Every loader/action parses `params`, search params and form data with Zod
  (helpers land in `src/web/lib/parse.server.ts`, commit 3).
- Env vars: add to the schema in `src/config/env.ts` **and** to `.env.example`
  in the same commit. Local values live in `.env` (gitignored).
- `legacy/` is reference only. Port from it; never import it.
- No barrel `index.ts` files. Import the module you need
  (`@/web/theme/theme`, not `@/web/theme`): Vitest's alias does not resolve
  directory indexes, and explicit paths keep dependency graphs readable.

## Scripts

| Script                                     | What                                                          |
| ------------------------------------------ | ------------------------------------------------------------- |
| `npm run dev`                              | Express + Vite dev server on `localhost:3000`                 |
| `npm run build` / `npm start`              | `react-router build` / serve `build/` in production mode      |
| `npm run typecheck`                        | `react-router typegen && tsc --noEmit`                        |
| `npm test` / `test:watch`                  | Vitest `unit` + `web` + `guardrails`                          |
| `npm run test:integration`                 | Vitest `integration` (needs Postgres; skips when unreachable) |
| `npm run lint` / `format` / `format:check` | oxlint / Prettier                                             |
| `npm run check`                            | **The gate**: typecheck + build + test + lint + format:check  |
| `npm run check:all`                        | `check` + integration                                         |

## Environment

`.env.example` is the canonical list with comments. Phase 1 keys: `NODE_ENV`,
`PORT`, `APP_VERSION`, `LOG_LEVEL`, `LOG_PRETTY`. Later phases append theirs.

## Working on Windows

The user runs Windows. `bash` (Git Bash) and `powershell` are both available.
When you suggest commands, use forward-slash paths and POSIX-friendly syntax.
Line endings are normalised to LF by `.gitattributes`.

## Keeping this file up to date

Treat AGENTS.md as a living map. **Update it in the same change that
introduces structural drift, then commit the AGENTS.md edit with that
change.** Triggers:

- New top-level directory, or a new `src/<area>` / `src/web/routes/<route>`.
- A new Prisma model or a rule change on how one is accessed.
- A new env var, npm script, executor backend, or guardrail.
- Renames or removals of any of the above.
- A change to the high-level data flow (auth, job lifecycle, polling).

Pure refactors inside an already-named area do **not** require an update.

1. If `AGENTS.md` is part of the diff, include it in the same commit as the
   code change that triggered it. Do not split it into a separate docs commit.
2. If you notice AGENTS.md is stale relative to the tree, fix it in your next
   commit on the branch.
3. Commit message convention: follow whatever style `git log -n 5` shows.
4. Don't push without explicit user approval. Local commits are fine;
   remote-visible actions are not.
