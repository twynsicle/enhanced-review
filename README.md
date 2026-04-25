# enhanced-review

Web-based AI code-review tool. Successor to the diffy POC.

See [docs/README.md](docs/README.md) for the plan-of-record and phase breakdown.

## Tech stack

- Next.js 16 (App Router, Turbopack default), React 19, TypeScript strict
- Tailwind v4 + shadcn/ui (Radix base, Nova preset)
- Self-hosted Supabase via `docker-compose` (vendored from [supabase/supabase/docker](https://github.com/supabase/supabase/tree/master/docker))
- Vitest + Testing Library (unit), Prettier + ESLint, GitHub Actions on PR

## Prerequisites

- Node.js >= 20.9 (Next 16 minimum)
- npm 10+
- Docker Desktop (or Docker Engine) with `docker compose`
- A GitHub OAuth app for local dev — see [Phase 1 setup → GitHub OAuth](#3-register-a-github-oauth-app)

## First-time setup

### 1. Install dependencies

```bash
npm install
```

### 2. Boot Supabase locally

```bash
# Generate fresh secrets (only needed once, on first clone of this repo).
cd supabase
cp .env.example .env
sh utils/generate-keys.sh --update-env
cd ..

# Pull images (slow first time) and start the stack.
docker compose -f supabase/docker-compose.yml up -d
```

The stack exposes:

- Kong (Supabase API gateway + Studio dashboard) at <http://localhost:8000>
- Postgres at `localhost:5432`
- Supavisor (transaction-mode pooler) at `localhost:6543`

Studio dashboard credentials are `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` from `supabase/.env`.

### 3. Register a GitHub OAuth app

(Required before sign-in works — covered in Wave 3 of Phase 1.)

1. Go to <https://github.com/settings/developers> → **New OAuth App**.
2. Set:
   - **Homepage URL**: `http://localhost:3000`
   - **Authorization callback URL**: `http://localhost:8000/auth/v1/callback`
3. Copy the **Client ID** and generate a **Client Secret**.
4. Add to `supabase/.env`:

   ```env
   GITHUB_ENABLED=true
   GITHUB_CLIENT_ID=<your-client-id>
   GITHUB_SECRET=<your-client-secret>
   ```

5. Restart the stack: `docker compose -f supabase/docker-compose.yml restart auth`

### 4. Apply migrations

```bash
./scripts/db-migrate.sh
```

Migrations:

- `0001_allowed_users.sql` — invite-only allowlist (Phase 1).
- `0002_review_jobs.sql` — review job lifecycle tables, RLS, NOTIFY trigger, Realtime publication (Phase 3).

### 5. Configure Next.js env

```bash
cp .env.example .env.local
# .env.local should mirror NEXT_PUBLIC_SUPABASE_ANON_KEY = supabase/.env's ANON_KEY
# and SUPABASE_SERVICE_ROLE_KEY = supabase/.env's SERVICE_ROLE_KEY.
```

### 6. Run the app

```bash
npm run dev
```

Open <http://localhost:3000>.

### 7. Run the review worker (Phase 3+)

The worker is a separate Node process that picks up `review_jobs` rows
and produces output. It can run two ways:

```bash
# Dev: tsx watch with hot reload, against the host-exposed Supabase ports.
cp packages/worker/.env.example packages/worker/.env
# fill DATABASE_URL with supabase/.env's POSTGRES_PASSWORD,
# fill SUPABASE_SERVICE_ROLE_KEY with supabase/.env's SERVICE_ROLE_KEY.
npm run dev --workspace @enhanced-review/worker

# Compose: build the worker image and join the supabase docker network.
docker compose -f docker-compose.worker.yml up -d --build
```

Only one worker should run at a time during Phase 3 — the boot sweep
("reset all running jobs to pending") assumes a single-worker invariant.
Phase 7 introduces heartbeat-based recovery for multiple workers.

## Common scripts

| Script                       | What                                               |
| ---------------------------- | -------------------------------------------------- |
| `npm run dev`                | Next.js dev server (Turbopack)                     |
| `npm run build`              | Production build                                   |
| `npm run lint`               | ESLint                                             |
| `npm run typecheck`          | `tsc --noEmit`                                     |
| `npm run format`             | Prettier write                                     |
| `npm run format:check`       | Prettier check (CI)                                |
| `npm test`                   | Vitest run                                         |
| `npm run test:watch`         | Vitest watch                                       |
| `./scripts/db-migrate.sh`    | Apply `supabase/migrations/*.sql` in order         |
| `./scripts/run-rls-tests.sh` | Run the Phase 3 RLS smoke tests against the dev DB |

## Stopping & resetting

```bash
# Stop the stack but keep data.
docker compose -f supabase/docker-compose.yml down

# Nuke everything (destroys the volume too — you'll need to re-migrate).
docker compose -f supabase/docker-compose.yml down -v
```
