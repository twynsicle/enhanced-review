# Phase 1 — Skeleton

**Goal:** replace the Next.js + PocketBase toolchain with the target stack and
land a running, themed, empty React Router app. No product features are ported
in this phase. At the end, `npm run check` is green, `npm run dev` serves a
placeholder page in both colour schemes with the ported theme, and the Docker
image builds.

Parent: [00-overview.md](./00-overview.md) — D1, D2, D4, D8, D9, D12; A1, A3,
A4, A8, A9, A12, A13.

---

## Phase-level decisions

These are the judgement calls this phase makes that the overview left open.
Each is small; they are listed so they are not re-decided mid-implementation.

| #     | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-D1 | **Legacy quarantine.** Code that Phases 3–4 will port (`src/lib/jobs`, `src/lib/github`, `src/lib/auth`, `src/lib/narrative`, `src/components/{home,narrative,notifications,theme,topbar}`, `packages/*`, their tests) moves to a top-level `legacy/` directory, excluded from tsconfig, ESLint, Prettier and Vitest. It is committed so the branch is coherent across sessions, and deleted at the end of Phase 4. Everything Next/PB-specific (`src/app`, `src/proxy.ts`, `src/lib/pb`, `src/components/ui`, `src/hooks`, `pb_migrations`, PB scripts, `test/`) is deleted outright. |
| P1-D2 | **`.env` replaces `.env.local`.** Node's `--env-file-if-exists=.env` loads it; Vite and Prisma also read `.env` by default. `.env.example` is the template. The maintainer renames their file and prunes the Supabase/PocketBase keys.                                                                                                                                                                                                                                                                                                                                                 |
| P1-D3 | **Line endings normalised to LF.** `.gitattributes` gains `* text=auto eol=lf` so Windows clones with `core.autocrlf=true` stop tripping `prettier --check` (51 false positives today). Existing rules for scripts/binaries stay.                                                                                                                                                                                                                                                                                                                                                      |
| P1-D4 | **`cross-env`** is the one new dev tool for setting `NODE_ENV=production` in the `start` script on Windows. The server decides dev vs prod from `NODE_ENV` only.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| P1-D5 | **Server runs TypeScript directly.** Node 24 strips types natively, so `server/index.ts` is executed as-is (no build step, no `tsx`). `tsconfig` sets `erasableSyntaxOnly` so nothing non-strippable creeps in. The web app is still built by Vite; the jobs bundle (Phase 5) by a second Vite config.                                                                                                                                                                                                                                                                                 |
| P1-D6 | **Path alias stays `@/*` → `src/*`.** Resolved by Vite 8's built-in `resolve.tsconfigPaths`, no plugin.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| P1-D7 | **Keep `pb_data/` and `tools/pocketbase/` on disk** (both gitignored) until the Monaco diff baseline is captured against `main`. Their `.gitignore` lines are removed in Phase 6, not here.                                                                                                                                                                                                                                                                                                                                                                                            |

---

## Target state after Phase 1

```
.
├── server/index.ts                 Express 5 bootstrap (dev: Vite middleware; prod: build/)
├── src/
│   ├── common/                     logger.ts (pino), time-ago.ts
│   ├── config/                     env.ts — Zod schema, parsed once at import
│   ├── db/                         (empty until Phase 2)
│   ├── domain/                     (empty until Phase 3)
│   ├── jobs/                       (empty until Phase 5)
│   ├── guardrails/                 *.guard.test.ts convention tests
│   └── web/
│       ├── root.tsx                Layout + Mantine provider + ColorSchemeScript
│       ├── routes.ts               route config
│       ├── routes/                 skeleton.tsx (placeholder index), health.ts (/api/health)
│       ├── theme/                  theme.ts, tokens.ts, theme.css, color-scheme.ts
│       ├── components/             (Phase 4)
│       ├── stores/                 (Phase 4)
│       └── test/                   setup.ts, render.tsx (Mantine-wrapped render)
├── legacy/                         quarantined port source (P1-D1) — deleted end of Phase 4
├── prisma/                         (Phase 2)
├── public/                         brand-mark.png, favicon
├── docs/                           README, RUNNING, OPERATIONS (stale-banner), rr-migration/
├── Dockerfile, .dockerignore, docker-compose.yml
├── vite.config.ts, react-router.config.ts, vitest.config.ts
├── eslint.config.mjs, .prettierrc.json, .prettierignore, tsconfig.json
├── .env.example, package.json, package-lock.json
└── .github/workflows/ci.yml        npm ci → npm run check
```

