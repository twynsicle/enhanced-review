# Running enhanced-review locally

Every manual step required to take a fresh clone of this repo to a working
local deployment. You need Node, Docker (for local Postgres only), and a
GitHub OAuth app.

For day-2 operations on a running stack (allowlist, key rotation, log
tailing) see [docs/OPERATIONS.md](OPERATIONS.md). For the architecture
overview see [docs/README.md](README.md).

---

## Shell conventions used in this doc

Both **PowerShell** and **Git Bash** work for every command. Where they
diverge, both are shown.

---

## 1. Prerequisites — install on your machine

| Tool                                                                      | Version  | Purpose                                                            |
| ------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------ |
| [Node.js for Windows](https://nodejs.org/en/download)                     | >= 20.9  | Next.js 16 minimum, also runs the in-process review runner        |
| npm (bundled with Node)                                                   | >= 10    | Workspace support                                                  |
| [Git for Windows](https://git-scm.com/download/win)                       | recent   | `git` on PATH for the runner's clone step; provides Git Bash       |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/)         | recent   | Local Postgres (one container; no app container until Phase B)     |

Verify before continuing:

```powershell
node --version      # v20.9.0 or higher
npm --version       # 10.x or higher
git --version
docker --version
```

## 2. External accounts and credentials you need

| Credential                            | Where to get it                                          | Used by                              | Consequence if missing                                                                                    |
| ------------------------------------- | -------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| GitHub OAuth app (Client ID + Secret) | <https://github.com/settings/developers> → New OAuth App | Auth.js (`AUTH_GITHUB_*`)            | Cannot sign in. App is unusable.                                                                          |
| Anthropic API key                     | <https://console.anthropic.com> → API Keys               | Review runner (`ANTHROPIC_API_KEY`)  | Runner cannot run real reviews. The stub executor (`REVIEW_EXECUTOR=stub`) still works without one.       |
| GitHub username (yours)               | the username you'll sign in with                         | `allowed_users` row in Postgres      | OAuth login is rejected by the allowlist gate.                                                            |

The stub executor is enough to exercise the full streaming path without
spending Anthropic credits.

## 3. Install npm dependencies

From the repo root:

```bash
npm install
```

## 4. Start local Postgres

```bash
docker compose up postgres -d
```

The `docker-compose.yml` at the repo root brings up a single
`postgres:16-alpine` service on `127.0.0.1:5432` with user/password/db all
set to `app` / `app` / `enhanced_review`. State persists in the named
volume `enhanced-review_pgdata`.

To stop:

```bash
docker compose stop postgres        # keeps the volume (data preserved)
docker compose down -v              # NUKE: drops the volume too
```

## 5. Apply schema migrations

```bash
npm run db:migrate
```

Reads `DATABASE_URL` (defaults to the docker-compose URL via `.env.local`,
see step 7) and applies every SQL file under `drizzle/`. Idempotent.

## 6. Register a GitHub OAuth app

1. Go to <https://github.com/settings/developers> → **New OAuth App**.
2. Set:
   - **Application name**: anything (e.g. "enhanced-review local")
   - **Homepage URL**: `http://localhost:3000`
   - **Authorization callback URL**: `http://localhost:3000/api/auth/callback/github`
3. Save → copy the **Client ID** → click **Generate a new client secret** → copy it.

If you're migrating an existing OAuth app, just edit the callback URL in
the GitHub UI to point at `…/api/auth/callback/github`.

## 7. Configure the Next.js process

```powershell
Copy-Item .env.example .env.local
```

(or `cp .env.example .env.local` in Git Bash)

Edit `.env.local` and fill in:

| `.env.local` key       | Value                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| `AUTH_SECRET`          | random secret used to sign session cookies. Generate with `openssl rand -base64 32` (or any 32-byte hex). |
| `AUTH_GITHUB_ID`       | the Client ID from step 6                                                                                  |
| `AUTH_GITHUB_SECRET`   | the Client Secret from step 6                                                                              |
| `SEED_GITHUB_LOGIN`    | your GitHub handle (the account you'll sign in with)                                                       |
| `ANTHROPIC_API_KEY`    | (optional) your Anthropic API key — only needed for `REVIEW_EXECUTOR=claude`                                |

`DATABASE_URL` and `AUTH_URL` are already set to local defaults in the
template; no changes needed for the dev workflow.

Optional knobs (all commented in the template):

- `REVIEW_EXECUTOR` — `stub` or `claude` (template defaults to `stub` for safety)
- `REVIEW_MODEL` — Claude model id (default `claude-haiku-4-5`)
- `REVIEW_TIMEOUT_MIN` — per-job wall-clock budget (default 15)
- `MAX_JOBS_PER_USER` — per-user concurrency cap (default 1)
- `LOG_LEVEL`, `LOG_PRETTY` — pino logger config

## 8. Seed your allowlist row

```bash
npm run db:seed
```

Reads `SEED_GITHUB_LOGIN` from `.env.local` and inserts a row into
`allowed_users` if missing. Idempotent — safe to re-run after env edits.
If `SEED_GITHUB_LOGIN` is blank, the script no-ops.

## 9. Start the Next.js dev server

```bash
npm run dev
```

Serves <http://localhost:3000> (Turbopack). Hot-reloads on file change.
The review runner runs **in-process** inside the Next.js server — no
separate worker process. Submitting a review fires `runJob(...)` directly
from the API route.

## 10. Smoke test — end-to-end

1. Open <http://localhost:3000> in a browser.
2. Click **Sign in with GitHub** → authorize the OAuth app → land back on the app.
3. Pick a repository → pick a PR or branch → click **Review**.
4. Watch the chunks stream in. A successful run ends with `status='done'`.

If anything goes wrong, check:

- Next.js terminal output (the `npm run dev` window) — runner logs scoped with `job_id`.
- `psql` directly: `docker compose exec postgres psql -U app enhanced_review -c "SELECT id, status, error_message FROM review_jobs ORDER BY created_at DESC LIMIT 10;"`
- <http://localhost:3000/api/health> for queue depth and the oldest pending job age.

---

## File-by-file: where every secret lives

| File                    | Gitignored? | Contains                                                                                  | Read by                          |
| ----------------------- | ----------- | ----------------------------------------------------------------------------------------- | -------------------------------- |
| `.env.local`            | yes         | DB URL, Auth.js secret, GitHub OAuth client id + secret, Anthropic API key, runner knobs | Next.js dev server, db scripts   |
| Postgres volume         | yes (Docker) | Sessions, accounts (incl. GitHub access tokens), allowlist, jobs/reviews/chunks          | Postgres container                |

## Stop / reset

```bash
# Stop the Next.js dev server: Ctrl+C in its window.

# Stop Postgres (keeps data):
docker compose stop postgres

# NUKE: drop the Postgres volume entirely (you'll need to re-run steps 4-5 + 8).
docker compose down -v
```

## After-restart shortcut

Day-to-day, after the one-time setup is done:

```bash
docker compose up postgres -d   # Postgres in the background
npm run dev                     # Next.js dev server in the foreground
```

Schema, allowlist rows, sessions, accounts, and any data you've created
all persist in the Postgres volume across host reboots.
