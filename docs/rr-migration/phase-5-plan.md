# Phase 5 — Container + jobs

**Goal:** the app ships as one image that actually boots. The runtime stage
carries every file the native entry points import, an `entrypoint.sh` applies
migrations and clears orphaned jobs before the server accepts traffic,
`docker compose up --build` works from a clean clone, and CI proves both the
build and the boot. The GitHub allowlist is removed in the same phase (P5-D3),
which is what deletes the entrypoint's seed step before it is ever written.

Parent: [00-overview.md](./00-overview.md) — D7 (recovery), D8 (**retired
here**), D12; A5, A9.

Builds on: [phase-2-plan.md](./phase-2-plan.md) (Prisma schema, migrations,
the gate, the `seed-allowlist` job — the last two are removed here),
[phase-3-plan.md](./phase-3-plan.md) (P3-D6 recovery, the in-process runner
and its shutdown contract), [phase-4-plan.md](./phase-4-plan.md) (the web
build this image serves).

Measured before writing this plan, against `enhanced-review:phase4` built
from `e742717`:

- The image **builds** (44 s) and **cannot boot**: `server/index.ts` imports
  `../src/domain/jobs/registry.server.ts`, which the runtime stage never
  copies. `ERR_MODULE_NOT_FOUND` before the first line of output. Phase 1
  wrote that stage when `server/index.ts` imported nothing but config and
  the logger.
- It weighs **2.38 GB**, of which `node_modules` is **1.1 GB**:
  `@anthropic-ai` 471 MB, `@prisma` 144 MB, `@tabler` 141 MB,
  `monaco-editor` 100 MB, `prisma` 40 MB, `effect` 34 MB, `@electric-sql`
  25 MB, `@typescript` 27 MB. `build/` itself is 3.3 MB.

---

## Phase-level decisions

Answers from the question round are marked **(user)**.

| #      | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P5-D1  | **No jobs bundle (user).** The overview's "Node-only Vite config → `build/jobs`" is dropped. `src/jobs/cli.ts` already runs natively under Node's type stripping (phase-2-plan Deviations), so the image ships the source and runs `node src/jobs/cli.ts <name>`. One code path with development, no second Vite config. The overview's Phase 5 row and exit criterion are amended in the plan commit.                                                                                                                                                                                                                   |
| P5-D2  | **The `prisma` CLI becomes a production dependency (user).** `entrypoint.sh` runs `prisma migrate deploy` inside the same image, so the container is self-contained and deployable anywhere. Cost: the CLI and its schema engine stay in the runtime image (~40 MB plus `@prisma` engines already present).                                                                                                                                                                                                                                                                                                              |
| P5-D3  | **The GitHub allowlist feature is removed entirely (user).** The `allowed_users` table, `isAllowed`, the `/denied` page and the `seed-allowlist` job all go; `allowlistGate` becomes `requireUser`, which redirects to `/login` when there is no session and otherwise lets the request through. Overview D8 is retired. **Consequence, recorded deliberately:** any GitHub account that reaches the origin can sign in and start reviews, which clone repositories and spend Claude API credit. Access control is now whatever fronts the deployment.                                                                   |
| P5-D4  | **CI builds the image and boot-smokes it (user).** A second workflow job builds the image, runs it against the Postgres service with a throwaway secret, polls `GET /api/health` until it reports ok, prints the container log on failure and tears down. A build that cannot boot fails CI, which is exactly the defect this phase starts with.                                                                                                                                                                                                                                                                         |
| P5-D5  | **`entrypoint.sh` is migrate → recover → exec web.** `set -e` so any step's failure kills the container rather than starting a server against an unmigrated database; `exec node server/index.ts` as the last line so the server is PID 1 and receives `SIGTERM` directly (the runner's drain contract, P3). `recover-jobs` runs even though `bootJobs()` repeats it on the first request: after a crash the queue should be consistent before traffic, not after it.                                                                                                                                                    |
| P5-D6  | **The runtime stage copies what the native entry points import**, from the build stage rather than the context so the generated Prisma client comes with it: `server/`, `src/config/`, `src/common/`, `src/db/` (including `generated/`), `src/domain/`, `src/jobs/`, `prisma/`, `build/`. The web bundle in `build/server` still carries its own copy of the domain; the source copies are for `server/index.ts` and the jobs CLI, which Node loads directly.                                                                                                                                                           |
| P5-D7  | **Image slimming is in scope, with a measurement in the plan and one after.** `monaco-editor` moves to `devDependencies` (it is a types-only import; the editor itself loads from the CDN at runtime — 100 MB). `@tabler/icons-react` is tested for `ssr.noExternal` so Vite bundles the handful of used icons into `build/server` instead of shipping 141 MB of package (kept only if the build stays green and the smoke test passes). `@anthropic-ai` (471 MB) stays: the Claude executor spawns that CLI. Target: the image is measurably smaller and every package over 25 MB left in it has a reason written down. |
| P5-D8  | **Compose runs the whole thing.** `web` gets `DATABASE_URL` pointing at the `postgres` service (the `.env` value is `127.0.0.1`, which inside a container is the container), `init: true`, a healthcheck on `/api/health`, and `depends_on: postgres: service_healthy`. `docker compose up --build` from a clean clone plus a filled `.env` is the acceptance test.                                                                                                                                                                                                                                                      |
| P5-D9  | **`APP_VERSION` comes from a build arg.** `ARG APP_VERSION` → `ENV APP_VERSION`, so `GET /api/health` reports the image tag as `.env.example` already promises. Unset in local builds, set by CI to the short SHA.                                                                                                                                                                                                                                                                                                                                                                                                       |
| P5-D10 | **No new runtime dependencies besides `prisma`.** No process manager, no `tini` (P5-D5's `exec` makes node PID 1), no `wait-for-it` (compose's healthcheck ordering covers it, and `migrate deploy` retries nothing — a failure exits and the container restarts).                                                                                                                                                                                                                                                                                                                                                       |

