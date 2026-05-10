# Phase E — Operations + docs — execution plan

**Status:** ready to execute. **Companion to:** [09-cost-and-operations.md](./09-cost-and-operations.md), [10-existing-docs-updates.md](./10-existing-docs-updates.md), [00-overview.md](./00-overview.md).

This file is the ordered task list for Phase E: close out the migration's documentation, pick up the most useful items deferred from Phase D, and verify the canonical docs are accurate against the running system.

By the end, a maintainer can:

1. Re-clone the repo into a fresh sibling directory and walk `docs/RUNNING.md` end-to-end without surprises.
2. Bring up a fresh ECS environment without an out-of-band `INSERT INTO allowed_users` step — the entrypoint seeds it from a Terraform-supplied `SEED_GITHUB_LOGIN` env var.
3. Get an email if the AWS account-level monthly spend approaches a $50 budget.
4. Read a single canonical set of docs (`README.md`, `docs/README.md`, `docs/RUNNING.md`, `docs/OPERATIONS.md`, `AGENTS.md`, plus the `ecs-migration/` folder) that all describe the same shipped system.

---

## Context

Phase E was originally scoped (per [doc 10](./10-existing-docs-updates.md)) as "rewrite the canonical docs in a single cleanup commit at the end". In practice, every Phase B-D commit updated the relevant docs as it went (Phase B commit 8 refreshed README/RUNNING/AGENTS/.env.example; Phase C commit 9 split doc 06 + updated AGENTS for Terraform; Phase D commit 9 aligned doc 07/08 + AGENTS/README/RUNNING for CD). A pre-planning audit confirmed:

- The four canonical agent/operator docs already describe the Postgres + Auth.js + ECS world. Zero PocketBase references remain in `README.md` (root), `docs/RUNNING.md`, `docs/OPERATIONS.md`, or `AGENTS.md`.
- `.env.example` is already Postgres-shaped.
- `docs/archive/migration-pocketbase.md` already exists; the user explicitly chose to **skip** the additional `pocketbase-runbook.md` / `pocketbase-architecture.md` files prescribed in doc 10 (migration-pocketbase.md is sufficient historical context).
- All 10 resource-name / path / ARN claims in [doc 09](./09-cost-and-operations.md) match the actual shipped Terraform — no drift to fix.

A late-audit finding (during commit 1 of this phase): **`docs/README.md` is significantly stale** — it still describes PocketBase as the data store, lists `src/lib/pb/`, `pb_migrations/`, `tools/pocketbase/`, and `pb_data/` in the repo layout, and frames the deployment target as "PB on a Fargate task with EFS for `pb_data/`". This file was overlooked in Phases B-D incremental doc updates. Folded into commit 1.

That leaves Phase E with three substantive workstreams:

1. **Doc verification + spot-fixes** — rewrite `docs/README.md`; confirm the audit's "no other drift" finding by walking `RUNNING.md` from a fresh clone.
2. **Two of the seven Phase D deferred items** (chosen 2026-05-09):
   - **`SEED_GITHUB_LOGIN` env var + entrypoint seed step** — replaces the manual ECS Exec `INSERT INTO allowed_users` step from Phase D. Useful for the doc 11/12 "reusable template" pitch — onboarding becomes one tfvar instead of a runbook entry.
   - **$50/mo budget alarm in Terraform** — free safety net via `aws_budgets_budget`'s built-in email notifications. Doc 09 already recommends it.
3. **Doc close-out** — update doc 09 (replace manual INSERT step with `SEED_GITHUB_LOGIN` reference; add budget alarm to cost table; brief rollback mention), doc 10 (mark items as already-done; record the PB-archive skip decision), doc 00 (add `phase-e-plan.md` to index; mark Phase E row complete), AGENTS.md (note the new env var), and this plan (status flip).

The other five Phase D deferred items (drift-detect.yml, Slack/email deploy notifications, tighter TF role permissions, rollback-runbook section beyond what fits naturally in doc 09, GHA cache hygiene) are **deliberately out of scope** — captured in "Open questions" below.

---

## Decisions made during planning

