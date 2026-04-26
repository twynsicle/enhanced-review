# Running enhanced-review with PocketBase (in-progress migration)

Setup steps for the **PocketBase backend** that is replacing the vendored
Supabase stack. This doc grows with each migration phase. See
[migration-pocketbase.md](migration-pocketbase.md) for the overall plan.

> **Status:** Phase 2 complete — PocketBase handles auth (sign-in,
> session, allowlist gate, sign-out). CRUD reads/writes still go through
> Supabase until Phase 3, so pages render but show no data when running
> against PB-only. Phase 5 deletes the Supabase tree.

---

## Prerequisites

| Tool | Version | Purpose |
| ---- | ------- | ------- |
| Node.js | >= 20.9 | Runs the install + launcher scripts and the Next.js app |
| Git for Windows | recent | Provides Git Bash for the few `*.sh` scripts; not required for PB itself |

Docker is **not** required for the PocketBase setup.

## 1. Install the PocketBase binary

From repo root in **PowerShell** or **Git Bash**:

```bash
npm run pb:install
```

This downloads PocketBase v0.37.3 from GitHub Releases into
`tools/pocketbase/` (gitignored). Idempotent — safe to re-run; the script
checks the pinned version and skips if already installed.

Pin lives in `scripts/pb-install.mjs` as `PB_VERSION`. Bump that value to
upgrade.

## 2. Start the PocketBase server

```bash
npm run pb
```

Serves at <http://127.0.0.1:8090>. The admin UI is at
<http://127.0.0.1:8090/_/>.

State is persisted in `pb_data/` at the repo root (gitignored). On first
start PB applies every migration in `pb_migrations/`, creating the four
data collections (`allowed_users`, `review_jobs`, `reviews`,
`review_chunks`).

To stop: `Ctrl+C` in the window running `npm run pb`.

## 3. Create the initial superuser

PB has no superuser on first start; you create one via the CLI **before**
opening the admin UI. From a separate **PowerShell** or **Git Bash**:

```bash
./tools/pocketbase/pocketbase.exe superuser create EMAIL PASSWORD --dir="$(pwd)/pb_data"
```

(Use any email and a password of at least 8 characters. This account is
local-only — it never leaves your machine.)

Then sign in at <http://127.0.0.1:8090/_/>.

## 4. Register a GitHub OAuth app for PocketBase

A new OAuth app is needed even if you already have one for the Supabase
flow — the callback URL is different.

1. Go to <https://github.com/settings/developers> → **New OAuth App**.
2. Set:
   - **Application name**: anything (e.g. "enhanced-review local (PB)")
   - **Homepage URL**: `http://localhost:3000`
   - **Authorization callback URL**: `http://127.0.0.1:8090/api/oauth2-redirect`
3. Save → copy the **Client ID** → click **Generate a new client secret** → copy it.

## 5. Configure the GitHub provider in PocketBase

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

## 6. Wire the Next.js app to PocketBase (Phase 2)

Add to `.env.local` (template in `.env.example`):

```
NEXT_PUBLIC_POCKETBASE_URL=http://127.0.0.1:8090
POCKETBASE_URL=http://127.0.0.1:8090
POCKETBASE_ADMIN_EMAIL=<the email from step 3>
POCKETBASE_ADMIN_PASSWORD=<the password from step 3>
```

The admin credentials let the Next.js server perform allowlist lookups
(the `allowed_users` collection has all rules `null` so only a superuser
can read it) and backfill `github_login` on user records after OAuth.

Add yourself to the allowlist via the admin UI: **Collections** →
**allowed_users** → **+ New record** → set `github_login` to your GitHub
handle.

Now `npm run dev` will run the app against PocketBase auth. CRUD pages
render but show no data — that's Phase 3.

---

## File reference

| Path | Gitignored? | Purpose |
| ---- | ----------- | ------- |
| `tools/pocketbase/` | yes | The PocketBase binary itself, pinned by `scripts/pb-install.mjs` |
| `pb_data/` | yes | PB's SQLite database, uploaded files, settings (incl. OAuth client secrets) |
| `pb_migrations/` | **no** (committed) | Schema migrations — applied automatically on PB startup |
| `scripts/pb-install.mjs` | committed | Downloads + extracts the PB binary |
| `scripts/pb.mjs` | committed | Launches PB with explicit `--dir` / `--migrationsDir` flags |

## After-restart shortcut

Once steps 1–5 are done once, day-to-day startup is just:

```bash
npm run pb
```

The superuser, OAuth provider config, and applied migrations all persist
in `pb_data/`.