---

## 1. Removing the allowlist (P5-D3)

Everything below is deleted or rewritten in one commit, so no intermediate
state has a half-enforced gate.

**Deleted:** `src/db/allowed-users.ts`, `src/domain/auth/allowlist.server.ts`
(+ its test), `src/jobs/seed-allowlist.ts` (+ its test),
`src/web/routes/denied.tsx` (+ its test).

**Rewritten:**

| File                                     | Change                                                                                                                                                                                                   |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/web/auth/gate-middleware.server.ts` | `allowlistGate` → `requireUser`: no user → `/login` with `signOutHeaders`; otherwise `next()`. The `isAllowed` branch, the `/denied` redirect and the `logger` import go. `signOutHeaders` is untouched. |
| `src/web/routes/_gated.tsx`              | `middleware = [requireUser]`, comment updated.                                                                                                                                                           |
| `src/web/routes/login.tsx`               | Loader becomes `if (user) throw redirect('/')`; the "allowlist" sentence in the sign-in copy goes.                                                                                                       |
| `src/web/routes.ts`                      | `denied` route removed.                                                                                                                                                                                  |
| `src/jobs/cli.ts`                        | `seed-allowlist` removed from the registry; `recover-jobs` is the only job left.                                                                                                                         |
| `src/test/db.ts`                         | `allowed_users` dropped from the `TRUNCATE` list.                                                                                                                                                        |
| `prisma/schema.prisma`                   | `AllowedUser` model removed; migration `0002_drop_allowed_users` (`DROP TABLE allowed_users`). Five models remain.                                                                                       |

**Docs in this commit:** AGENTS.md (auth section, model count, layout,
scripts table), `docs/RUNNING.md`'s interim block (the seed step goes),
00-overview (D8 retired, "What gets deleted", Phase 5 row). The
PocketBase-era `README.md`, `docs/README.md` and `docs/OPERATIONS.md` still
describe an invite-only beta; they are rewritten wholesale in Phase 6 and are
left alone here rather than half-edited.

Phase 2's plan keeps its P2-D5 text as written — phase plans are the record
of what was decided then, and this plan's Deviations note the reversal.

---

## 2. Dockerfile (final shape)

```
deps     npm ci --ignore-scripts                       (unchanged)
build    COPY . . → npx prisma generate → npm run build
runtime  npm ci --omit=dev --ignore-scripts            (now includes prisma CLI)
         COPY --from=build  build/ server/ src/{config,common,db,domain,jobs}/ prisma/
         ARG/ENV APP_VERSION, apk add git, USER node, EXPOSE 3000
         HEALTHCHECK → node -e fetch('http://127.0.0.1:'+PORT+'/api/health')
         ENTRYPOINT ["./entrypoint.sh"]