These were chosen on 2026-05-09 when the plan was drafted (E1-E12) plus one amendment during commit 1 execution (E13).

| #   | Topic                                                         | Decision                                                                                                                                                                                                                                                                          | Rationale                                                                                                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E1  | Phase E scope                                                 | Doc verification + 2 Phase-D deferred items (SEED_GITHUB_LOGIN, budget alarm) + doc close-out                                                                                                                                                                                     | Most of doc 10's checklist is already done. The Phase D deferred backlog is the meaningful work.                                                                                                                                                                                                                                                                         |
| E2  | PocketBase archive                                            | Skip `pocketbase-runbook.md` + `pocketbase-architecture.md`; rely on existing `docs/archive/migration-pocketbase.md`                                                                                                                                                              | Re-extracting PB content from git history adds little value. Doc 10 will be updated to record this.                                                                                                                                                                                                                                                                      |
| E3  | Container seed implementation                                 | New `scripts/db-seed.cjs` (raw pg, explicit `gen_random_uuid()::text` for `id`). Local `npm run db:seed` keeps using `scripts/db-seed.ts`.                                                                                                                                        | The TS version imports from `src/lib/db/schema`, but `src/` isn't copied to the runtime image — only `drizzle/` and `scripts/`. Mirroring the `recover-jobs.cjs` pattern (`Pool`, raw SQL) is the cleanest fit. Slight duplication accepted (~30 LOC each). The `id` column must be supplied explicitly because Drizzle's `$defaultFn` is application-side, not DB-side. |
| E4  | Seed env var as plain env, not secret                         | `SEED_GITHUB_LOGIN` is added to the task-def `environment[]` (not `secrets[]`). Default empty string in `var.seed_github_login`.                                                                                                                                                  | Username is not sensitive. Empty default keeps the entrypoint a no-op for any future env that doesn't set it (mirrors local-dev behavior).                                                                                                                                                                                                                               |
| E5  | Budget alarm location                                         | `terraform/platform/budget.tf` (account-scoped, not per-app)                                                                                                                                                                                                                      | Budget is on total AWS account spend; if a second app joins the platform later, the alarm covers them too.                                                                                                                                                                                                                                                               |
| E6  | Budget alarm notification channel                             | `aws_budgets_budget` `notification` block with `subscriber_email_addresses` (no SNS)                                                                                                                                                                                              | Built-in Budgets notifications skip the SNS confirmation flow. Simpler. Phase E goal is "free safety net", not "rich alerting".                                                                                                                                                                                                                                          |
| E7  | Budget alarm email source                                     | Required tfvars input `var.budget_alert_email` (no default), supplied to CI via GitHub secret + `TF_VAR_` env var                                                                                                                                                                 | See E13 below — both new vars use the same GitHub-secret pattern as `AWS_ACCOUNT_ID` for parity.                                                                                                                                                                                                                                                                         |
| E8  | Budget alarm thresholds                                       | 80% (alert), 100% (alert), 120% forecast                                                                                                                                                                                                                                          | Mid-month early warning + month-end exceedance + forecast-based heads-up. AWS Budgets supports all three from one resource.                                                                                                                                                                                                                                              |
| E9  | Image change vs infra change order                            | Land entrypoint/image change first, THEN the task-def env var change                                                                                                                                                                                                              | Reverse order would deploy a task-def with `SEED_GITHUB_LOGIN` set against an old image whose entrypoint ignores it — harmless but wasteful (no-op). Image-first means entrypoint exists when the env var arrives.                                                                                                                                                       |
| E10 | Race rule from Phase D                                        | Keep `terraform/**` and source changes in **separate PRs** (per phase-d-plan risk note)                                                                                                                                                                                           | Each pipeline fires on its own paths-filter; mixing causes parallel-pipeline races. Plan splits the seed work into PR 2 (image) and PR 3 (TF env var).                                                                                                                                                                                                                   |
| E11 | Verification approach                                         | Manual fresh-clone walkthrough of `RUNNING.md` on this machine                                                                                                                                                                                                                    | Catches drift between docs and reality. Different-machine test is stricter but the user accepted "this machine" as sufficient for POC scope.                                                                                                                                                                                                                             |
| E12 | Plan format                                                   | This file (`phase-e-plan.md`) — same shape as Phase B/C/D plans                                                                                                                                                                                                                   | Pattern proven; reuse it.                                                                                                                                                                                                                                                                                                                                                |
| E13 | New TF vars sourced via GitHub secrets, not local-only tfvars | Both `seed_github_login` and `budget_alert_email` are wired through `TF_VAR_*` env vars in `deploy-infra.yml`'s plan step, sourced from GitHub secrets. Local-only tfvars would cause CI drift each apply (resource exists in state, var unset in CI plan → TF wants to destroy). | Mirrors the existing `AWS_ACCOUNT_ID` + `TF_VAR_platform_state_bucket` pattern. Adds two `gh secret set` manual steps but no scope creep into a different sourcing model.                                                                                                                                                                                                |

