# 05 — Local Docker setup

Replaces `npm run pb` + `npm run dev` with `docker compose up`. Produces a Dockerfile that doubles as the artifact ECS will run, plus a docker-compose.yml that spins up Next.js + Postgres locally with a persistent named volume.

This is Phase B. By this point the app is fully off PocketBase (Phase A done); now we containerize.

> **Execution playbook:** see [phase-b-plan.md](./phase-b-plan.md) for the ordered task list and the decisions log that overrode parts of this doc during planning. The text below has been edited in-place to match those decisions.

---

## Decisions feeding into this doc

- **D1, D5** Single web container + Postgres container
- POC traffic levels — multi-stage Docker, but no Distroless / scratch optimization
- Linux-on-Windows compatibility (user is on Windows; Docker Desktop with WSL2)

---

## File inventory

Three new files at the repo root:

```
Dockerfile
.dockerignore
docker-compose.yml
```

Plus updates to:

- `next.config.ts` — add `output: 'standalone'`, drop PB host from `images.remotePatterns`
- `.gitignore` — add `data/` (the bind-mounted Postgres data dir)
- `package.json` — drop the `pb`, `pb:install` scripts; add `db:migrate`, `db:generate`
- `.env.example` — drop PB vars, add Postgres + Auth.js vars

---

## `next.config.ts` changes

Two edits:

```typescript
const nextConfig: NextConfig = {
  output: 'standalone', // <-- add this
  reactStrictMode: true,
  transpilePackages: ['@enhanced-review/github-client', '@enhanced-review/review-types'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' },
      // remove the PocketBase entry here
    ],
  },
};
```

`output: 'standalone'` produces a tree under `.next/standalone/` that contains a minimal `node_modules` + `server.js`. The runtime image copies just that, plus `.next/static` and `public/`. Massive size reduction (~150 MB → ~30 MB excluding the base image).

---

## `Dockerfile`

Multi-stage. Three stages: deps, build, runtime. Targets Node 22 on Alpine for size.

```dockerfile
# syntax=docker/dockerfile:1.7

# --- Stage 1: deps ---
FROM --platform=linux/amd64 node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/github-client/package.json ./packages/github-client/
COPY packages/review-types/package.json ./packages/review-types/
RUN npm ci

# --- Stage 2: build ---
FROM --platform=linux/amd64 node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
# Compile the migrate runner so the runtime image doesn't need tsx. The
# source is `.mts` so tsc emits `.mjs` (ESM, preserves `import.meta.url`).
RUN npx --no-install tsc drizzle/migrate.mts \
      --outDir drizzle \
      --module nodenext --moduleResolution nodenext \
      --target es2022 --esModuleInterop --skipLibCheck

# --- Stage 3: runtime ---
FROM --platform=linux/amd64 node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# git is required by the job runner for `git clone`
RUN apk add --no-cache git ca-certificates tini

# Run as non-root.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Copy standalone output + static + public.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

# Migrations: copy SQL + the .mjs the build stage compiled from
# drizzle/migrate.mts. Then copy drizzle-orm itself — it's bundled into
# the standalone server chunks for app usage but the migrator subpath
# (`drizzle-orm/node-postgres/migrator`) is `import`-ed at runtime, so it
# needs to be resolvable from /app/node_modules.
COPY --from=build --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=build --chown=nextjs:nodejs /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --chown=nextjs:nodejs scripts/recover-jobs.cjs ./scripts/recover-jobs.cjs
COPY --chown=nextjs:nodejs scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER nextjs
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--", "/entrypoint.sh"]
CMD ["node", "server.js"]
```

### Why each piece