```

`entrypoint.sh` (LF-committed; `.gitattributes` already forces `*.sh eol=lf`,
and it is copied with `--chmod=755` so a Windows checkout's mode bits do not
matter):

```sh
#!/bin/sh
set -e
prisma migrate deploy
node src/jobs/cli.ts recover-jobs
exec node server/index.ts
```

**Risk:** `prisma migrate deploy` must load `prisma.config.ts` (TypeScript)
inside the image. If the CLI cannot, the fallback is `--schema
prisma/schema.prisma` plus `DATABASE_URL` from the environment, recorded as a
deviation. Verified in commit 2 before anything else is built on it.

---

## 3. Compose and CI

Compose (P5-D8): `web` gains `environment: DATABASE_URL` targeting the
`postgres` service, `init: true`, `healthcheck`, and keeps `env_file: .env`
for the secrets. Documented in the RUNNING.md interim block.

CI (P5-D4): a new `image` job in `.github/workflows/ci.yml`, independent of
`check` so a UI test failure and a container failure are distinguishable.
Steps: checkout → `docker build` with `APP_VERSION=${{ github.sha }}` →
`docker run -d` against the job's Postgres service → poll `/api/health` for
up to 60 s → `docker logs` on failure → stop. No registry push (nothing to
push to yet, A9).

---

## 4. Commit series

Each commit is green on `npm run check`; the container commits also run
`docker build` and a boot.

| #   | Commit                                                                                                                          | Proof                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 0   | This plan + the overview amendments (D8 retired, Phase 5 row, exit criteria).                                                   | —                                                         |
| 1   | **Allowlist removal** (§1): code, migration `0002`, tests, AGENTS.md, RUNNING.md interim.                                       | `check:all`; sign in locally with the gate gone           |
| 2   | **Runtime image boots**: Dockerfile source copies (P5-D6), `prisma` as a prod dep, `entrypoint.sh`, `APP_VERSION`, HEALTHCHECK. | `docker run` reaches "server listening"; `/api/health` ok |
| 3   | **Slimming** (P5-D7): `monaco-editor` → dev, `ssr.noExternal` trial for the icons, before/after sizes recorded.                 | image size; smoke still green                             |
| 4   | **Compose full flow** (P5-D8).                                                                                                  | `docker compose up --build` from a clean clone            |
| 5   | **CI image job** (P5-D4).                                                                                                       | workflow syntax + a local rehearsal of the same steps     |
| 6   | **Close-out**: AGENTS.md container section, overview status → Phase 6 next, Deviations.                                         | `check:all`                                               |

---

## 5. Verification

- `npm run check:all` green at every commit.
- `docker build` green, and `docker run` boots to a healthy `/api/health`
  against the compose Postgres — the defect this phase opens with.
- `docker compose up --build` from a clean clone with a filled `.env`: sign
  in, start a stub review, read it.
- `docker run --rm <image> node src/jobs/cli.ts recover-jobs` exits 0 and
  reports a count (P5-D1's replacement for the overview's `build/jobs`
  criterion).
- A `docker stop` mid-review leaves the job `error: interrupted` rather than
  `running` (P5-D5's `exec` plus the Phase 3 drain).
- Image size recorded before and after commit 3.

## 6. Exit criteria

- The image builds, boots, serves and passes its healthcheck.
- `docker compose up --build` works from a clean clone.
- The jobs CLI runs inside the image.
- CI fails when the image cannot build or cannot boot.
- No `allowed_users` table, no allowlist code, no `/denied` route, and
  nothing references them.
- AGENTS.md describes the container and the gate as it now is; the overview
  says Phase 6 next.

---

## Deviations

**Commit 1 (allowlist removal)**

- Removing the feature was the user's answer inside this phase's question
  round, so it landed here rather than in Phase 6. The `seed-allowlist` job
  and the `SEED_GITHUB_LOGIN` idea both disappeared before the entrypoint was
  written, which is why P5-D5's chain is migrate → recover → web.
- `prisma migrate dev` would have prompted about dropping a non-empty table,
  which a non-interactive shell cannot answer, so `0002_drop_allowed_users`
  was hand-written (as `0001_init`'s CHECK constraints were) and applied with
  `migrate deploy`. `migrate status` reports no drift afterwards.
- The PocketBase-era `README.md`, `docs/README.md` and `docs/OPERATIONS.md`
  still describe an invite-only beta. They are rewritten wholesale in Phase 6
  and were left alone rather than half-edited; only the migration docs and
  AGENTS.md were updated.
- `screenshots/tools/dev-session.ts` (gitignored) also had to drop its
  `allowedUser` calls before it could mint a session again.

**Commit 2 (runtime image)**

- `--ignore-scripts` on the runtime install left the Prisma CLI with no schema
  engine, and it cannot fetch one at start-up because the image's `node` user
  owns nothing under `/app` ("Can't write to /app/node_modules/@prisma/
  engines"). That stage now runs lifecycle scripts, which means `prisma/` and
  `prisma.config.ts` are copied before `npm ci`; the client written by the
  resulting `postinstall` is replaced by the build stage's copy.
- The §2 risk did not materialise: the CLI loads `prisma.config.ts` inside the
  image ("Loaded Prisma config from prisma.config.ts"), so no `--schema`
  fallback was needed.

**Commit 3 (slimming)**

- Moving `monaco-editor` alone changed nothing: it is a **non-optional peer**
  of `@monaco-editor/react`, so npm kept installing it for the production
  tree. The wrapper had to move to `devDependencies` as well, which is what
  `ssr.noExternal` made possible.
- `npm ci --libc=musl` did not stop npm installing the glibc build of the
  Claude SDK's binary package; npm filtered by `os` and `cpu` (no darwin,
  win32 or arm64 present) but not by `libc`. It is removed with `rm -rf`
  instead, **in the same layer as the install** — a later `rm` left the image
  the same size, because the files stay in the earlier layer.
- Removing it is safe on this base image and was verified rather than
  assumed: with the glibc package deleted, the musl `claude` binary still
  reports its version, and the SDK resolves the musl variant on a musl host.
- Measured: image 2.45 GB → 1.78 GB, `node_modules` 1.1 GB → 705 MB. What is
  left above 25 MB, with reasons: `@anthropic-ai` 237 MB (the CLI the Claude
  executor spawns), `@prisma` 167 MB (client + migrate engines), `prisma`
  40 MB (the CLI, P5-D2), `effect` 34 MB and `@typescript` 27 MB (both pulled
  by the Prisma CLI's config loader), `@mantine` 32 MB (server-rendered).

**Commit 4 (compose)**

- `init: true` means `docker-init` is PID 1 and node is not, which reads
  against P5-D5's wording. Signals still arrive — `compose stop` logs
  "shutting down" and exits 0 — and the init process is what reaps the git
  and SDK children the review runner leaves behind.
- The local acceptance run used an uncommitted port override (`3100:3000`)
  and a separate compose project, because the maintainer's own dev server
  holds `:3000`. The clean-database path was verified on that separate
  project with a fresh volume: both migrations applied, then healthy.

**Commit 5 (CI)**

- The workflow could not be executed here. Its docker steps are the ones
  rehearsed locally in commits 2–4, except that the runner uses
  `--network host` to reach the Postgres service where the local rehearsal
  used a compose network.

**Still not verified**

- A real `claude` executor run inside the container: it needs
  `ANTHROPIC_API_KEY`, and this is carried forward from Phases 3 and 4. The
  image contains the SDK's musl binary and `git`, and the stub executor runs
  end to end in the container.