### Dependencies

Runtime: `react-router`, `@react-router/express`, `@react-router/node`,
`express`, `react`, `react-dom`, `@mantine/core`, `@mantine/hooks`,
`@mantine/notifications`, `@mantine/form`, `@mantine/dates`, `dayjs` (Mantine
dates peer), `@tabler/icons-react`, `zustand`, `zod`, `pino`, `pino-pretty`,
`@fontsource-variable/inter-tight`, `@fontsource/source-serif-4`,
`@fontsource-variable/jetbrains-mono`. Carried over untouched:
`@anthropic-ai/claude-agent-sdk`, `@monaco-editor/react`, `monaco-editor`,
`react-markdown`, `rehype-highlight`, `remark-gfm`, `highlight.js` (currently
transitive; becomes explicit because `theme.css` imports its stylesheet).

Dev: `@react-router/dev`, `vite`, `vitest`, `happy-dom`,
`@testing-library/react`, `@testing-library/dom`, `@testing-library/jest-dom`,
`typescript`, `@types/node`, `@types/express`, `@types/react`,
`@types/react-dom`, `eslint`, `typescript-eslint`, `eslint-plugin-react-hooks`,
`eslint-config-prettier`, `prettier`, `postcss-preset-mantine`,
`postcss-simple-vars`, `cross-env`.

Removed: `next`, `eslint-config-next`, `pocketbase`, `tailwindcss`,
`@tailwindcss/postcss`, `tw-animate-css`, `shadcn`, `radix-ui`, `cmdk`,
`class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `jsdom`,
`@vitejs/plugin-react` (the RR Vite plugin replaces it), the two workspace
packages, and the `workspaces` field.

Versions per A8: latest stable in each major at execution time (React Router
8.3.x, Mantine 9.6.x, Vite 8.2.x, Vitest 4.1.x, TypeScript 7.0.x, Zod 4.x,
Express 5.2.x, Node 24 LTS). `package-lock.json` pins exact versions.

### `package.json` scripts

| Script             | Command                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------- |
| `dev`              | `node --watch-path=server --env-file-if-exists=.env server/index.ts`                         |
| `build`            | `react-router build`                                                                         |
| `start`            | `cross-env NODE_ENV=production node --env-file-if-exists=.env server/index.ts`               |
| `typecheck`        | `react-router typegen && tsc --noEmit`                                                       |
| `lint`             | `eslint .`                                                                                   |
| `format`           | `prettier --write .`                                                                         |
| `format:check`     | `prettier --check .`                                                                         |
| `test`             | `vitest run --project unit --project web --project guardrails`                               |
| `test:watch`       | `vitest --project unit --project web --project guardrails`                                   |
| `test:integration` | `vitest run --project integration`                                                           |
| `check`            | `npm run typecheck && npm run build && npm run test && npm run lint && npm run format:check` |
| `check:all`        | `npm run check && npm run test:integration`                                                  |

Phase 2 adds `db:*`; Phase 5 adds `build:jobs` and `job`. `pb`, `pb:install`
are gone.

`package.json` also gets `"engines": { "node": ">=24" }` and a `"volta"` pin
to the current Node 24 LTS patch.

### TypeScript

`tsconfig.json`: `target ES2022`, `lib [DOM, DOM.Iterable, ES2022]`,
`module ESNext`, `moduleResolution bundler`, `jsx react-jsx`, `strict`,
`noEmit`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `skipLibCheck`,
`types ["vite/client", "node"]`, `rootDirs [".", "./.react-router/types"]`,
`paths {"@/*": ["./src/*"]}`. `include`: `src`, `server`, `*.config.ts`,
`.react-router/types/**/*`. `exclude`: `legacy`, `build`, `node_modules`.

TypeScript 7 is the first choice. If any dependency's `.d.ts` fails under 7,
fall back to TypeScript 6 and record the deviation in this file (overview
risk "TypeScript 7").

### React Router + Vite

- `react-router.config.ts`: `appDirectory: 'src/web'`, `buildDirectory: 'build'`, `ssr: true`.
- `vite.config.ts`: `plugins: [reactRouter()]`, `resolve: { tsconfigPaths: true }`,
  `css.postcss` via `postcss.config.cjs` (`postcss-preset-mantine`,
  `postcss-simple-vars` with Mantine breakpoints).
- `src/web/routes.ts`: `index('routes/skeleton.tsx')`, `route('api/health', 'routes/health.ts')`.
  The skeleton route is replaced by the real home page in Phase 4.
- `src/web/root.tsx`: `Layout` renders `<html lang="en" {...mantineHtmlProps}>`,
  `<ColorSchemeScript defaultColorScheme="dark" localStorageKey="er-theme" />`,
  `<Meta/> <Links/>`, `MantineProvider` with the ported theme and
  `localStorageColorSchemeManager({ key: 'er-theme' })`, `Notifications`,
  `<ScrollRestoration/> <Scripts/>`. `ErrorBoundary` renders a plain themed
  error card (the styled 404 page is Phase 4).
- `src/web/routes/health.ts`: resource route returning
  `{ ok: true, version, uptime_s }` — same shape as today's `/api/health`,
  minus the PocketBase check (Phase 2 adds a `db` check).

### Express server (`server/index.ts`)

```
import express, dev/prod switch on NODE_ENV
prod:  express.static('build/client/assets', { immutable, maxAge: 1y })
       express.static('build/client', { maxAge: 1h })
       createRequestHandler({ build: await import('../build/server/index.js') })
