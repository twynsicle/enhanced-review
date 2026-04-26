# Running enhanced-review locally

Every manual step required to take a fresh clone of this repo to a working
local deployment. No Docker required for the app — you need Node, the
PocketBase binary (downloaded by an npm script), and a GitHub OAuth app.

For day-2 operations on a running stack (allowlist, key rotation, log
tailing) see [docs/OPERATIONS.md](OPERATIONS.md). For the architecture
overview see [docs/README.md](README.md).

---

## Shell conventions used in this doc

Both **PowerShell** and **Git Bash** work for every command in this doc.
The installer (`npm run pb:install`) and launcher (`npm run pb`) are `.mjs`
scripts and behave the same in either shell.

The PocketBase superuser-create command is the one place a shell quirk
matters — it takes a `--dir` flag with an absolute path. Both shells'
syntax is shown in §3.

---

## 1. Prerequisites — install on your machine

| Tool                                                  | Version | Purpose                                                           |
| ----------------------------------------------------- | ------- | ----------------------------------------------------------------- |
| [Node.js for Windows](https://nodejs.org/en/download) | >= 20.9 | Next.js 16 minimum, also runs the in-process review runner        |
| npm (bundled with Node)                               | >= 10   | Workspace support                                                 |
| [Git for Windows](https://git-scm.com/download/win)   | recent  | `git` on PATH for the runner's clone step; also provides Git Bash |

Verify before continuing:

```powershell
node --version      # v20.9.0 or higher
npm --version       # 10.x or higher
git --version
```

Docker is **not** required.

## 2. External accounts and credentials you need

| Credential                            | Where to get it                                          | Used by                             | Consequence if missing                                                                                    |
| ------------------------------------- | -------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| GitHub OAuth app (Client ID + Secret) | <https://github.com/settings/developers> → New OAuth App | PocketBase Auth                     | Cannot sign in. App is unusable.                                                                          |
| Anthropic API key                     | <https://console.anthropic.com> → API Keys               | Review runner (`ANTHROPIC_API_KEY`) | Runner cannot run real reviews. You can still develop against the stub executor (`REVIEW_EXECUTOR=stub`). |
| GitHub username (yours)               | the username you'll sign in with                         | Allowlist row in PocketBase         | OAuth login is rejected by middleware.                                                                    |

Nothing in this project requires a paid third-party service for development —
the stub executor is enough to exercise the full streaming path without
spending Anthropic credits.

## 3. Install npm dependencies and the PocketBase binary

From the repo root:

```bash
npm install
npm run pb:install
```

`pb:install` downloads PocketBase (pinned in `scripts/pb-install.mjs`) into
`tools/pocketbase/` (gitignored). Idempotent — safe to re-run; the script
checks the pinned version and skips if already installed.

## 4. Start the PocketBase server

```bash
npm run pb
```

Serves at <http://127.0.0.1:8090>. The admin UI is at
<http://127.0.0.1:8090/_/>.

State is persisted in `pb_data/` at the repo root (gitignored). On first
start PB applies every migration in `pb_migrations/`, creating the four
data collections (`allowed_users`, `review_jobs`, `reviews`,
`review_chunks`) and the `github_login` extension to the `users` auth
collection.

To stop: `Ctrl+C` in the window running `npm run pb`.

## 5. Create the initial superuser

PB has no superuser on first start; you create one via the CLI **before**
opening the admin UI. Stop `npm run pb` first (or use a separate window).

**PowerShell:**

```powershell
./tools/pocketbase/pocketbase.exe superuser create EMAIL PASSWORD --dir="$pwd/pb_data"
```

**Git Bash:**

```bash
./tools/pocketbase/pocketbase.exe superuser create EMAIL PASSWORD --dir="$(pwd)/pb_data"
```

Use any email and a password of at least 8 characters. This account is
local-only — it never leaves your machine.

Sign in at <http://127.0.0.1:8090/_/> to verify, then restart `npm run pb`
if you stopped it.

## 6. Register a GitHub OAuth app

1. Go to <https://github.com/settings/developers> → **New OAuth App**.
2. Set:
   - **Application name**: anything (e.g. "enhanced-review local")
   - **Homepage URL**: `http://localhost:3000`
   - **Authorization callback URL**: `http://127.0.0.1:8090/api/oauth2-redirect`
3. Save → copy the **Client ID** → click **Generate a new client secret** → copy it.

The callback URL points at PocketBase, not the app. PB owns the OAuth
handshake; the app receives the result via the SDK's popup flow.

## 7. Configure the GitHub provider in PocketBase

In the admin UI (<http://127.0.0.1:8090/_/>):

1. Go to **Collections** → **users** → **Settings** (gear icon) → **Options**.
2. Scroll to **OAuth2** → enable it.
3. Click **Add provider** → choose **GitHub**.
4. Paste **Client ID** and **Client Secret**.
5. Set **Scopes** to `repo` (the cloning step in the runner needs this).
6. Save.

Verify by clicking the **Test** button next to the provider — it opens a
GitHub authorization popup; if you complete it the admin UI reports
success.

## 8. Configure the Next.js process

```powershell
Copy-Item .env.example .env.local
```

(or `cp .env.example .env.local` in Git Bash)

Edit `.env.local` and fill in:

| `.env.local` key            | Value                                                                        |
| --------------------------- | ---------------------------------------------------------------------------- |
| `POCKETBASE_ADMIN_EMAIL`    | the email from step 5                                                        |
| `POCKETBASE_ADMIN_PASSWORD` | the password from step 5                                                     |
| `ANTHROPIC_API_KEY`         | (optional) your Anthropic API key — only needed for `REVIEW_EXECUTOR=claude` |

The PB URL keys (`NEXT_PUBLIC_POCKETBASE_URL`, `POCKETBASE_URL`) are
already set to the local PB defaults. The admin credentials let the
Next.js server perform allowlist lookups (the `allowed_users` collection
has all rules `null` so only a superuser can read it) and backfill
`github_login` on user records after OAuth.

Optional knobs (all commented in the template):

- `REVIEW_EXECUTOR` — `stub` or `claude` (production default is `claude`; the template defaults to `stub` for safety)
- `REVIEW_MODEL` — Claude model id (default `claude-haiku-4-5`)
- `REVIEW_TIMEOUT_MIN` — per-job wall-clock budget (default 15)
- `MAX_JOBS_PER_USER` — per-user concurrency cap (default 1)
- `LOG_LEVEL`, `LOG_PRETTY` — pino logger config

## 9. Add yourself to the allowlist

Until your GitHub username is in the `allowed_users` collection, sign-in
succeeds at GitHub but is rejected by the middleware. Add yourself via the
admin UI: **Collections** → **allowed_users** → **+ New record** → set
`github_login` to your GitHub handle → Create.

## 10. Start the Next.js dev server

In a second window (PB stays running in the first):

```bash
npm run dev
```

Serves <http://localhost:3000> (Turbopack). Hot-reloads on file change.

The review runner runs **in-process** inside the Next.js server — there
is no separate worker process to start. Submitting a review fires
`runJob(...)` directly from the API route.

## 11. Smoke test — end-to-end

1. Open <http://localhost:3000> in a browser.
2. Click **Sign in with GitHub** → authorize the OAuth app → you should land back on the app.
3. Pick a repository → pick a PR or branch → click **Review**.
4. Watch the chunks stream in. A successful run ends with `status='done'`.

If anything goes wrong, check:

- Next.js terminal output (the `npm run dev` window) — runner logs
  appear here too, scoped with `job_id`.
- PocketBase admin UI → `review_jobs` for the row's `status` and
  `error_message`.
- <http://localhost:3000/api/health> in a browser for queue depth.

---

## File-by-file: where every secret lives

| File                    | Gitignored?            | Contains                                                   | Read by            |
| ----------------------- | ---------------------- | ---------------------------------------------------------- | ------------------ |
| `.env.local`            | yes                    | PB URL + admin creds, Anthropic API key, runner knobs      | Next.js dev server |
| `pb_data/settings.json` | yes (whole `pb_data/`) | GitHub OAuth client id + secret (managed via the admin UI) | PocketBase         |

## Stop / reset

```bash
# Stop the Next.js dev server: Ctrl+C in its window.
# Stop PocketBase: Ctrl+C in its window.

# NUKE: drop PB's database and all settings (you'll need to re-do steps 5–9).
rm -rf pb_data
```

## After-restart shortcut

Day-to-day, after the one-time setup is done:

```bash
npm run pb        # window 1
npm run dev       # window 2
```

Superuser, OAuth provider config, allowlist rows, and applied migrations
all persist in `pb_data/` across host reboots.
