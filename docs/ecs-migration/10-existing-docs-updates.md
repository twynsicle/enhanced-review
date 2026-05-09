# 10 — Updates to canonical docs

Catalog of edits required in the existing `README.md`, `docs/RUNNING.md`, `docs/OPERATIONS.md`, `AGENTS.md`, and the archive folder. These changes happen in a single cleanup commit at the **end of Phase E** so the docs reflect the new system, not a migration in progress.

This doc is itself a checklist; cross off items as the cleanup PR lands.

---

## Why a separate doc for this

Documentation drift is the highest-leverage source of broken-system-onboarding. The migration changes the user-facing setup steps (PB binary install → docker compose), the day-2 ops (admin UI → DB queries via ECS Exec), and the architecture map (PB → Postgres + Auth.js). Each of those lives in a different file. This doc lists every line that needs to change so nothing falls through.

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

- **Deployment.** Two short paragraphs:
  - "Built as a single Docker image (Dockerfile at root). Multi-container Fargate task in `terraform/` runs the image alongside a Postgres sidecar with EFS-backed storage. Behind ALB + Cognito + ACM cert."
  - "CD via GitHub Actions, OIDC. Push to main → image deploy. Touching `terraform/**` → infra deploy with manual approval. See `docs/ecs-migration/`."

### Triggers section

The existing "Keeping this file up to date" section is good — keep verbatim, just add: "A change to the Terraform module's task-definition shape" and "A change to how secrets are wired" as new triggers.

---

## `docs/archive/`

Move the soon-to-be-stale PB content here for posterity. Useful in case anyone needs to compare. Helpful for the proposal docs ([11](./11-proposal-lightweight-infra.md), [12](./12-proposal-software-stack.md)) when you want to point at "what we replaced".

### Files to create

- `docs/archive/pocketbase-runbook.md` — extracted from the current `OPERATIONS.md`. The PB-specific sections (admin UI walkthroughs, key rotation, allowlist management).
- `docs/archive/pocketbase-architecture.md` — extracted from the current `README.md` + `AGENTS.md`. The PB-specific architecture summary, collections list, auth flow.

Each archived file gets a header:

```markdown
# Archived: PocketBase runbook (pre-ECS migration)

This document captures the day-2 runbook from when `enhanced-review` ran on PocketBase. Preserved for historical reference. The current architecture is documented in `docs/OPERATIONS.md`. The migration is in `docs/ecs-migration/`.

> Last accurate: <date> at commit <sha>
```

Don't update these after archiving; they're snapshots, not living docs.

---

## `.env.example`

Already covered in [05](./05-local-docker.md). Listed here for completeness — it's part of the same "make it match the new world" cleanup.

---

## Cleanup commit ordering

Recommended PR sequence to avoid in-between broken states:

1. **Phase A-D code changes land in their own PRs** (with placeholder doc updates that just say "TODO: rewrite for Postgres"). The repo is functionally migrated but docs are stale.
2. **Phase E doc cleanup PR** — single commit that updates all the files in this checklist, archives the PB content, and deletes the placeholder TODOs.
3. **Phase F proposal docs PR** — independent, can be in parallel with or after step 2.

This keeps each PR reviewable. If you bundle docs with code, the PR is too big to review well; if you bundle them after, the docs are wrong for a few days. The placeholder TODOs are the bridge.

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
