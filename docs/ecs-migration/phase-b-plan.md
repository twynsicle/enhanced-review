# Phase B — Containerize the app — execution plan

**Status:** ready to execute. **Companion to:** [05-local-docker.md](./05-local-docker.md) (design) and [00-overview.md](./00-overview.md) (phase map).

This file is the ordered task list for Phase B: take the working Phase A app off `npm run dev` against a host-postgres compose service and produce a Dockerfile + extended docker-compose.yml such that `docker compose up --build` from a fresh clone is the single command that runs the full system. Same artifact will later be tagged + pushed to ECR in Phase D.

If anything here disagrees with [05-local-docker.md](./05-local-docker.md) it is because doc 05 has been edited in-place to reflect the decisions below — they should agree. Treat this file as the *playbook*; doc 05 as the *reference*.

---

## Goal

A maintainer who clones the repo, copies `.env.example` to `.env.local`, fills in three OAuth + one Anthropic value, and runs `docker compose up --build` ends up at `http://localhost:3000` able to sign in (after seeding allowlist), kick off a stub review, and watch it stream — without ever installing Node, npm, or Postgres on the host.

Nothing else changes: data layer is already Postgres + Drizzle, auth is already Auth.js, realtime is already SSE + LISTEN/NOTIFY. We are only changing how the app is *packaged* and *run*.

---

## Decisions made during planning (overrides on doc 05 as originally written)

These are the answers chosen on 2026-05-09 when the plan was drafted. Doc 05 has been edited in-place to match.

