# enhanced-review

Web-based AI code-review tool for closed beta. Successor to the diffy POC.

You sign in with GitHub (invite-only allowlist), pick one of your repos,
choose a PR or branch, and the app clones the repo, runs `opencode`
against it, and streams a chaptered narrative review back to your browser.

- [docs/RUNNING.md](docs/RUNNING.md) — first-time setup and run instructions.
- [docs/README.md](docs/README.md) — architecture overview.
- [docs/OPERATIONS.md](docs/OPERATIONS.md) — ops runbook (allowlist mgmt, key rotation, viewing logs, re-running stuck jobs, deferred retention).

## Tech stack

- Next.js 16 (App Router, Turbopack default), React 19, TypeScript strict
- Tailwind v4 + shadcn/ui (Radix base, Nova preset)
- PocketBase (auth, CRUD, realtime) — single binary, SQLite-backed
- In-process review runner inside the Next.js server (no separate worker)
- Vitest + Testing Library (unit), Prettier + ESLint, GitHub Actions on PR

## Prerequisites

- Node.js >= 20.9 (Next 16 minimum)
- npm 10+
- Git on PATH (the runner shells out to `git clone`)
- A GitHub OAuth app for local dev — see [docs/RUNNING.md §6](docs/RUNNING.md)

Docker is **not** required.

## First-time setup

See [docs/RUNNING.md](docs/RUNNING.md) for the complete walkthrough.
Short version:

```bash
npm install
npm run pb:install
npm run pb           # window 1
npm run dev          # window 2 (after the one-time PB config)
```

Open <http://localhost:3000>.

## Common scripts

| Script                  | What                              |
| ----------------------- | --------------------------------- |
| `npm run dev`           | Next.js dev server (Turbopack)    |
| `npm run build`         | Production build                  |
| `npm run lint`          | ESLint                            |
| `npm run typecheck`     | `tsc --noEmit`                    |
| `npm run format`        | Prettier write                    |
| `npm run format:check`  | Prettier check (CI)               |
| `npm test`              | Vitest run                        |
| `npm run test:watch`    | Vitest watch                      |
| `npm run pb`            | Start the local PocketBase server |
| `npm run pb:install`    | Download the pinned PB binary     |