---

## Pre-flight (current state of the branch)

Phase D is merged on `migrate-ecs`. The repo has:

- Production deployment running: ECS service `enhanced-review` on cluster `platform-cluster`, real Next.js image, `REVIEW_EXECUTOR=claude`, three OAuth/Anthropic secrets populated, allowlist seeded manually via ECS Exec for `twynsicle`.
- Two CD workflows live: `.github/workflows/deploy-image.yml` (push to main → image build + ECS update) and `.github/workflows/deploy-infra.yml` (PR → plan; merge → approval-gated apply).
- Two IAM roles: `enhanced-review-github-image-deploy` (in app module) and `enhanced-review-github-tf` (in platform module).
- `production` GitHub Environment with the maintainer as required reviewer.
- `AWS_ACCOUNT_ID` GitHub secret set.
- Phase D plan committed as completed (commit `ef847b1` "Phase D" on `migrate-ecs`).
- Five secrets in Secrets Manager, all populated.
- Branch protection on `main`: PRs required, no bypass.

---

## Task sequence (one logical commit per heading)

Each section below is one logical commit (one PR), in order. Per E10, image-touching and Terraform-touching changes go in separate PRs.

### 1. Add this plan + doc audit + `docs/README.md` rewrite + `*.tfvars` gitignore

**Files (new):**

- `docs/ecs-migration/phase-e-plan.md` (this file)

**Files (edited):**

- `docs/README.md` — full rewrite. Was PB-shaped (lists `src/lib/pb/`, `pb_migrations/`, `tools/pocketbase/`, `pb_data/`; describes auth as PocketBase Auth, streaming as PocketBase realtime SSE, deployment as "PB on a Fargate task with EFS for `pb_data/`"). Becomes Postgres + Drizzle + Auth.js + LISTEN/NOTIFY + ECS-shaped, mirroring the architecture as described in `AGENTS.md`.
- `.gitignore` — add `*.tfvars` (and an exception `!terraform/**/example.tfvars` if we decide to commit examples; for now just the wildcard). Defense-in-depth before commits 3-4 reference tfvars files.

**Audit work also performed (no edits needed):**

- `grep -ri "pocketbase\|pb_data\|..." . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=docs/archive --exclude-dir=docs/ecs-migration` returned only `docs/README.md` (handled here) and `docs/archive/migration-pocketbase.md` (allowed). Other matches inside `docs/ecs-migration/*` are legitimate "what we migrated from" references in the plan docs; not a defect.
- `README.md` (root), `docs/RUNNING.md`, `docs/OPERATIONS.md`, `AGENTS.md`, `.env.example` spot-checked clean against current code (npm scripts, env vars, table names, directory listings).
- `db:studio` script: not present in `package.json`, not referenced in any canonical doc. Doc 10 prescribed adding it; reality is the workflow uses `db:generate` + `db:migrate` only. **Decision: skip** (per open question).

**Why this is its own commit:** establishes the plan-of-record and resolves the only doc drift before structural changes start landing.

**Verify:**

- `git grep -i "pocketbase\|pb_data\|pb_migrations\|pbServer\|pbAdmin\|pbBrowser\|gh_access_token" -- ':!docs/archive' ':!docs/ecs-migration'` returns zero matches.
- `cat docs/README.md` reads coherently as a post-migration architecture overview.
- `git check-ignore terraform/platform/terraform.tfvars` returns the path (gitignored).