dev:   vite.createServer({ server: { middlewareMode: true } }) → app.use(vite.middlewares)
       createRequestHandler({ build: () => vite.ssrLoadModule('virtual:react-router/server-build') })
listen(env.PORT) ; log via src/common/logger
SIGTERM/SIGINT → server.close(); Phase 3 adds registry abort here
```

Single process, no cluster/forking — documented in a header comment (overview
risk "In-process runner + Express").

The server imports `src/config/env.ts` first so a bad environment fails at
boot, before Vite or the request handler load.

### `src/config/env.ts`

Zod schema parsed from `process.env` at module load; the parsed object is the
only export. Phase 1 keys:

| Key           | Type / default                                   |
| ------------- | ------------------------------------------------ |
| `NODE_ENV`    | `development \| production \| test`, default dev |
| `PORT`        | int, default `3000`                              |
| `LOG_LEVEL`   | pino level enum, default `info`                  |
| `LOG_PRETTY`  | `'1'` → boolean, default false                   |
| `APP_VERSION` | string, optional (health endpoint)               |

Later phases append keys here and to `.env.example` in the same commit
(Phase 2: `DATABASE_URL`, `SESSION_SECRET`, `GITHUB_CLIENT_ID`,
`GITHUB_CLIENT_SECRET`, `APP_ORIGIN`; Phase 3: `REVIEW_EXECUTOR`,
`REVIEW_MODEL`, `ANTHROPIC_API_KEY`, `REVIEW_TIMEOUT_MIN`, `MAX_JOBS_PER_USER`;
Phase 4: `LIVE_POLL_MS`, `TERMINAL_POLL_MS`).

A failed parse throws with the flattened Zod error and no stack noise. Unit
test covers defaults, coercion and the failure message. Guardrail (b) makes
this the only `process.env` reader.

`.env.example` is rewritten to list only these keys with comments; a section
per later phase is added as those phases land.

### `src/common/`

- `logger.ts` — today's `src/lib/log.ts` minus `import 'server-only'`, reading
  level/pretty from `env` rather than `process.env`. Same child-logger
  guidance in the header comment.
- `time-ago.ts` — moved verbatim with its test.

### Theme port (`src/web/theme/`)

The design source is `legacy/globals.css` (today's `src/app/globals.css`,
Editorial Iris palette) — copied there so the tokens survive the `src/app`
deletion. The port is theme-level only (D2): no component styling yet.

- `tokens.ts` — the semantic tokens as two `{ light, dark }` maps of oklch
  strings, one entry per CSS variable in `globals.css` (`background`,
  `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`,
  `destructive`, `border`, `input`, `ring`, `surface-2`, `subtle`, `before`/
  `after` (+ `-soft`, `-ink`), `risk`/`praise`/`suggestion`/`question`
  (+ `-soft`), `add`, `del`). `iris*` aliases are dropped in favour of
  `before*` (the CSS already declares iris as a legacy alias).
- `theme.ts` — `createTheme({...})`:
  - `fontFamily`: Inter Tight Variable + system fallback stack;
    `fontFamilyMonospace`: JetBrains Mono Variable + fallbacks;
    `headings.fontFamily`: Source Serif 4 + serif fallbacks, weight 600.
  - `primaryColor: 'iris'`, a 10-shade `MantineColorsTuple` derived from the
    cobalt hue (240) so shades 5–6 match today's `--primary` in light
    (`oklch(0.52 0.18 240)`) and dark (`oklch(0.72 0.17 240)`);
    `primaryShade: { light: 6, dark: 4 }`. A second tuple `mint` (hue 160)
    for the "after" accent.
  - `radius: { xs: 0.3rem, sm: 0.45rem, md: 0.6rem, lg: 0.75rem, xl: 1.05rem }`,
    `defaultRadius: 'lg'` (today's `--radius` 0.75rem and its multipliers).
  - `black`/`white` and `autoContrast` left default; `cursorType: 'pointer'`.
- `css-variables.ts` — `cssVariablesResolver` that (1) overrides Mantine's
  own variables with the tokens: `--mantine-color-body` ← background,
  `--mantine-color-text` ← foreground, `--mantine-color-default-border` ←
  border, `--mantine-color-dimmed` ← muted-foreground, `--mantine-color-anchor`
  ← primary, `--mantine-color-default` ← card, `--mantine-color-default-hover`
  ← muted, `--mantine-color-placeholder` ← subtle, `--mantine-color-error` ←
  destructive; and (2) emits every semantic token as `--er-<name>` per scheme
  so Phase 4 components and CSS Modules reference one vocabulary.
- `theme.css` — imports, in order: the three `@fontsource` CSS entries,
  `@mantine/core/styles.css`, `@mantine/notifications/styles.css`,
  `highlight.js/styles/github-dark.css`; then `html { height: 100% }`,
  `body { min-height: 100%; display: flex; flex-direction: column; -webkit-font-smoothing: antialiased }`
  — the only global CSS.
- `color-scheme.ts` — exports the shared `localStorageColorSchemeManager`
  instance (key `er-theme`) so root and tests use the same one. Default
  scheme is dark. Existing stored values `light`/`dark` are compatible with
  Mantine's manager.

**Placeholder route** (`routes/skeleton.tsx`): renders `Title` orders 1–3,
body `Text`, `Code`, a `Button` per variant (filled, light, outline, subtle),
a `Badge` per semantic token, an `Anchor`, and a colour-scheme toggle
`ActionIcon` with the same `aria-label`s as today
(`Switch to light mode` / `Switch to dark mode`, `IconSun`/`IconMoon` from
Tabler). Its purpose is to eyeball fonts, radii and palette against the Phase 0
baselines; it is deleted in Phase 4.

### Vitest projects (`vitest.config.ts`)

```
projects:
  unit         environment node       include src/**/*.test.ts        exclude src/web/**, src/guardrails/**, **/*.integration.test.ts
  web          environment happy-dom  include src/web/**/*.test.{ts,tsx}   setupFiles src/web/test/setup.ts
  guardrails   environment happy-dom  include src/guardrails/**/*.test.ts
  integration  environment node       include src/**/*.integration.test.ts  setupFiles src/test/integration-setup.ts
