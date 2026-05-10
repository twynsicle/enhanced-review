# 10 — Updates to canonical docs

> **Status: largely superseded.** Doc 10 was originally a forward-looking checklist of doc rewrites to bundle into one Phase E commit. In practice every Phase B-D commit updated the relevant docs as it went (Phase B commit 8 refreshed README/RUNNING/AGENTS/.env.example; Phase C commit 9 split doc 06 + updated AGENTS for Terraform; Phase D commit 9 aligned doc 07/08 + AGENTS/README/RUNNING for CD). Phase E commit 1 picked up the only remaining drift (`docs/README.md`, overlooked in B-D), audited the rest, and decided to **skip** the prescribed `docs/archive/pocketbase-runbook.md` + `pocketbase-architecture.md` (the existing `docs/archive/migration-pocketbase.md` is sufficient historical context). This file is preserved as the decision record + per-doc ✓ checklist below; do not treat the prescriptions as a future work plan.

Catalog of edits originally planned for the existing `README.md`, `docs/RUNNING.md`, `docs/OPERATIONS.md`, `AGENTS.md`, and the archive folder. The cleanup commit framing was abandoned in favor of incremental updates during B-D.

---

## Why a separate doc for this

Documentation drift is the highest-leverage source of broken-system-onboarding. The migration changes the user-facing setup steps (PB binary install → docker compose), the day-2 ops (admin UI → DB queries via ECS Exec), and the architecture map (PB → Postgres + Auth.js). Each of those lives in a different file. This doc was the catalog so nothing fell through. (See status note at the top — incremental B-D updates closed most items already.)

---

## `README.md`

### Sections to rewrite

- **Prerequisites** — drop the PocketBase binary instructions; add Docker Desktop.
- **Quickstart** — replace `npm run pb` + `npm run pb:install` + admin-UI-OAuth-config with `cp .env.example .env.local && docker compose up`.
- **Scripts table** — remove `pb`, `pb:install`; add `db:generate`, `db:migrate`, `db:studio`.
- **Architecture summary** — replace "PocketBase (single binary, SQLite)" with "Postgres (sidecar, EFS-backed in prod)".
- **Authentication** — replace the GitHub-OAuth-via-PB-admin-UI flow with the GitHub-OAuth-App-direct flow used by Auth.js.
- **Deployment** — new section: link to `docs/ecs-migration/` (this folder), summarize one-line.

### Specific text to change

- Anywhere `PocketBase` appears: change to `Postgres` or `Auth.js + Postgres`, depending on context.
- Any `pb_data/` mention: change to `data/postgres/` (local) or "EFS volume" (prod).
- Any `localhost:8090/_/` (PB admin UI): remove. There is no admin UI in the new world.
- Tech stack list: swap "PocketBase" for "Postgres + Auth.js + Drizzle".

### What to keep

- Project description / what the app does.
- The "successor to diffy POC" framing.
- The intentional-cuts list (no webhooks, no write-back to GH PRs, narrative-only).

---

## `docs/RUNNING.md`

This is the most-edited file. Rewrite for the docker-compose flow.

### New structure

```
1. Prerequisites
   - Docker Desktop (Windows: WSL2 backend)
   - Node 22 (for IDE / dev-time)
   - GitHub OAuth App created + credentials in hand
   - Anthropic API key (only if REVIEW_EXECUTOR=claude)

2. Configuration
   - cp .env.example .env.local
   - Fill in AUTH_SECRET, AUTH_GITHUB_ID, AUTH_GITHUB_SECRET, ANTHROPIC_API_KEY
   - GitHub OAuth App callback: http://localhost:3000/api/auth/callback/github

3. Run (Flow 1 — full stack)
   - docker compose up --build
   - First boot: ~3 min (build + migrate)
   - Visit http://localhost:3000

4. Run (Flow 2 — host dev, postgres in compose)
   - docker compose up postgres
   - DATABASE_URL=postgres://app:localdevpw@127.0.0.1:5432/enhanced_review npm run dev
   - Hot reload, faster iteration

5. First-time data setup
   - The first sign-in fails with /denied (allowlist gate)
   - Add yourself: docker compose exec postgres psql -U app -d enhanced_review -c "INSERT INTO allowed_users (id, github_login) VALUES (gen_random_uuid()::text, 'your-github-username')"
   - Sign in again: success

6. Resetting / troubleshooting
   - Wipe DB: docker compose down -v && rm -rf data/postgres
   - Rebuild image: docker compose build --no-cache web
   - Logs: docker compose logs -f web
```