---

### 2. Image change: `scripts/db-seed.cjs` + entrypoint seed step

**Files (new):**

- `scripts/db-seed.cjs`

**Files (edited):**

- `scripts/entrypoint.sh` — add a seed step between migrations and recover-jobs
- `Dockerfile` — copy `db-seed.cjs` into the runtime image

**`scripts/db-seed.cjs` shape** (mirrors `scripts/recover-jobs.cjs` — `Pool`, raw SQL, no Drizzle, no compile step):

```js
const { Pool } = require('pg');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required to run the seed.');
  }
  const login = (process.env.SEED_GITHUB_LOGIN || '').trim();
  if (!login) {
    console.log('[seed] SEED_GITHUB_LOGIN not set — skipping.');
    return;
  }

  // Drizzle's $defaultFn for the id column runs in the application layer,
  // not the database, so raw SQL must supply id explicitly. gen_random_uuid()
  // is built into Postgres 13+ — no extension needed on postgres:17-alpine.
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const { rowCount } = await pool.query(
      `INSERT INTO allowed_users (id, github_login)
       VALUES (gen_random_uuid()::text, $1)
       ON CONFLICT (github_login) DO NOTHING`,
      [login],
    );
    if (rowCount > 0) {
      console.log(`[seed] inserted '${login}' into allowed_users.`);
    } else {
      console.log(`[seed] allowlist already contains '${login}' — no-op.`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[seed] failed:', err && err.message ? err.message : err);
  // Never block startup on a seed failure.
  process.exit(0);
});
```

**`scripts/entrypoint.sh` (post-edit):**

```sh
#!/bin/sh
set -eu

echo "[entrypoint] running migrations…"
node /app/drizzle/migrate.mjs

echo "[entrypoint] seeding allowlist…"
node /app/scripts/db-seed.cjs || echo "[entrypoint] seed failed (continuing)"

echo "[entrypoint] recovering interrupted jobs…"
node /app/scripts/recover-jobs.cjs || echo "[entrypoint] recover failed (continuing)"

echo "[entrypoint] starting next…"
exec "$@"
```

**`Dockerfile` (delta):** add to the runtime stage (next to the existing `recover-jobs.cjs` copy):

```dockerfile
COPY --chown=nextjs:nodejs scripts/db-seed.cjs ./scripts/db-seed.cjs
```

**Why this is its own commit:** image-only change. Lands via PR; merge fires `deploy-image.yml`. After deploy, the entrypoint has the new seed step but the task-def doesn't supply `SEED_GITHUB_LOGIN` yet → seed is a no-op. System stays healthy. Commit 3 then adds the env var.

**Verify (post-merge):**

- `deploy-image.yml` runs to completion.
- New task starts. CloudWatch `/ecs/enhanced-review` web stream shows the seed-skip log line (`SEED_GITHUB_LOGIN not set — skipping`).
- `/api/health` returns 200; sign-in still works.

---

### 3. Infra change: `SEED_GITHUB_LOGIN` env var in task-def + workflow wiring

**Files (edited):**

- `terraform/apps/enhanced-review/variables.tf` — add `var.seed_github_login` (default `""`)
- `terraform/apps/enhanced-review/task-definition.tf` — add the env var to the `web` container's `environment[]` block
- `.github/workflows/deploy-infra.yml` — add `TF_VAR_seed_github_login: ${{ secrets.SEED_GITHUB_LOGIN || '' }}` to the plan job's env block

**`variables.tf` addition:**

```hcl
variable "seed_github_login" {
  description = "GitHub username to seed into allowed_users on container start. Empty = no-op (keeps Phase D's manual-seed posture). Set via TF_VAR_seed_github_login (sourced from GitHub secret SEED_GITHUB_LOGIN in CI; via terraform.tfvars locally)."
  type        = string
  default     = ""
}
```

**`task-definition.tf` delta** — add to the `web` container's `environment[]` array:

```hcl
{ name = "SEED_GITHUB_LOGIN", value = var.seed_github_login },
```