```

Root `resolve.tsconfigPaths: true`. `legacy/**` excluded everywhere.
`src/web/test/setup.ts` registers `@testing-library/jest-dom/vitest`,
`cleanup` after each test, and the `matchMedia`/`ResizeObserver` stubs Mantine
needs under happy-dom. `src/web/test/render.tsx` wraps
`@testing-library/react`'s `render` in `MantineProvider` with the real theme.
`src/test/integration-setup.ts` is a stub in Phase 1 (Phase 2 adds the
Postgres reachability probe that turns the project into skips).

Phase 1 tests: `env.test.ts`, `time-ago.test.ts` (moved), `root.test.tsx`
(renders the skeleton route inside the provider, asserts the toggle flips
`data-mantine-color-scheme`), and the six guardrails.

### Guardrails (`src/guardrails/`)

One file per rule, each walking the tree with `fs.globSync` and asserting on
import specifiers. All six pass trivially against the skeleton and start
biting in Phases 2–4.

| File                              | Rule (A4)                                                                                                                                                                                                                                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `layering.guard.test.ts`          | `web` → `domain`, `db`, `common`, `config`; `domain` → `db`, `common`, `config`; `db` → `common`, `config`; `jobs` → `domain`, `db`, `common`, `config`; `common`/`config` import nothing from `src/`. Nothing outside `src/web` and `server/` imports `react`, `react-dom` or `react-router`. |
| `env-access.guard.test.ts`        | `process.env` appears only in `src/config/`.                                                                                                                                                                                                                                                   |
| `no-console.guard.test.ts`        | `console.` appears only in `src/common/logger.ts` (and never in `server/`).                                                                                                                                                                                                                    |
| `routes-registered.guard.test.ts` | Every file under `src/web/routes/` is referenced from `src/web/routes.ts`, and vice versa.                                                                                                                                                                                                     |
| `zod-boundaries.guard.test.ts`    | A route module whose `loader`/`action` reads `params`, `request.url` or `request.formData()` must import `zod` or `@/web/lib/parse.server`.                                                                                                                                                    |
| `server-only.guard.test.ts`       | No `*.server.ts` module is imported from a file that is not itself `.server.ts`, `root.tsx`, a route module, `server/`, `src/jobs/`, or a test.                                                                                                                                                |

### Lint / format

`eslint.config.mjs`: `typescript-eslint` recommended (non-type-aware),
`eslint-plugin-react-hooks` recommended, `eslint-config-prettier` last;
ignores `build/`, `.react-router/`, `legacy/`, `node_modules/`, `coverage/`,
`screenshots/`. `.prettierignore`: `build`, `.react-router`, `legacy`,
`coverage`, `screenshots`, `package-lock.json`, `public`. `.prettierrc.json`
unchanged.

### Docker

- `Dockerfile` (multi-stage, `node:24-alpine`): `deps` (`npm ci`), `build`
  (`npm run build`), `runtime` (`npm ci --omit=dev`, copy `build/`, `server/`,
  `package.json`; `apk add --no-cache git` for the Phase 3 clone step;
  `ENV NODE_ENV=production`; `USER node`; `CMD ["node", "--env-file-if-exists=.env", "server/index.ts"]`).
  Phase 5 replaces `CMD` with `entrypoint.sh`.
- `.dockerignore`: `node_modules`, `build`, `.react-router`, `legacy`,
  `screenshots`, `pb_data`, `tools`, `.env*`, `.git`.
- `docker-compose.yml`: `postgres` (`postgres:18-alpine`, `127.0.0.1:5432:5432`,
  named volume `pgdata`, `POSTGRES_*` from `.env` with defaults, healthcheck
  `pg_isready`) and `web` (`build: .`, `ports: 3000:3000`, `env_file: .env`,
  `depends_on: postgres: condition: service_healthy`). Phase 1 only proves
  `docker build`; `compose up` is a Phase 5 exit criterion.

### CI

`.github/workflows/ci.yml`: `actions/setup-node@v4` with `node-version-file:
package.json` (reads `volta.node`) and npm cache, `npm ci`, `npm run check`.
Phase 2 adds a Postgres service job for `check:all`; Phase 5 adds
`docker build`.

### Docs touched in this phase

- `AGENTS.md`: rewrite the tech-stack, repo-layout, scripts and environment
  sections to the Phase 1 truth; add a banner "App is non-functional until
  Phase 4 lands — see docs/rr-migration/"; describe `legacy/` as
  read-only porting reference. The "How the system fits together" and
  "PocketBase collections" sections are replaced by a pointer to the overview
  until Phase 6 writes the final version.
- `README.md`, `docs/RUNNING.md`, `docs/OPERATIONS.md`: a one-paragraph
  banner at the top saying the content below describes the PocketBase-era app
  and is superseded by `docs/rr-migration/` until Phase 6. No other edits.

---

## Commit series

Each commit compiles; `npm run check` is green from commit 1 onward.

1. **Toolchain swap + quarantine.** Move port sources to `legacy/` (with
   `legacy/globals.css`, `legacy/README.md` explaining the folder); delete the
   Next/PB set; rewrite `package.json`; add tsconfig, `vite.config.ts`,
   `react-router.config.ts`, `postcss.config.cjs`, `vitest.config.ts`, ESLint,
   Prettier ignores, `.gitattributes` eol, `.env.example`; add
   `src/config/env.ts` (+ test), `src/common/{logger,time-ago}.ts` (+ test),
   `server/index.ts`, `src/web/{root.tsx,routes.ts}`, `routes/skeleton.tsx`
   (unstyled), `routes/health.ts`; trim `public/`; AGENTS.md/README/RUNNING/
   OPERATIONS banners.
2. **Theme port.** `src/web/theme/*`, root wiring, fonts, skeleton route
   showcase, `src/web/test/{setup,render}`, `root.test.tsx`.
3. **Guardrails.** `src/guardrails/*.guard.test.ts` and the `guardrails`
   project; `src/web/lib/parse.server.ts` (Zod `parseParams` /
   `parseSearchParams` / `parseFormData` helpers the zod-boundaries rule
   recognises — used from Phase 2 on).
4. **Container + CI.** `Dockerfile`, `.dockerignore`, `docker-compose.yml`,
   `ci.yml` on `npm run check`.

---

## Verification

- `npm run check` green on Windows (Git Bash) — the gate.
- `npm run dev` → `http://localhost:3000` renders the skeleton route; toggle
  flips scheme; no console errors; `/api/health` returns JSON.
- Screenshots `screenshots/phase-1/skeleton--{dark,light}.png` at 1280 px,
  compared by eye with `screenshots/baseline/home--empty--*.png` for font
  faces, heading weight, body background, card border, primary colour and
  radius. Adjust `tokens.ts`/`theme.ts` until they match.
- `npm run build && npm start` serves the same page from `build/`.
- `docker build -t enhanced-review:phase1 .` succeeds and
  `docker run --rm -p 3000:3000 enhanced-review:phase1` serves `/api/health`.
- `git grep -il "pocketbase\|next/\|tailwind\|shadcn\|radix" -- ':!legacy' ':!docs' ':!package-lock.json'`
  returns nothing.

## Exit criteria (from the overview, made concrete)

- Skeleton page renders in light + dark with the ported theme (verified above).
- `npm run check` green; CI workflow runs `check`.
- Docker image builds.
- `next`, `pocketbase`, `tailwindcss`, `shadcn`, `radix-ui` absent from
  `package.json`; `pb_migrations/`, `src/app/`, `src/lib/pb/`, `packages/`
  gone from the tree; port sources present under `legacy/`.
- AGENTS.md describes the Phase 1 tree.

## Maintainer actions

- Rename `.env.local` → `.env` and drop the Supabase and PocketBase keys
  (P1-D2). Keep `ANTHROPIC_API_KEY`, `REVIEW_*`, `LOG_*` for later phases.
- Optional: install Volta so the Node pin is honoured; otherwise any Node ≥ 24
  works.
- Stop the local PocketBase server; do not delete `pb_data/` yet (P1-D7).

## Deviations recorded during execution

_(filled in as the phase runs)_