- **Alpine:** smaller image. We start without `libc6-compat`; add it back only if a runtime symbol-resolution error surfaces (typical with `sharp`, which we don't use). Keeps the runtime image leaner.
- **`tini`:** PID 1 reaper. Without it, `SIGTERM` doesn't propagate to Node cleanly; ECS task stops would zombie children. Cheap insurance.
- **`git` in runtime image:** required by the runner. Confirmed from the audit (`src/lib/jobs/runner/clone/git-runner.ts`).
- **Non-root user:** standard hardening. `nextjs` user, `nodejs` group, both UID/GID 1001.
- **Migrations in entrypoint:** see `scripts/entrypoint.sh` below.
- **`output: 'standalone'`:** lets us copy `.next/standalone/server.js` and run with plain `node server.js`.

### `scripts/entrypoint.sh`

```sh
#!/bin/sh
set -eu

echo "[entrypoint] running migrations…"
node /app/drizzle/migrate.mjs

echo "[entrypoint] recovering interrupted jobs…"
node /app/scripts/recover-jobs.cjs || echo "[entrypoint] recover failed (continuing)"

echo "[entrypoint] starting next…"
exec "$@"
```

Notes:

- **`set -eu`, not `set -euo pipefail`.** Alpine's BusyBox `sh` doesn't reliably support `pipefail`. `set -eu` is enough for this script.
- **Migrations first.** If they fail, container exits and ECS retries. Postgres sidecar is unaffected.
- **Recovery pass second.** Marks orphaned `running` jobs as `error` (see [04](./04-job-runner-rewrite.md)). The `|| echo …` swallows a recovery failure so a stale data layer doesn't block startup — the live view just reports "error" later.
- **Recovery is here, not in `instrumentation.ts`.** Phase B moves the orphan-flip step out of Next's boot hook and into a standalone CJS script (`scripts/recover-jobs.cjs`) that runs _before_ `node server.js` accepts requests. The Next.js `instrumentation.ts` keeps only the SIGTERM handler. This means there's a single source of truth for recovery and no duplicate work on every boot.
- **`exec "$@"`** — replaces the shell process with `node server.js` so signals reach Node directly (in addition to tini).

The migration runner reuses `drizzle/migrate.mts` (the same file `npm run db:migrate` runs through tsx); the build stage compiles it with `tsc` to `drizzle/migrate.mjs`. The `.mts` → `.mjs` extension preserves the source's ESM-only `import.meta.url` lookup of the migrations folder. Single source of truth, no `tsx` in the runtime image, no hand-rolled `.cjs` sibling to drift.

> **Why `drizzle-orm` is copied separately:** Next.js's standalone tracing bundles drizzle into the server chunks for the routes that use it. The migrator subpath (`drizzle-orm/node-postgres/migrator`) is only imported from `drizzle/migrate.mjs`, which Next never sees, so it isn't traced into the standalone tree. Copying the full `node_modules/drizzle-orm/` (~16 MB) into the runtime image makes the runtime `import` resolve. `pg` is already in the standalone tree, so no extra copy needed for it.

`scripts/recover-jobs.cjs` is a small CommonJS script that uses `pg` directly:

```javascript
const { Pool } = require('pg');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const { rows } = await pool.query(
      `UPDATE review_jobs
          SET status = 'error',
              completed_at = now(),
              error_message = 'Container restarted; in-flight job lost',
              updated_at = now()
        WHERE status = 'running'
        RETURNING id, user_id`,
    );

    for (const row of rows) {
      const jobPayload = JSON.stringify({
        type: 'status',
        status: 'error',
        errorMessage: 'Container restarted; in-flight job lost',
      });
      const userPayload = JSON.stringify({ jobId: row.id, status: 'error' });
      try {
        await pool.query('SELECT pg_notify($1, $2)', [`job_${row.id}`, jobPayload]);
        await pool.query('SELECT pg_notify($1, $2)', [`user_${row.user_id}:terminal`, userPayload]);
      } catch (err) {
        console.warn('[recover] notify failed', err);
      }
    }

    if (rows.length) console.log(`[recover] flipped ${rows.length} orphan rows`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[recover] failed', err);
  process.exit(0); // never block startup
});
```

---

## `.dockerignore`

```
node_modules
.next
.git
.env*
!.env.example
docs
.github
*.md
.vscode
.idea
coverage
playwright-report
.DS_Store
Thumbs.db
```

> The `pb_data`, `tools`, and `data` entries from earlier drafts are dropped — none of those paths exist in the post-Phase-A repo, and we use a named volume (`pgdata`) for Postgres rather than a `./data` bind mount.

Aggressive: anything that bloats the image without being needed at build/runtime.

> Keep `.env.example` so the runtime image doesn't 404 on missing-file checks if any tooling looks for it. `.env*` patterns block the _real_ `.env`/`.env.local` from leaking in.

---

## `docker-compose.yml`

```yaml
services:
  postgres:
    image: postgres:17-alpine
    container_name: enhanced-review-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: enhanced_review
    ports:
      - '5432:5432'
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U app -d enhanced_review']
      interval: 5s
      timeout: 5s
      retries: 5

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
      AUTH_TRUST_HOST: 'true'
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
      REVIEW_EXECUTOR: ${REVIEW_EXECUTOR:-stub}
      REVIEW_MODEL: ${REVIEW_MODEL:-claude-haiku-4-5}
      REVIEW_TIMEOUT_MIN: ${REVIEW_TIMEOUT_MIN:-15}
      MAX_JOBS_PER_USER: ${MAX_JOBS_PER_USER:-1}
      LOG_LEVEL: ${LOG_LEVEL:-info}
      LOG_PRETTY: ${LOG_PRETTY:-0}
    ports:
      - '3000:3000'

volumes:
  pgdata:
```

### Key choices

- **Named `pgdata` volume, not a bind mount.** Avoids Windows WSL2 bind-mount permission errors on a Windows host, which is the user's primary platform. Reset is `docker compose down -v` (one command, no manual `rm -rf`). The Postgres data is throwaway POC data anyway.
- **Postgres port published to host.** Lets you connect with `psql -h 127.0.0.1 -U app enhanced_review` from your shell. Optional; remove for slightly tighter dev posture.
- **`depends_on: condition: service_healthy`.** Web waits for Postgres to be ready before booting. Avoids the migration race on first up.
- **`AUTH_URL` _and_ `AUTH_TRUST_HOST=true`.** `AUTH_URL` pins the canonical origin; `AUTH_TRUST_HOST` is the explicit Auth.js v5 toggle that lets it trust the Host header in non-Vercel deployments. Setting both mirrors how the prod ECS task will be configured in Phase C.
- **`image: enhanced-review:local`.** Tags the build so it's identifiable in `docker images` (vs an auto-generated `<project>-web` name). Distinct from Phase D's ECR-tagged production builds.
- **`POSTGRES_PASSWORD: app`.** Stays consistent with the existing `.env.example` and `docs/RUNNING.md`. Safe because port 5432 is bound to localhost, no external reach.

### Two flows in dev

The compose file supports two flows, depending on whether you want fast iteration:

**Flow 1: full stack in compose** (closest to prod)

```bash
docker compose up --build
```

**Flow 2: postgres in compose, Next on the host** (fastest iteration, hot reload)

```bash
docker compose up postgres
# in another shell:
DATABASE_URL=postgres://app:app@127.0.0.1:5432/enhanced_review npm run dev
```

The README and `RUNNING.md` should document both.

---

## `.env.example` (post-migration)

```
# --- Auth.js ---
AUTH_SECRET=                     # any 32-byte random string; openssl rand -base64 32
AUTH_GITHUB_ID=                  # from your GitHub OAuth App
AUTH_GITHUB_SECRET=              # from your GitHub OAuth App
# AUTH_TRUST_HOST=true           # set in compose; required for non-localhost hosts

# --- Database ---
# Matches docker-compose.yml: user/password/db = app / app / enhanced_review.
DATABASE_URL=postgres://app:app@127.0.0.1:5432/enhanced_review

# --- Anthropic / Review executor ---
REVIEW_EXECUTOR=stub             # stub | claude
REVIEW_MODEL=claude-haiku-4-5    # only used when REVIEW_EXECUTOR=claude
ANTHROPIC_API_KEY=

# --- Runtime tunables ---
REVIEW_TIMEOUT_MIN=15
MAX_JOBS_PER_USER=1
LOG_LEVEL=info
LOG_PRETTY=0
```

Compare to the current `.env.example`: PB-related vars are gone (`NEXT_PUBLIC_POCKETBASE_URL`, `POCKETBASE_URL`, `POCKETBASE_ADMIN_EMAIL`, `POCKETBASE_ADMIN_PASSWORD`).

---

## GitHub OAuth App setup (local)

You need a GitHub OAuth App with the right callback URL:

1. <https://github.com/settings/developers> → New OAuth App.
2. **Application name:** anything (e.g. "enhanced-review (local)").
3. **Homepage URL:** `http://localhost:3000`.
4. **Authorization callback URL:** `http://localhost:3000/api/auth/callback/github`.
5. Generate a client secret. Drop both into `.env.local`.

For the deployed environment we'll create a separate OAuth App (different callback URL). Documented in [06b](./06b-application.md).

---

## Cleaning up the legacy

When Phase B lands:

- Delete `scripts/pb.mjs`, `scripts/pb-install.mjs`.
- Delete `pb_migrations/` (4 historical JSVM files, dead post-Phase-A).
- Prune `next.config.ts`: drop the `pbRemote` IIFE, `isLocalHost` helper, and `dangerouslyAllowLocalIP`.
- (Already done in Phase A: `tools/pocketbase/` removed, `pb_data/` removed, `pocketbase` dep removed, `pb`/`pb:install` scripts removed, `db:generate`/`db:migrate` scripts added.)
- Add `db:recover` (`node scripts/recover-jobs.cjs`) so the same recovery used in the entrypoint is reachable from Flow 2 / dev shells.

---

## Image size budget

Rough sizes (validate during execution):

- `node:22-alpine` base: ~50 MB
- App standalone tree: ~30 MB
- Static + public: ~5 MB
- `git` + ca-certs + tini: ~30 MB
- **Total runtime image: ~115 MB**

Build image is ~700 MB but doesn't get pushed (multi-stage). For the proposal docs, the talking point is "well under 200 MB" and "ECS pull is sub-10s on a warm cache."

---

## Common Windows gotchas

The user runs Windows; Docker Desktop on Windows uses WSL2 under the hood. Things to watch for:

- **Volume strategy.** We use a named `pgdata` volume (not a `./data` bind mount) precisely to avoid the WSL2 bind-mount permission class of bug. Reset = `docker compose down -v`. If you ever need to inspect the raw data dir, `docker run --rm -v enhanced-review_pgdata:/data alpine ls /data` is the escape hatch.
- **Line endings.** A `.gitattributes` rule (`*.sh text eol=lf`) is committed in Phase B so `entrypoint.sh` is stored as LF on every clone. Without it, CRLF causes `/usr/bin/env: 'sh\r': No such file or directory` inside Alpine.
- **File watching in dev (Flow 2).** Hot reload via `npm run dev` runs on Windows directly, no compose involvement; standard Next.js dev flow applies.
- **Postgres major version bumps.** PG16 → PG17 (or any major bump) is not forward-compatible at the data-dir level. After a bump, `docker compose down -v && docker volume rm enhanced-review_pgdata` once, then re-seed. POC data is throwaway; tolerable.

---

## Verification

Phase B success:

1. `git clone <fresh>` → `cp .env.example .env.local` → fill in OAuth credentials → `docker compose up --build`.
2. Logs show: postgres healthy → web running migrations → web "ready in Xms".
3. `http://localhost:3000` → sign in → run a stub review → see live streaming.
4. `docker compose down` (without `-v`) → `docker compose up` → data is still there (history page lists past jobs).
5. `docker compose down -v` + `rm -rf data/postgres` → `docker compose up` → clean DB, run-through works.
6. `npm run dev` Flow 2 also works against the compose'd postgres.
7. Image size check: `docker images | grep enhanced-review` shows runtime image around 100-150 MB.
8. CI passes (`npm run typecheck`, `lint`, `test`) with the new dependencies.
