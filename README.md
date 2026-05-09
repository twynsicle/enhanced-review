# enhanced-review

Web-based AI code-review tool for closed beta. Successor to the diffy POC.

You sign in with GitHub (invite-only allowlist), pick one of your repos,
choose a PR or branch, and the app clones the repo, runs the Claude
Agent SDK against it, and streams a chaptered narrative review back to
your browser.

- [docs/RUNNING.md](docs/RUNNING.md) — first-time setup and run instructions.
- [docs/README.md](docs/README.md) — architecture overview.
- [docs/OPERATIONS.md](docs/OPERATIONS.md) — ops runbook (allowlist mgmt, key rotation, viewing logs, re-running stuck jobs, deferred retention).
- [docs/ecs-migration/](docs/ecs-migration) — ongoing migration to Postgres + ECS Fargate. Read [00-overview.md](docs/ecs-migration/00-overview.md) first.

## Tech stack

- Next.js 16 (App Router, Turbopack default), React 19, TypeScript strict
- Tailwind v4 + shadcn/ui (Radix base, Nova preset)
- Postgres + Drizzle ORM, Auth.js v5 (NextAuth) with the Drizzle adapter
- App-owned SSE backed by Postgres `LISTEN/NOTIFY` for live job streaming
- In-process review runner inside the Next.js server (no separate worker)
- Vitest + Testing Library (unit), Prettier + ESLint, GitHub Actions on PR

## Prerequisites

- Docker Desktop (Windows: WSL2 backend) — for local Postgres, and the optional full containerised flow
- Node.js >= 20.9 — for IDE/dev-time and the Flow 2 host-side dev loop
- npm 10+
- Git on PATH (the runner shells out to `git clone`)
- A GitHub OAuth app for local dev — see [docs/RUNNING.md](docs/RUNNING.md)

## First-time setup

See [docs/RUNNING.md](docs/RUNNING.md) for the complete walkthrough.
Short version:

```bash
cp .env.example .env.local
# fill in AUTH_SECRET, AUTH_GITHUB_ID, AUTH_GITHUB_SECRET (and optionally
# ANTHROPIC_API_KEY if you want REVIEW_EXECUTOR=claude)

# Flow 1: full stack in Docker (closest to prod):
docker compose up --build

# Flow 2: postgres in Docker, Next.js on the host (fastest iteration):
docker compose up postgres
DATABASE_URL=postgres://app:app@127.0.0.1:5432/enhanced_review npm run dev
```

Open <http://localhost:3000>. First sign-in hits `/denied` (allowlist gate);
seed yourself with `npm run db:seed` (Flow 2) or via `psql` (see RUNNING.md).

## Common scripts

| Script                 | What                                                       |
| ---------------------- | ---------------------------------------------------------- |
| `npm run dev`          | Next.js dev server (Turbopack)                             |
| `npm run build`        | Production build                                           |
| `npm run lint`         | ESLint                                                     |
| `npm run typecheck`    | `tsc --noEmit`                                             |
| `npm run format`       | Prettier write                                             |
| `npm run format:check` | Prettier check (CI)                                        |
| `npm test`             | Vitest run                                                 |
| `npm run test:watch`   | Vitest watch                                               |
| `npm run db:generate`  | `drizzle-kit generate` (regenerate SQL after schema edits) |
| `npm run db:migrate`   | Apply pending migrations against `DATABASE_URL`            |
| `npm run db:seed`      | Seed `SEED_GITHUB_LOGIN` into `allowed_users`              |
| `npm run db:recover`   | Flip orphan `running` jobs to `error` after a host crash   |