### Things to delete

- The PB superuser-create command (was the one Windows quirk; gone).
- The PB admin UI walkthrough (no admin UI now).
- Any `npm run pb` / `npm run pb:install` mentions.
- The "OAuth provider config in admin UI" section.

---

## `docs/OPERATIONS.md`

The runbook. Rewrite to point at AWS resources instead of PB.

### Sections to update

- **Allowlist management.** Was: PB admin UI → `allowed_users` collection → add row. Becomes: `aws ecs execute-command` → `psql` → INSERT. Detailed in [09](./09-cost-and-operations.md); link there from OPERATIONS.md.
- **Key rotation.** Was: edit `pb_data/settings.json`. Becomes: Secrets Manager rotation + force-new-deployment. Link to [09](./09-cost-and-operations.md).
- **Stuck jobs.** Was: PB admin UI → `review_jobs` → set status manually. Becomes: SQL UPDATE via ECS Exec. Same logic, different access path.
- **Health endpoint.** Behavior unchanged (returns 200 + JSON), but the "what to do if `ok=false`" section needs to swap "check PB binary" for "check Postgres container logs".
- **Log shape.** The pino logger is unchanged; the way you read logs changes (CloudWatch instead of `npm run pb` stdout). Document `aws logs tail`.
- **Tunable knobs (env vars).** Drop `POCKETBASE_*`; add `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `AUTH_TRUST_HOST`, `AUTH_URL`. Note which come from Secrets Manager vs literal envs.

### Reorganization (recommended)

Split OPERATIONS.md into:

- "Local ops" — for the docker-compose flow (psql via `docker compose exec`, etc.).
- "AWS ops" — for the deployed system (mostly a pointer to [09](./09-cost-and-operations.md), since that's the long form).

Keeps the file from becoming a megadoc.

### Things to delete

- Anything referencing PB admin UI.
- `pb_data/` filesystem layout discussion.
- PB superuser auth troubleshooting.
- The "rotate PB OAuth provider client secret" procedure.

---

## `AGENTS.md`

The agent-orientation map. This is the most-read file by future Claude instances; keep it tight and accurate.

### Sections to rewrite

- **Tech stack** — remove "PocketBase (single binary, SQLite)", add "Postgres 17 sidecar; Drizzle ORM; Auth.js v5 (NextAuth) for OAuth".
- **Repo layout** — remove `pb_migrations/`, `tools/pocketbase/`, `pb_data/`. Add `terraform/`, `Dockerfile`, `docker-compose.yml`, `drizzle/`, `data/postgres/` (gitignored).
- **`src/lib/` directory entry** — remove `pb/`, add `db/`, `auth/` (already partly listed today). Update file purposes.
- **How the system fits together / Auth** — rewrite for Auth.js + database sessions + GitHub OAuth provider. Drop `gh_access_token` cookie discussion (it's gone).
- **How the system fits together / Allowlist gate** — rewrite for Drizzle query in middleware + sign-in callback.
- **PocketBase collections section** — replace with a "Postgres tables" section listing the same tables, plus the Auth.js standard tables. Drop the access-rules column (no rules; permissions live in route handlers).
- **Common scripts table** — remove `pb`, `pb:install`; add `db:generate`, `db:migrate`, `db:studio`.
- **Environment** — sync with the new `.env.example`. Drop PB vars; add Auth.js + DB vars.
- **Conventions** — keep the path-alias note. Remove `pbServer` / `pbAdmin` / `pbBrowser` mentions; add the `db` from `@/lib/db/client` and `auth` from `@/lib/auth/auth` entry points.

### New section to add

- **Deployment.** Already added in Phase C (Terraform shape) and refreshed in Phase D commit 9 (CD workflows + IAM roles). Phase E pass should re-read for accuracy after a real deploy cycle has run.

### Triggers section

The existing "Keeping this file up to date" section is good — keep verbatim, just add: "A change to the Terraform module's task-definition shape" and "A change to how secrets are wired" as new triggers.

---

## `docs/archive/`

> **Decision (Phase E, 2026-05-09): skipped.** `docs/archive/migration-pocketbase.md` already exists as the historical record of the PB-era system (it was the migration plan from the original `pocketbase` → `pocketbase-with-streams` work). Re-extracting PB-specific OPERATIONS / README sections from pre-Phase-A git history into separate `pocketbase-runbook.md` / `pocketbase-architecture.md` files would duplicate that content with minimal added value. Anyone curious about the PB-era day-2 ops can read `migration-pocketbase.md` or `git log --all -- 'docs/OPERATIONS.md'` for the unfiltered history.

The original prescription is preserved below for the decision record.

### Files prescribed (NOT created)

- ~~`docs/archive/pocketbase-runbook.md`~~ — would have been extracted from the PB-era `OPERATIONS.md`.
- ~~`docs/archive/pocketbase-architecture.md`~~ — would have been extracted from the PB-era `README.md` + `AGENTS.md`.

---

## `.env.example`

Already covered in [05](./05-local-docker.md). Listed here for completeness — it's part of the same "make it match the new world" cleanup.

---

## Cleanup commit ordering

> **Superseded.** The original plan was: code + placeholder-TODOs in B-D PRs, then one big doc cleanup PR in Phase E. Reality was: each B-D commit updated the touched docs alongside the code change. By the time Phase E started, only `docs/README.md` was stale (not part of any of those edit-sites; missed). The "single Phase E cleanup PR" became Phase E commit 1 — a small drift fix + plan-of-record commit, not a megacommit.

The original prescription is preserved below.

### Original prescription

1. **Phase A-D code changes land in their own PRs** (with placeholder doc updates that just say "TODO: rewrite for Postgres"). The repo is functionally migrated but docs are stale.
2. **Phase E doc cleanup PR** — single commit that updates all the files in this checklist, archives the PB content, and deletes the placeholder TODOs.
3. **Phase F proposal docs PR** — independent, can be in parallel with or after step 2.

---

## Sanity check before merging the cleanup PR

Run these greps:

```sh
# Should return zero matches
grep -ri "pocketbase\|pb_data\|pb_migrations\|pbServer\|pbAdmin\|pbBrowser\|gh_access_token" . \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=docs/archive

# Should match in docs/archive/ only
grep -ri "PocketBase" docs/

# Verify all 13 ecs-migration docs exist
ls docs/ecs-migration/0*.md docs/ecs-migration/1*.md
```

Plus a manual read-through:

- `README.md` — does the quickstart actually work for someone who's never seen the repo?
- `RUNNING.md` — did you walk it from scratch on a clean machine?
- `OPERATIONS.md` — does every linked aws CLI command actually exist?
- `AGENTS.md` — does the directory map match `ls`?

---

## Verification

Phase E success:

1. The grep above returns empty (excluding archive).
2. All four canonical docs read coherently for someone unfamiliar with the codebase.
3. The cleanup PR doesn't accidentally delete anything still referenced (lint catches dead links).
4. `docs/archive/` has the two PB snapshots, dated.
5. A fresh-clone walk-through of `RUNNING.md` succeeds end-to-end on a different machine if possible (or at least a fresh `~/projects/enhanced-review-test/`).
