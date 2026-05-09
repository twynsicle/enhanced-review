# 05 — Local Docker setup

Replaces `npm run pb` + `npm run dev` with `docker compose up`. Produces a Dockerfile that doubles as the artifact ECS will run, plus a docker-compose.yml that spins up Next.js + Postgres locally with a persistent bind mount.

This is Phase B. By this point the app is fully off PocketBase (Phase A done); now we containerize.

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
  output: 'standalone',                    // <-- add this
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
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
COPY packages/github-client/package.json ./packages/github-client/
COPY packages/review-types/package.json ./packages/review-types/
RUN npm ci

# --- Stage 2: build ---
FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- Stage 3: runtime ---
FROM node:22-alpine AS runtime
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

# Migrations: copy schema and generated SQL, plus a tiny migrate runner.
COPY --from=build --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --chown=nextjs:nodejs scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER nextjs
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--", "/entrypoint.sh"]
CMD ["node", "server.js"]
```

### Why each piece

- **Alpine + libc6-compat:** smaller image; the `libc6-compat` shim covers a few node-postgres / sharp edge cases.
- **`tini`:** PID 1 reaper. Without it, `SIGTERM` doesn't propagate to Node cleanly; ECS task stops would zombie children. Cheap insurance.
- **`git` in runtime image:** required by the runner. Confirmed from the audit (`src/lib/jobs/runner/clone/git-runner.ts`).
- **Non-root user:** standard hardening. `nextjs` user, `nodejs` group, both UID/GID 1001.
- **Migrations in entrypoint:** see `scripts/entrypoint.sh` below.
- **`output: 'standalone'`:** lets us copy `.next/standalone/server.js` and run with plain `node server.js`.

### `scripts/entrypoint.sh`

```sh
#!/bin/sh
set -euo pipefail

echo "[entrypoint] running migrations…"
node ./drizzle/migrate.cjs

echo "[entrypoint] recovering interrupted jobs…"
node -e "import('./.next/server/lib/jobs/runner/recover-on-startup.js').then(m => m.recoverInterruptedJobs()).catch(e => { console.error(e); process.exit(0); })" || true

echo "[entrypoint] starting next…"
exec "$@"
```

Notes:

- **Migrations first.** If they fail, container exits and ECS retries. Postgres sidecar is unaffected.
- **Recovery pass second.** Marks orphaned `running` jobs as `error` (see [04](./04-job-runner-rewrite.md)). `|| true` so a recovery failure doesn't block startup — the data layer is just stale, not broken.
- **`exec "$@"`** — replaces the shell process with `node server.js` so signals reach Node directly (in addition to tini).

`drizzle/migrate.cjs` is a tiny wrapper:

```javascript
const { drizzle } = require('drizzle-orm/node-postgres');
const { migrate } = require('drizzle-orm/node-postgres/migrator');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);
migrate(db, { migrationsFolder: './drizzle' })
  .then(() => pool.end())
  .catch((err) => { console.error(err); process.exit(1); });
```

(Or generate this via drizzle-kit; this is the manual hand-rolled equivalent.)

---

## `.dockerignore`

```
node_modules
.next
.git
.env*
!.env.example
data
pb_data
tools
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

Aggressive: anything that bloats the image without being needed at build/runtime.

> Keep `.env.example` so the runtime image doesn't 404 on missing-file checks if any tooling looks for it. `.env*` patterns block the *real* `.env`/`.env.local` from leaking in.

---

## `docker-compose.yml`

```yaml
services:
  postgres:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: enhanced_review
      POSTGRES_USER: app
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-localdevpw}
    volumes:
      - ./data/postgres:/var/lib/postgresql/data
    ports:
      - "5432:5432"  # exposed for local DB tools (psql, TablePlus)
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d enhanced_review"]
      interval: 5s
      timeout: 3s
      retries: 10

  web:
    build:
      context: .
      dockerfile: Dockerfile
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://app:${POSTGRES_PASSWORD:-localdevpw}@postgres:5432/enhanced_review
      AUTH_SECRET: ${AUTH_SECRET}
      AUTH_GITHUB_ID: ${AUTH_GITHUB_ID}
      AUTH_GITHUB_SECRET: ${AUTH_GITHUB_SECRET}
      AUTH_TRUST_HOST: "true"
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      REVIEW_EXECUTOR: ${REVIEW_EXECUTOR:-stub}
      REVIEW_MODEL: ${REVIEW_MODEL:-claude-haiku-4-5}
      REVIEW_TIMEOUT_MIN: ${REVIEW_TIMEOUT_MIN:-15}
      MAX_JOBS_PER_USER: ${MAX_JOBS_PER_USER:-1}
      LOG_LEVEL: ${LOG_LEVEL:-info}
      LOG_PRETTY: ${LOG_PRETTY:-0}
    ports:
      - "3000:3000"
```

### Key choices

- **`./data/postgres` bind mount.** Persists across `docker compose down`. Lives in the repo root, gitignored. Easy to nuke (`rm -rf data/postgres`) for a clean reset.
- **Postgres port published to host.** Lets you connect with `psql -h 127.0.0.1 -U app enhanced_review` from your shell. Optional; remove for slightly tighter dev posture.
- **`depends_on: condition: service_healthy`.** Web waits for Postgres to be ready before booting. Avoids the migration race on first up.
- **`AUTH_TRUST_HOST=true`.** Auth.js requires this in non-`localhost` environments (it's a CSRF mitigation flag). Setting it in dev keeps the config identical to prod.
- **`POSTGRES_PASSWORD` defaulted** to a local-only value via `${POSTGRES_PASSWORD:-localdevpw}`. Safe because port 5432 is bound to localhost, no external reach.

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
DATABASE_URL=postgres://app:localdevpw@127.0.0.1:5432/enhanced_review npm run dev
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
DATABASE_URL=postgres://app:localdevpw@127.0.0.1:5432/enhanced_review
POSTGRES_PASSWORD=localdevpw     # used by docker-compose

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

For the deployed environment we'll create a separate OAuth App (different callback URL). Documented in [06](./06-aws-infra-terraform.md).

---

## Cleaning up the legacy

When Phase B lands:

- Delete `scripts/pb.mjs`, `scripts/pb-install.mjs`.
- Delete `tools/pocketbase/` (entire dir).
- Delete `pb_data/` (gitignored anyway, but easier to delete now).
- Remove `pocketbase` from `package.json` deps.
- Remove `pb`, `pb:install` scripts from `package.json`.
- Add `db:generate` (`drizzle-kit generate`), `db:migrate` (`drizzle-kit migrate`), `db:studio` (`drizzle-kit studio`) to scripts.

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

- **Bind mount permissions.** `./data/postgres` will be owned by the WSL user; Postgres runs as UID 999 inside the container. Compose handles this on most setups, but on a fresh Windows install you may see `permission denied` errors. Fix: `wsl -d docker-desktop -e chown -R 999:999 /mnt/wsl/...` or simpler — let Docker manage with a named volume (`postgres-data:/var/lib/...` with `volumes: postgres-data:` at the bottom). Document the named-volume escape hatch in `RUNNING.md`.
- **Line endings.** Make sure `entrypoint.sh` is committed with LF line endings (add a `.gitattributes` rule: `*.sh text eol=lf`). CRLF will cause `bad interpreter` errors in the container.
- **File watching in dev (Flow 2).** Hot reload via `npm run dev` runs on Windows directly, no compose involvement; standard Next.js dev flow applies.

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
