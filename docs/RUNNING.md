# Running enhanced-review locally

Every manual step required to take a fresh clone of this repo to a working local
deployment on **Windows**: what to install, what credentials to obtain, where
to put them, and which processes to start (and in what order).

This is the operator's checklist. For the why behind the architecture, see
[docs/README.md](README.md). For day-2 operations on a running stack (allowlist,
key rotation, log tailing), see [docs/OPERATIONS.md](OPERATIONS.md).

> **Migration in progress:** the Supabase stack is being replaced by PocketBase.
> The new setup lives in [RUNNING-pocketbase.md](RUNNING-pocketbase.md). Until
> the migration completes (Phase 5 in [migration-pocketbase.md](migration-pocketbase.md)),
> the app still runs against Supabase as documented below — follow this file
> for a working dev environment. The PB doc currently only covers standing up
> the PB binary side-by-side; it does not yet replace anything here.

---

## Shell conventions used in this doc

The project mixes Windows-native tooling (Docker Desktop, Node, Next.js) with a
handful of POSIX shell scripts vendored from upstream Supabase. Two shells are
used:

- **PowerShell** — default. All `npm`, `docker`, `docker compose`, and `Copy-Item`
  commands. Open from Start menu → "Windows PowerShell" or "Terminal".
- **Git Bash** — only for the `*.sh` setup scripts (`scripts/db-migrate.sh`,
  `supabase/utils/generate-keys.sh`). Comes with [Git for Windows](https://git-scm.com/download/win).
  Right-click the repo folder in Explorer → "Open Git Bash here".

Each command block below is labelled with the shell it expects. PowerShell is
the default unless noted.

---

## 1. Prerequisites — install on your machine

| Tool | Version | Purpose |
| ---- | ------- | ------- |
| [Node.js for Windows](https://nodejs.org/en/download) | >= 20.9 | Next.js 16 minimum, also runs the worker via tsx |
| npm (bundled with Node) | >= 10 | Workspace support |
| [Docker Desktop for Windows](https://docs.docker.com/desktop/install/windows-install/) | recent | Hosts the Supabase stack and optionally the worker. Must be running before any `docker` command works. |
| [Git for Windows](https://git-scm.com/download/win) | recent | Provides Git Bash, which is required to run the `.sh` setup scripts. |
| `psql` (optional) | 14+ | Only needed if you want to run SQL outside Studio. Bundled with the [PostgreSQL Windows installer](https://www.postgresql.org/download/windows/). |

Verify in PowerShell before continuing:

```powershell
node --version      # v20.9.0 or higher
npm --version       # 10.x or higher
docker --version
docker compose version
```

Verify Git Bash is on your `PATH` (so the bash shell is reachable):

```powershell
bash --version      # GNU bash, version 5.x ...
```

If `bash` is not found, the Git for Windows installer offers an "Add to PATH"
option — re-run it and pick "Git from the command line and also from 3rd-party
software".

## 2. External accounts and credentials you need

You **must** obtain these before the app is fully usable. Steps 4 and 5 below
write them into local files.

| Credential | Where to get it | Used by | Consequence if missing |
| ---------- | --------------- | ------- | ---------------------- |
| GitHub OAuth app (Client ID + Secret) | <https://github.com/settings/developers> → New OAuth App | Supabase Auth | Cannot sign in. App is unusable. |
| opencode-zen API key | <https://opencode.ai> account dashboard | Worker (`OPENCODE_ZEN_API_KEY`) | Worker cannot run real reviews. You can still develop against the stub executor (`REVIEW_EXECUTOR=stub`). |
| GitHub username (yours) | the username you'll sign in with | Allowlist row in Postgres | OAuth login is rejected by middleware. |

Nothing in this project requires a paid third-party service for development —
opencode-zen's free tier is enough to drive a few reviews.

## 3. Install npm dependencies

From the repo root in **PowerShell**:

```powershell
npm install
```

This installs the root `next` app and all workspace packages
(`packages/github-client`, `packages/review-types`, `packages/worker`).

## 4. Generate Supabase secrets and start the stack

The Supabase docker-compose project lives in `supabase/`. It is a vendored copy
of <https://github.com/supabase/supabase/tree/master/docker> and reads its own
`.env` file (separate from the Next.js `.env.local`).

**Git Bash** (the script is POSIX shell — PowerShell will not run it):

```bash
cd supabase
cp .env.example .env
sh utils/generate-keys.sh --update-env
cd ..
```

What `generate-keys.sh` produces in `supabase/.env`:

- `POSTGRES_PASSWORD` — Postgres superuser password
- `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY` — legacy HS256 keys
- `JWT_KEYS`, `JWT_JWKS`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` — newer ES256 keys
- `SECRET_KEY_BASE`, `VAULT_ENC_KEY`, `PG_META_CRYPTO_KEY` — internal service secrets
- `DASHBOARD_USERNAME`, `DASHBOARD_PASSWORD` — Studio basic-auth login

Make sure Docker Desktop is running, then bring the stack up in **PowerShell**
(slow on first pull, ~1 GB of images):

```powershell
docker compose -f supabase/docker-compose.yml up -d
```

Once running, these ports are exposed on `localhost`:

| Port | Service | Notes |
| ---- | ------- | ----- |
| 8000 | Kong (API gateway + Studio dashboard UI) | Studio at <http://localhost:8000>, basic-auth with `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD` |
| 5432 | Postgres | Connect as `postgres` / `POSTGRES_PASSWORD` |
| 6543 | Supavisor (transaction-mode pooler) | Not used by this app; available if needed |

If port 5432 is already in use (a local Postgres install on Windows often
binds it), stop that service in `services.msc` or change the host port in
`supabase/docker-compose.yml`.

Verify the stack is healthy:

```powershell
docker compose -f supabase/docker-compose.yml ps
# All services should be "running" or "healthy".
```

## 5. Register the GitHub OAuth app

1. Go to <https://github.com/settings/developers> → **New OAuth App**.
2. Set:
   - **Application name**: anything (e.g. "enhanced-review local")
   - **Homepage URL**: `http://localhost:3000`
   - **Authorization callback URL**: `http://localhost:8000/auth/v1/callback`
3. Save → copy the **Client ID** → click **Generate a new client secret** → copy it.
4. Open `supabase\.env` (e.g. with `notepad supabase\.env` from PowerShell) and uncomment / set:

   ```env
   GITHUB_ENABLED=true
   GITHUB_CLIENT_ID=<paste client id>
   GITHUB_SECRET=<paste client secret>
   ```

5. Restart the auth service so it picks up the new env (**PowerShell**):

   ```powershell
   docker compose -f supabase/docker-compose.yml restart auth
   ```

## 6. Apply database migrations

The migration script shells out to `docker exec` and uses bash heredocs, so
run it in **Git Bash**:

```bash
./scripts/db-migrate.sh
```

This runs every `supabase/migrations/*.sql` against the `supabase-db`
container in order:

- `0001_allowed_users.sql` — invite-only allowlist table
- `0002_review_jobs.sql` — job lifecycle, RLS, NOTIFY trigger, Realtime publication
- `0003_phase4.sql` — encrypted GitHub token column (pgsodium), `diff_truncated` flag, cancel NOTIFY trigger

Re-running is safe; every migration uses `if not exists` / `on conflict do
nothing`.

## 7. Add yourself to the allowlist

Until your GitHub username is in `public.allowed_users`, sign-in succeeds at
GitHub but is rejected by the middleware. Add yourself via Studio
(<http://localhost:8000> → SQL editor) or `psql`:

```sql
insert into public.allowed_users (github_login)
values ('<your-github-username>')
on conflict (github_login) do nothing;
```

## 8. Configure the Next.js process

**PowerShell**:

```powershell
Copy-Item .env.example .env.local
```

Edit `.env.local` (e.g. `notepad .env.local`) and fill in the two empty
values from `supabase\.env`:

| `.env.local` key | Source value in `supabase/.env` |
| ---------------- | ------------------------------- |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `ANON_KEY` |
| `SUPABASE_SERVICE_ROLE_KEY` | `SERVICE_ROLE_KEY` |

`NEXT_PUBLIC_SUPABASE_URL` is already set to `http://localhost:8000` (Kong).

Optional knobs (all commented in the template):

- `MAX_JOBS_PER_USER` — default 1
- `LOG_LEVEL`, `LOG_PRETTY` — pino logger config

## 9. Configure the worker

**PowerShell**:

```powershell
Copy-Item packages/worker/.env.example packages/worker/.env
```

Edit `packages\worker\.env`:

| Key | Value |
| --- | ----- |
| `DATABASE_URL` | `postgres://postgres:<POSTGRES_PASSWORD>@localhost:5432/postgres` (paste `POSTGRES_PASSWORD` from `supabase/.env`) |
| `SUPABASE_URL` | `http://localhost:8000` (already set) |
| `SUPABASE_SERVICE_ROLE_KEY` | mirror of `supabase/.env`'s `SERVICE_ROLE_KEY` |

**For real reviews** add (not in the template — it's only required by the
docker-compose overlay, but the local worker also reads it):

```env
OPENCODE_ZEN_API_KEY=<your opencode-zen key>
REVIEW_EXECUTOR=opencode
REVIEW_MODEL=opencode-zen/glm-4.7
```

**For development without an opencode-zen key** use the stub executor — it
emits deterministic fake chunks so the rest of the pipeline still works:

```env
REVIEW_EXECUTOR=stub
```

## 10. Start the long-running processes

You need **two** processes running side-by-side (in addition to the Supabase
docker stack from step 4). Use two separate PowerShell windows.

### 10a. Next.js dev server — PowerShell window 1

```powershell
npm run dev
```

Serves <http://localhost:3000> (Turbopack). Hot-reloads on file change.

### 10b. Review worker — PowerShell window 2 (pick one option)

The worker watches the `review_jobs` table and processes pending rows.
**Only one worker should run at a time** — running two will race over claims
and is not supported.

**Option A — local node process (recommended for dev, hot-reloads):**

```powershell
npm run dev --workspace @enhanced-review/worker
```

Reads `packages\worker\.env`. Connects to Supabase via the host-exposed
ports (`localhost:5432`, `localhost:8000`).

**Option B — docker container on the Supabase network:**

```powershell
docker compose -f docker-compose.worker.yml up -d --build
```

Reads variables from your shell environment (or a root `.env` file). The
overlay joins the `supabase_default` network so it can reach `db:5432` and
`kong:8000` by service name. Set in **PowerShell** before running compose
(these last only for the current PowerShell session — set them again if you
open a new window):

```powershell
$env:POSTGRES_PASSWORD = "<from supabase/.env>"
$env:SERVICE_ROLE_KEY  = "<from supabase/.env>"
$env:OPENCODE_ZEN_API_KEY = "<your key>"
```

To make them stick across reboots, use `setx` instead (note: `setx` does not
update the current session — open a new PowerShell window after running):

```powershell
setx POSTGRES_PASSWORD "<from supabase/.env>"
setx SERVICE_ROLE_KEY  "<from supabase/.env>"
setx OPENCODE_ZEN_API_KEY "<your key>"
```

Tail with `docker logs -f enhanced-review-worker`.

## 11. Smoke test — end-to-end

1. Open <http://localhost:3000> in a browser.
2. Click **Sign in with GitHub** → authorize the OAuth app → you should land back on the app.
3. Pick a repository → pick a PR or branch → click **Review**.
4. Watch the chunks stream in. A successful run ends with `status='done'`.

If anything goes wrong, check:

- Worker logs (`docker logs -f enhanced-review-worker` in PowerShell, or the PowerShell window running `npm run dev --workspace @enhanced-review/worker`)
- Next.js terminal output (PowerShell window 1)
- Supabase Studio → Table editor → `review_jobs` for the row's `status` and `error_message`
- `http://localhost:3000/api/health` in a browser for queue depth

---

## File-by-file: where every secret lives

| File | Gitignored? | Contains | Read by |
| ---- | ----------- | -------- | ------- |
| `supabase\.env` | yes | All Supabase service secrets, GitHub OAuth, dashboard creds | Supabase docker stack |
| `.env.local` | yes | `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY` | Next.js dev server |
| `packages\worker\.env` | yes | `DATABASE_URL`, service role key, `OPENCODE_ZEN_API_KEY` | Local worker (Option A) |
| Windows env vars (`$env:` / `setx`) | n/a | `POSTGRES_PASSWORD`, `SERVICE_ROLE_KEY`, `OPENCODE_ZEN_API_KEY` | docker-compose worker overlay (Option B) |

None of the `.env*` files (other than `.env.example`) are committed.

## Stop / reset

**PowerShell**:

```powershell
# Stop the worker.
#   Option A: Ctrl+C in the PowerShell window running npm.
#   Option B:
docker compose -f docker-compose.worker.yml down

# Stop the Next.js dev server: Ctrl+C in its PowerShell window.

# Stop Supabase but keep the database volume.
docker compose -f supabase/docker-compose.yml down

# NUKE: drop the database volume too. You'll need to re-run step 6
# (migrations) and step 7 (allowlist) afterwards.
docker compose -f supabase/docker-compose.yml down -v
```

## After-restart shortcut

For day-to-day work after the one-time setup is done, you only need
**PowerShell**:

```powershell
docker compose -f supabase/docker-compose.yml up -d   # any window, returns immediately
npm run dev                                           # window 1
npm run dev --workspace @enhanced-review/worker       # window 2
```

GitHub OAuth, allowlist row, generated keys, and applied migrations all
persist in the Supabase volume across host reboots.