**`deploy-infra.yml` env block (plan job):** extend the existing env on the `plan` step:

```yaml
- id: plan
  env:
    TF_VAR_platform_state_bucket: enhanced-review-tfstate-${{ secrets.AWS_ACCOUNT_ID }}
    TF_VAR_seed_github_login: ${{ secrets.SEED_GITHUB_LOGIN || '' }}
  run: |
    terraform plan -no-color -out=tfplan -input=false 2>&1 | tee plan.txt
    terraform show -no-color tfplan > plan-show.txt
  continue-on-error: true
```

(Apply step doesn't need the env var: `terraform apply tfplan` reads var values baked into the saved plan.)

**Manual setup before merge (one-time):**

```sh
gh secret set SEED_GITHUB_LOGIN --body "twynsicle"
gh secret list   # verify SEED_GITHUB_LOGIN appears
```

**`terraform/apps/enhanced-review/terraform.tfvars` (gitignored, manual, optional)** — for local applies:

```hcl
seed_github_login = "twynsicle"
```

**Service rollover:** `aws_ecs_service.app` has `lifecycle { ignore_changes = [task_definition] }`. Apply registers task-def revision N+1 but doesn't roll the service. To roll N+1 onto the running task without waiting for a code change:

```sh
aws ecs update-service --cluster platform-cluster --service enhanced-review --force-new-deployment
```

The new task starts with `SEED_GITHUB_LOGIN=twynsicle` set, the seed runs idempotently and logs "allowlist already contains 'twynsicle' — no-op" (twynsicle was manually seeded in Phase D).

**Verify (during PR + after merge):**

- During PR: `deploy-infra.yml` plan job posts a PR comment for `apps/enhanced-review` showing one task-def revision change adding `SEED_GITHUB_LOGIN`. Platform plan comment shows "no changes".
- After merge: app apply registers task-def revision N+1.
- After manual `force-new-deployment`: CloudWatch shows the seed log line "allowlist already contains 'twynsicle' — no-op".
- `psql -U app -d enhanced_review -c "SELECT github_login, COUNT(*) FROM allowed_users GROUP BY github_login;"` shows exactly one row for `twynsicle` (no duplicate).
- Sign-in flow still works.

---

### 4. Infra change: $50/mo budget alarm (platform module) + workflow wiring

**Files (new):**

- `terraform/platform/budget.tf`

**Files (edited):**

- `terraform/platform/variables.tf` — add `var.budget_alert_email` (no default; required)
- `.github/workflows/deploy-infra.yml` — add `TF_VAR_budget_alert_email: ${{ secrets.BUDGET_ALERT_EMAIL }}` to the plan job's env block

**`variables.tf` addition:**

```hcl
variable "budget_alert_email" {
  description = "Email address to notify when AWS account spend approaches $50/mo. Required. Sourced from GitHub secret BUDGET_ALERT_EMAIL in CI; from terraform.tfvars locally."
  type        = string
}
```

**`budget.tf`:**

```hcl
# Account-level monthly cost alarm. Per doc 09 the steady-state spend is
# ~$37/mo, so 80% of $50 = $40 may fire mid-month if Anthropic API spend
# is non-trivial; raise the limit if false positives become annoying.
resource "aws_budgets_budget" "monthly" {
  name         = "platform-monthly-50usd"
  budget_type  = "COST"
  limit_amount = "50"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  # 80% actual: mid-month heads-up
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_alert_email]
  }

  # 100% actual: month-end exceedance
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_alert_email]
  }

  # 120% forecasted: heads-up that current burn rate will exceed budget
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 120
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_alert_email]
  }
}
```

**`deploy-infra.yml` env block (plan job):** further extend the env from commit 3:

```yaml
- id: plan
  env:
    TF_VAR_platform_state_bucket: enhanced-review-tfstate-${{ secrets.AWS_ACCOUNT_ID }}
    TF_VAR_seed_github_login: ${{ secrets.SEED_GITHUB_LOGIN || '' }}
    TF_VAR_budget_alert_email: ${{ secrets.BUDGET_ALERT_EMAIL }}
  ...
```

(No fallback `|| ''` because `var.budget_alert_email` is required — empty would fail validation.)

**Manual setup before merge (one-time):**

```sh
gh secret set BUDGET_ALERT_EMAIL --body "your.email@example.com"
gh secret list   # verify BUDGET_ALERT_EMAIL appears
```

**`terraform/platform/terraform.tfvars` (gitignored, optional, for local applies):**

```hcl
budget_alert_email = "your.email@example.com"
```

**TF role permissions:** `aws_budgets_budget` requires `budgets:*` on `enhanced-review-github-tf`. Per phase-d-plan, the role uses broad name-prefix scoping. If `AccessDenied` surfaces during plan/apply, add `budgets:CreateBudget`, `budgets:DescribeBudget`, `budgets:UpdateBudget`, `budgets:DeleteBudget`, `budgets:ViewBudget`, `budgets:ModifyBudget` (and notification variants) to `terraform/platform/iam-github-tf.tf` and locally re-apply before retrying the pipeline.

**Verify (during PR + after merge):**

- Plan comment for `platform` shows one budget + three notifications. Plan comment for `apps/enhanced-review` shows "no changes".
- After merge: apply succeeds. `aws budgets describe-budgets --account-id $(aws sts get-caller-identity --query Account --output text)` returns `platform-monthly-50usd`.
- `aws budgets describe-notifications-for-budget --account-id $(...) --budget-name platform-monthly-50usd` returns 3 notifications.

---

### 5. Manual: fresh-clone walkthrough of `RUNNING.md`

Phase E exit-gate verification. Not a commit; the maintainer runs it once.

1. `cd ..` (out of the working repo).
2. `git clone https://github.com/twynsicle/enhanced-review.git enhanced-review-fresh-test`
3. `cd enhanced-review-fresh-test`
4. Walk `docs/RUNNING.md` from the top, **not consulting any other doc** unless RUNNING.md tells you to. Track every place where a step is unclear, a command fails, a path/script/env var doesn't match, or a required step is missing.
5. Walk both Flow 1 (`docker compose up --build`) and Flow 2 (`docker compose up postgres -d` + `npm run dev`) all the way to "I signed in via GitHub and ran a stub review locally".
6. Capture findings list; apply fixes in commit 6.
7. Delete `enhanced-review-fresh-test/` afterwards.

---

### 6. Doc close-out + RUNNING.md fixes from walkthrough

**Files (edited):**

- `docs/ecs-migration/09-cost-and-operations.md`
  - "Adding/removing a user from the allowlist" section: paragraph noting that for **first-time setup** of a fresh environment, setting `seed_github_login` (via `gh secret set SEED_GITHUB_LOGIN ...` for CI, or in `terraform.tfvars` for local) is the preferred path; manual `INSERT` is for adding subsequent users.
  - "Monthly cost" table: add a `Budgets` row at $0/mo (free).
  - Add a brief "Rollback" subsection under "Continuous deployment" (1-2 paragraphs): point at `gh workflow run deploy-image.yml -f sha=<previous-good-sha>`; document `gh run list --workflow=deploy-image.yml --status=success --limit=5` to find the last-known-good SHA.
- `docs/ecs-migration/10-existing-docs-updates.md`
  - Update the introduction: note that the doc-rewrite work happened incrementally during Phases B-D rather than as a single Phase E commit; doc 10 is now a verification checklist + decisions record, not a forward-looking work plan.
  - Mark each "Sections to rewrite" / "Things to delete" item ✓ done (per Phase E commit 1 audit) or note the late-found `docs/README.md` rewrite.
  - "`docs/archive/`" section: replace the prescription with a note that `migration-pocketbase.md` already exists; the per-doc archives prescribed here are **not** being created (per E2). Cross-link to `migration-pocketbase.md`.
  - "Cleanup commit ordering" section: mark superseded by the actual incremental ordering.
- `docs/ecs-migration/00-overview.md`
  - Doc Index table: add row for `phase-e-plan.md` (mirroring B/C/D plan rows).
  - "Implementation phases" table, Phase E row: keep the fresh-clone wording; add ", plus `SEED_GITHUB_LOGIN` reseed proves no-op + budget visible in console."
- `AGENTS.md`
  - "Environment" section: add `SEED_GITHUB_LOGIN` to the env var list with a one-line note that it's set via the task-def in production (sourced from GitHub secret `SEED_GITHUB_LOGIN` → `TF_VAR_seed_github_login` in `deploy-infra.yml`).
  - "Common scripts" table: confirm `db:seed` is listed (already is per audit) and note that the production seed runs via `scripts/db-seed.cjs` (raw pg), separate from the local `scripts/db-seed.ts` (Drizzle).
  - "Deployment" section: brief mention of the new `terraform/platform/budget.tf` and the two new GitHub secrets (`SEED_GITHUB_LOGIN`, `BUDGET_ALERT_EMAIL`).
- `docs/RUNNING.md` (only if walkthrough surfaced fixes)
- `docs/ecs-migration/phase-e-plan.md` (this file)
  - Status header flip from `ready to execute` → `completed`.
  - Verification checklist below fully ticked.

**Why this is its own commit:** doc-only PR; fires neither pipeline (`paths-ignore: ['docs/**', '*.md']` on deploy-image; `paths: ['terraform/**', '.github/workflows/deploy-infra.yml']` on deploy-infra).

---

## Risks & gotchas to watch for during execution

- **`scripts/db-seed.cjs` `id` column gotcha (resolved).** Drizzle's `$defaultFn` is application-side; raw SQL `INSERT` without `id` would fail with NOT NULL violation. Plan uses `gen_random_uuid()::text` explicitly (built into Postgres 13+; no extension required on `postgres:17-alpine`).
- **Idempotent seed depends on a unique index on `github_login`.** Confirmed in `src/lib/db/schema.ts` line 81: `text('github_login').notNull().unique()`. `ON CONFLICT (github_login)` works.
- **Empty seed default behavior.** With `var.seed_github_login = ""` (default), entrypoint logs the skip line — same as today.
- **Race rule (E10).** Don't combine the entrypoint change (commit 2) with the task-def change (commit 3) into one PR. Plan keeps them separate.
- **`force-new-deployment` after commit 3 is manual.** Easy to forget. Symptom: commit 3 merges, apply succeeds, but the running task is the pre-commit-3 revision (no env var). Fix: run the documented `aws ecs update-service ... --force-new-deployment`.
- **Budget alarm email confirmation.** Unlike SNS, AWS Budgets doesn't send a confirmation-link email — alerts just start arriving. First email may take up to 24h.
- **Budget threshold tuning.** Current spend ~$37/mo + Anthropic spend may exceed 80% of $50 mid-month. Adjust the limit/thresholds if false positives become annoying. Documented in commit 6.
- **Walkthrough may surface stale doc references.** The audit said most docs are clean, but a top-to-bottom walkthrough can catch subtle ordering issues. Capture findings in commit 5; apply in commit 6.
- **TF role permissions for budgets.** `aws_budgets_budget` requires `budgets:*`. Current name-prefix scoping may not cover this resource type. If `AccessDenied` surfaces during commit 4's apply, add the actions to `terraform/platform/iam-github-tf.tf` and re-apply locally first.
- **Workflow precedence on the close-out PR.** Commit 6 is doc-only; fires neither pipeline. Verify by checking workflow runs after merge.
- **Two new GitHub secrets are prerequisites.** Setting `SEED_GITHUB_LOGIN` and `BUDGET_ALERT_EMAIL` BEFORE merging commits 3 and 4 respectively is required, or the apply will fail validation.

---

## Verification checklist (Phase E exit gate)

**Doc verification + late-found rewrite (commit 1):**

- [ ] `git grep -i "pocketbase\|pb_data\|..." -- ':!docs/archive' ':!docs/ecs-migration'` returns zero matches.
- [ ] `docs/README.md` rewritten for Postgres + Auth.js + ECS.
- [ ] `*.tfvars` added to `.gitignore`.
- [ ] `docs/ecs-migration/phase-e-plan.md` present in repo with status "ready to execute".

**Image change (commit 2):**

- [ ] `scripts/db-seed.cjs` exists and uses raw `pg` Pool with explicit `gen_random_uuid()::text`.
- [ ] `scripts/entrypoint.sh` invokes the seed step between migrations and recover-jobs.
- [ ] `Dockerfile` runtime stage copies `scripts/db-seed.cjs`.
- [ ] PR merged; `deploy-image.yml` ran to completion; new task healthy; CloudWatch shows seed-skip log line.

**Infra change — env var (commit 3):**

- [ ] `terraform/apps/enhanced-review/variables.tf` has `var.seed_github_login` (default `""`).
- [ ] `terraform/apps/enhanced-review/task-definition.tf` includes `SEED_GITHUB_LOGIN` in web `environment[]`.
- [ ] `.github/workflows/deploy-infra.yml` plan step has `TF_VAR_seed_github_login` env.
- [ ] `gh secret set SEED_GITHUB_LOGIN --body "twynsicle"` ran.
- [ ] PR merged; plan-comment showed exactly the env var addition; apply succeeded.
- [ ] `aws ecs update-service ... --force-new-deployment` ran post-apply.
- [ ] CloudWatch shows the seed log line "allowlist already contains 'twynsicle' — no-op".
- [ ] `SELECT github_login, COUNT(*) FROM allowed_users GROUP BY github_login;` shows exactly one row for `twynsicle`.

**Infra change — budget (commit 4):**

- [ ] `terraform/platform/budget.tf` defines `aws_budgets_budget.monthly` with three notifications.
- [ ] `terraform/platform/variables.tf` has `var.budget_alert_email` (required).
- [ ] `.github/workflows/deploy-infra.yml` plan step has `TF_VAR_budget_alert_email` env.
- [ ] `gh secret set BUDGET_ALERT_EMAIL --body "..."` ran.
- [ ] PR merged; apply succeeded; `aws budgets describe-budgets` returns the budget.

**Verification (commit 5):**

- [ ] Manual fresh-clone walkthrough of `RUNNING.md` Flow 1 + Flow 2 completed end-to-end.
- [ ] All findings captured for commit 6.

**Doc close-out (commit 6):**

- [ ] Doc 09 updated: SEED_GITHUB_LOGIN noted; budgets row in cost table; brief rollback subsection.
- [ ] Doc 10 updated: marked as decision-record / verification checklist; PB-archive skip recorded.
- [ ] Doc 00 updated: `phase-e-plan.md` row in Doc Index; Phase E row's verify cell updated.
- [ ] `AGENTS.md` updated: `SEED_GITHUB_LOGIN` in env var list; `db-seed.cjs` mentioned; budget + new secrets noted.
- [ ] RUNNING.md walkthrough fixes (if any) applied.
- [ ] This file's status flipped to `completed` and verification checklist fully ticked.

---

## Open questions deferred to a later phase

- **`drift-detect.yml` workflow.** Scheduled `terraform plan` that alerts on drift. Adds maintenance surface; "when it bites" may be the right time. Defer to Phase F+ or "first drift incident".
- **Slack/email deploy notifications.** SNS topic on ECS deployment state changes. GitHub Actions email is currently sufficient.
- **Tighter TF role permissions.** Current name-prefix scoping is POC-grade. Per-resource ARN scoping is a Phase F+ hardening task; aligns with doc 11's org-scale pitch.
- **GHA cache hygiene.** Buildx cache may grow over time. Defer "until it bites".
- **Full rollback runbook.** Commit 6 adds a brief subsection. A dedicated runbook (with screenshots, per-failure-mode flow, etc.) is a Phase F item if the proposal docs need it.
- **Cost alarm threshold tuning.** $50 may be too low or too high. Re-tune after first month of real cost data.
- **`drizzle-kit studio` script.** Doc 10 prescribed it; current workflow is `db:generate` + `db:migrate`. Skipped in commit 1; revisit if local schema iteration becomes painful.
- **Cognito user creation runbook.** If onboarding a second user becomes routine, promote from doc 09 subsection to a top-level OPERATIONS.md section.
- **Budget alarm channel beyond email.** SNS-to-Slack would be richer but adds infra. Defer.