| Topic                          | Decision                                                                                              | Rationale                                                                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Postgres data volume           | Named volume `pgdata` (keep current state)                                                            | Avoids Windows WSL2 bind-mount permission issues. Doc 05 itself flagged this as a Windows gotcha.                                |
| Postgres image version         | Bump local from `postgres:16-alpine` → `postgres:17-alpine`                                           | Aligns local image tag with what we'll use in the ECS task in Phase C. Throwaway POC data, so `down -v` reset is acceptable.    |
| Migrations runner in container | Compile existing `drizzle/migrate.ts` to JS in the build stage; runtime calls `node drizzle/migrate.js` | One source of truth. Avoids bundling `tsx` into the runtime image and avoids hand-rolling a separate `.cjs` sibling.            |
| Orphan-job recovery            | Run **only** in `entrypoint.sh` via a standalone CJS script. Drop the call from `instrumentation.ts`. | Recovery happens before any HTTP route can serve a stale `running` row. One source of truth; no duplicated work on every boot. |
| Local Postgres password        | Keep current `app` (not doc 05's illustrative `localdevpw`)                                           | Already wired through `.env.example` and `RUNNING.md`; no value in renaming.                                                    |
| CI verification                | Add a `docker build` job to `.github/workflows/ci.yml`                                                | Catches Dockerfile rot before Phase D's deploy pipeline depends on it.                                                          |
| Legacy PocketBase cleanup      | Full cleanup (delete `pb_migrations/`, `scripts/pb*.mjs`, prune `next.config.ts`)                     | Keep the Phase B branch self-contained.                                                                                         |
| Entrypoint script location     | `scripts/entrypoint.sh`                                                                               | Co-located with other operational scripts (`db-seed.ts`, `recover-jobs.cjs`).                                                   |
| Dockerfile platform            | Pin `--platform=linux/amd64` on every `FROM` line                                                     | ECS Fargate is amd64; avoids accidental drift if a contributor builds on ARM later.                                             |
| Compose web image tag          | `image: enhanced-review:local`                                                                        | Identifiable in `docker images`; distinct from Phase D's ECR-tagged production builds.                                          |

---

## Pre-flight (current state of the branch)

Phase A is already merged on `migrate-ecs`. The audit below is what the workspace looks like *now*, so the diff Phase B applies is precise.

- `docker-compose.yml` exists with one `postgres` service on `postgres:16-alpine`, named volume `pgdata`, port 5432 published.
- `next.config.ts` still contains the PB-era `pbRemote` IIFE + `dangerouslyAllowLocalIP` — dead code post-Phase A.
- `pb_migrations/` directory still present (4 historical JS files). `scripts/pb.mjs` and `scripts/pb-install.mjs` still present.
- `pocketbase` already removed from `package.json` deps; `pb` / `pb:install` scripts already removed.
- `drizzle/migrate.ts` exists and is wired to `npm run db:migrate`.
- `instrumentation.ts` calls `recoverInterruptedJobs()`; same logic lives in `src/lib/jobs/runner/recover-on-startup.ts`.
- No Dockerfile, `.dockerignore`, `.gitattributes`, or `data/` directory.
- CI workflow at `.github/workflows/ci.yml` runs format/lint/typecheck/test only.

This pre-flight is the ground truth that the commits below were sized against.

---

## Task sequence (one logical commit per heading)

Each section below describes one commit. They are ordered so that any prefix is independently green (CI passes, app still runs locally) — feel free to land them as separate PRs or as a stack.

### 1. Clean up legacy PocketBase artifacts

**Files:**

- Delete `pb_migrations/` (4 files)
- Delete `scripts/pb.mjs`, `scripts/pb-install.mjs`
- Edit `next.config.ts`: drop the `pbRemote` IIFE, the `isLocalHost` helper, the `dangerouslyAllowLocalIP` field, and the `...(pbRemote ? [pbRemote] : [])` spread. Keep only the GitHub avatars `remotePatterns` entry and the existing `transpilePackages`.
- (Optional) `git grep -n -i pocketbase` to spot any lingering text references; comment-only references are fine to leave for one cleanup pass.

**Why standalone:** every change is mechanical removal of dead code. Easy to bisect. The remaining commits assume `next.config.ts` is already minimal.

**Verify:** `npm run typecheck`, `npm run lint`, `npm test` all green.

---

### 2. Bump local Postgres image to 17-alpine

**Files:** `docker-compose.yml`

```diff
-    image: postgres:16-alpine
+    image: postgres:17-alpine
```

**Operator step (one-time, document in commit body):** existing dev volumes from PG16 are not forward-compatible with PG17. Run `docker compose down -v && docker volume rm enhanced-review_pgdata` before bringing up the new image. Acceptable because POC data is throwaway; allowlist re-seed is one `npm run db:seed` command.

**Verify:** `docker compose up postgres -d`, `docker compose exec postgres psql -U app -d enhanced_review -c "SELECT version();"` reports 17.x. `npm run db:migrate && npm run db:seed && npm run dev` smoke-tests end-to-end against the new image.

---

### 3. Add `output: 'standalone'` to `next.config.ts`

**Files:** `next.config.ts`

```diff
 const nextConfig: NextConfig = {
+  output: 'standalone',
   transpilePackages: [...],
   ...
 };
```

**Why standalone commit:** affects build output regardless of Docker. Useful to ship even if the rest of Phase B were reverted. Verifies the standalone tree builds cleanly *before* the Dockerfile depends on it.

**Verify:** `npm run build` succeeds. Inspect `.next/standalone/server.js` exists. `node .next/standalone/server.js` boots (with appropriate env vars and the `.next/static` + `public/` copied next to `server.js`, OR don't bother — Docker will exercise this in step 6).

---

### 4. Move orphan-job recovery into a standalone CJS script

**Goal:** untangle recovery from Next.js boot so the entrypoint can run it before `node server.js` starts handling requests.

**Files:**

- Create `scripts/recover-jobs.cjs` — pure CommonJS, depends only on `pg`. Runs the same SQL as `recover-on-startup.ts`:
  - `UPDATE review_jobs SET status='error', completed_at=now(), error_message='Container restarted; in-flight job lost', updated_at=now() WHERE status='running' RETURNING id, user_id`
  - For each returned row, `SELECT pg_notify('job_<id>', '{"type":"status","status":"error","errorMessage":"..."}')` and `SELECT pg_notify('user_<userId>:terminal', '{"jobId":"...","status":"error"}')`.
  - `process.exit(0)` on success or recoverable error (do NOT block container startup on a NOTIFY failure — the data layer is stale, not broken).
  - Reads `DATABASE_URL` from env; throws if unset.
- Edit `instrumentation.ts`: remove the `recoverInterruptedJobs` import + `void recoverInterruptedJobs()` call. Keep the `installShutdownHandler()` call.
- Delete `src/lib/jobs/runner/recover-on-startup.ts` and any unit tests that import it directly.
- Add `db:recover` to `package.json` scripts: `"db:recover": "node scripts/recover-jobs.cjs"`. Useful for the dev-flow Flow 2 case (host-side `npm run dev` after a crash).

**Why CJS not TS:** runtime container is plain Node (no `tsx`, no Next.js standalone path resolution). A 40-line `.cjs` script with `pg` and a hand-rolled SQL string is simpler than figuring out `import()` paths into `.next/standalone/server/...`.

**Verify:** insert a row with `status='running'` directly via psql, run `npm run db:recover`, confirm row flips to `status='error'` and SSE clients receive the terminal event.

---

### 5. Add `Dockerfile`, `.dockerignore`, `.gitattributes`, entrypoint

**Files:**

- `Dockerfile` (multi-stage; deps → build → runtime). Per doc 05 with these specifics:
  - All `FROM` lines pinned: `FROM --platform=linux/amd64 node:22-alpine AS deps`, etc.
  - **Build stage** runs `npm run build` AND compiles `drizzle/migrate.ts` to `drizzle/migrate.js`. Simplest reliable approach:
    ```dockerfile
    RUN npx --no-install tsc drizzle/migrate.ts \
        --outDir drizzle \
        --module nodenext --moduleResolution nodenext \
        --target es2022 --esModuleInterop --skipLibCheck
    ```
    (Or use the project's `tsconfig.json` and `--outDir` override. Validate output is `drizzle/migrate.js` ESM with a `.js` extension that `node` will execute when the package's `type` is `module`. If the runtime base image's Node module-loader rejects the format, fall back to emitting CommonJS via `--module commonjs --target es2022` and renaming `migrate.cjs`.)
  - **Runtime stage** copies: `.next/standalone` (whole tree, includes minimal `node_modules`), `.next/static`, `public/`, `drizzle/` (migrations + compiled migrate.js), and `scripts/recover-jobs.cjs`.
  - Installs `git`, `ca-certificates`, `tini` via `apk`. No `libc6-compat` unless the build surfaces a runtime error — start without and add only if needed.
  - Non-root user `nextjs:nodejs` (UID/GID 1001).
  - `ENTRYPOINT ["/sbin/tini", "--", "/entrypoint.sh"]`, `CMD ["node", "server.js"]`.
- `.dockerignore` — per doc 05; remove the `pb_data` and `tools` entries (already gone from the tree).
- `scripts/entrypoint.sh`:
  ```sh
  #!/bin/sh
  set -eu
  echo "[entrypoint] running migrations…"
  node /app/drizzle/migrate.js
  echo "[entrypoint] recovering interrupted jobs…"
  node /app/scripts/recover-jobs.cjs || echo "[entrypoint] recover failed (continuing)"
  echo "[entrypoint] starting next…"
  exec "$@"
  ```
  Note: `set -euo pipefail` from doc 05's example uses `pipefail` which the BusyBox `sh` shipped with Alpine doesn't always support. `set -eu` is safer.
- `.gitattributes` (new file at repo root): `*.sh text eol=lf` so `entrypoint.sh` doesn't get CRLF'd on Windows checkouts and become a `bad interpreter` error inside Alpine.

**Verify:**

```
docker build --platform=linux/amd64 -t enhanced-review:local .
docker images | grep enhanced-review:local   # expect 100–150 MB
```

Don't try to run it standalone — that's step 6's job.

---

### 6. Extend `docker-compose.yml` with the `web` service

**Files:** `docker-compose.yml`

```yaml
  web:
    build:
      context: .
      dockerfile: Dockerfile
    image: enhanced-review:local
    container_name: enhanced-review-web
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://app:app@postgres:5432/enhanced_review
      AUTH_SECRET: ${AUTH_SECRET}
      AUTH_URL: http://localhost:3000
      AUTH_GITHUB_ID: ${AUTH_GITHUB_ID}
      AUTH_GITHUB_SECRET: ${AUTH_GITHUB_SECRET}
      AUTH_TRUST_HOST: "true"
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
      REVIEW_EXECUTOR: ${REVIEW_EXECUTOR:-stub}
      REVIEW_MODEL: ${REVIEW_MODEL:-claude-haiku-4-5}
      REVIEW_TIMEOUT_MIN: ${REVIEW_TIMEOUT_MIN:-15}
      MAX_JOBS_PER_USER: ${MAX_JOBS_PER_USER:-1}
      LOG_LEVEL: ${LOG_LEVEL:-info}
      LOG_PRETTY: ${LOG_PRETTY:-0}
    ports:
      - "3000:3000"
```

Existing `postgres` service stays as-is (already 17-alpine after step 2, named `pgdata` volume).

**Why both `AUTH_URL` and `AUTH_TRUST_HOST=true`:** `AUTH_URL` pins the canonical origin; `AUTH_TRUST_HOST` is the explicit "yes, trust the Host header in non-Vercel deployments" toggle that Auth.js v5 requires for non-localhost prod hosts. Setting both in compose mirrors how the prod ECS task will be configured in Phase C, so dev exercises the same code paths.

**No web healthcheck for now:** `/api/health` exists but `depends_on` with `condition: service_healthy` is one-way (postgres → web). Adding a web healthcheck only buys value if some other service depended on web. Skip until Phase C / D need it.

**Verify (Flow 1):**

1. `cp .env.example .env.local`, fill in `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`. Set `REVIEW_EXECUTOR=stub` (the default).
2. `docker compose up --build`
3. Logs show: `postgres` healthy → `web` running migrations → `web` recovering jobs (no-op) → `web` "ready in Xms".
4. Visit `http://localhost:3000`. Sign in via GitHub, hit `/denied` (allowlist gate). Add yourself: `docker compose exec postgres psql -U app -d enhanced_review -c "INSERT INTO allowed_users (id, github_login) VALUES (gen_random_uuid()::text, 'your-username') ON CONFLICT DO NOTHING;"`. Sign in again.
5. Submit a stub review. Watch the live stream. Final narrative renders.
6. `docker compose down` (no `-v`) → `docker compose up` → history page still lists the prior job.
7. `docker compose down -v` → `docker compose up` → clean DB, runs again.

**Verify (Flow 2 — host dev still works):**

1. `docker compose up postgres`
2. `npm run dev` against `DATABASE_URL=postgres://app:app@127.0.0.1:5432/enhanced_review`
3. Sign in, run a review, observe the same end-to-end behavior.

---

### 7. CI: add a docker build verification job

**Files:** `.github/workflows/ci.yml`

Add a parallel job (`docker-build`) that runs after the existing `ci` job (or in parallel — they're independent). Use Docker buildx + GitHub Actions cache so PR runs are fast on warm caches.

```yaml
  docker-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - name: Build image
        uses: docker/build-push-action@v6
        with:
          context: .
          platforms: linux/amd64
          push: false
          load: false
          cache-from: type=gha
          cache-to: type=gha,mode=max
          tags: enhanced-review:ci
```

No push, no run — just a build that exercises the Dockerfile on every PR. Phase D's deploy pipeline will reuse the same Dockerfile so any breakage shows up here first.

**Verify:** push a no-op commit to a branch, open a PR, observe the new job runs and goes green. Optionally test cache hit by re-pushing — second run should be substantially faster.

---

### 8. Update existing user-facing docs

This is the slice of doc 10's work that makes sense to land *with* Phase B (the rest waits for Phase E). Specifically:

- **`README.md`** — Quickstart section: replace any `npm run pb`-era instructions with `cp .env.example .env.local && docker compose up --build`. Scripts table: add `db:recover`. Add a one-line note "Phase B containerization complete; Phase C onwards see `docs/ecs-migration/`".
- **`docs/RUNNING.md`** — rewrite the "Run" section to describe Flow 1 and Flow 2 (per doc 05's "Two flows in dev"). Document the named-volume reset (`docker compose down -v`) as the canonical "wipe the DB" step. Document the allowlist seeding via `docker compose exec postgres psql …`.
- **`AGENTS.md`** — update the `docker-compose.yml` line under Repo layout to "Local Postgres + web service. Phase B." Keep the existing tone.
- **`.env.example`** — add a clarifying comment about `AUTH_TRUST_HOST` being set in compose so the `.env.local` file doesn't need it.

Defer to Phase E:

- The "Architecture summary" rewrite in `README.md`.
- `docs/OPERATIONS.md` ECS-specific runbook entries.
- The proposal docs (11, 12).

**Verify:** a fresh `git clone` walkthrough following only `README.md` Quickstart succeeds end-to-end on a Windows + Docker Desktop host.

---

## Risks & gotchas to watch for during execution

- **Standalone tree + workspace packages.** `output: 'standalone'` traces dependencies; the `transpilePackages` entries (`@enhanced-review/github-client`, `@enhanced-review/review-types`) need to land in `.next/standalone/node_modules/` correctly. If you see `Cannot find module '@enhanced-review/...'` at runtime, suspect this. Mitigation: confirm during step 3 verification, before the Docker layer depends on it.
- **`drizzle/migrate.ts` compilation in build stage.** The TS file uses `import.meta.url` for `path.dirname(fileURLToPath(import.meta.url))` to locate migrations relative to itself. After tsc compilation, this still works in ESM output. If you fall back to CommonJS output (`--module commonjs`), `import.meta` is invalid — switch to `__dirname` (which CJS provides) or use `process.cwd() + '/drizzle'` since the entrypoint runs from `/app`. Test the compiled output before shipping.
- **CRLF on Windows.** Without `.gitattributes` set first, a Windows clone may have committed `entrypoint.sh` as CRLF, producing `/usr/bin/env: 'sh\r': No such file or directory` inside Alpine. Land step 5 with `.gitattributes` *in the same commit* and re-checkout the file so it's stored as LF.
- **Postgres 16 → 17 on dev volumes.** Anyone with a pre-existing `pgdata` volume will hit "incompatible data directory" on first PG17 boot. The fix is `docker compose down -v` once, and re-seed. Mention in commit body and RUNNING.md.
- **`AUTH_URL` mismatch on first sign-in.** If `AUTH_URL` is `http://localhost:3000` but you visit via `127.0.0.1:3000`, GitHub OAuth will return to localhost and the cookie won't bind. Stick to `localhost:3000` consistently in dev.
- **Recovery script DB races.** `recover-jobs.cjs` runs after `migrations` and before `node server.js`. If migrations changed the `review_jobs` schema, recovery's hand-rolled SQL must still match. Today the SQL is plain `UPDATE … WHERE status='running'` — robust against schema additions, fragile against renaming `status` or its enum values. If you ever rename, audit this script too.
- **Image size budget.** Doc 05 estimates 100–150 MB. If the runtime image creeps past 200 MB, suspect: deps stage leaking devDependencies into `.next/standalone/`, or `git` pulling unexpected transitive Alpine packages. Inspect with `docker history enhanced-review:local`.

---

## Verification checklist (Phase B exit gate)

Tick all before merging the Phase B branch:

- [ ] Step 1 cleanup: `git grep -i pocketbase` returns only AGENTS.md / docs/ references (no live code).
- [ ] Step 2: `docker compose up postgres -d && docker compose exec postgres psql -U app -d enhanced_review -c "SELECT version();"` reports 17.x.
- [ ] Step 3: `npm run build` produces `.next/standalone/server.js`.
- [ ] Step 4: orphan-job recovery test (insert running row, run `npm run db:recover`, observe flip).
- [ ] Step 5: `docker build --platform=linux/amd64 -t enhanced-review:local .` succeeds. `docker images | grep enhanced-review:local` shows < 200 MB.
- [ ] Step 6: Flow 1 fresh-clone smoke test passes end-to-end (sign-in → stub review → live stream → final narrative). Flow 2 still works.
- [ ] Step 6: `docker compose down && docker compose up` preserves history. `docker compose down -v` then up gives a clean DB.
- [ ] Step 7: CI's new `docker-build` job is green on a PR.
- [ ] Step 8: Walking through the updated README quickstart from a fresh `git clone` works without consulting any other doc.
- [ ] CI's existing format/lint/typecheck/test all green.

---

## Open questions deferred to a later phase

These came up during planning but don't block Phase B. Captured here so they're not lost.

- **Multi-platform image.** Phase B builds amd64 only. If we ever want to run locally on Apple Silicon at native speed, add an `arm64` variant to the buildx matrix (Phase D pipeline is the natural home). Not needed for the Windows-primary user.
- **Dockerfile health check.** Adding `HEALTHCHECK CMD curl -f http://localhost:3000/api/health` would let docker / ECS detect a hung Node process. Worth adding when Phase C wires up the ALB target group health check anyway — same `/api/health` endpoint, same semantics.
- **`libc6-compat`.** Doc 05 includes it preemptively. Ship without first; add only if a runtime symbol-resolution error surfaces (typical with `sharp`, which we don't use, or some `node-postgres` native bits, which we shouldn't hit).
- **Compose `profiles`.** If we ever want `docker compose up` (default) to start *only* postgres for Flow 2 and `--profile full` to add web, profiles are the mechanism. Not needed yet — `docker compose up postgres` is explicit enough.
