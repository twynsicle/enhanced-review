# Phase D — CD pipelines + first real image — execution plan

**Status:** ready to execute. **Companion to:** [07-cd-image.md](./07-cd-image.md), [08-cd-infra.md](./08-cd-infra.md), [00-overview.md](./00-overview.md).

This file is the ordered task list for Phase D: ship the CD pipelines (image deploy + infra deploy) and use them to perform the first real image cutover, replacing Phase C's `hashicorp/http-echo` placeholder with the actual Next.js app and verifying an end-to-end review against a small public PR.

By the end, a maintainer can:

1. Open a PR touching `terraform/**` and see the plan posted as a PR comment for both modules (platform + app).
2. Merge that PR and have a `production`-environment-gated `terraform apply` run automatically (with one click of approval).
3. Push a code change to `main` and have a Docker image built, pushed to ECR, and rolled out as a new ECS task — no manual `aws` commands.
4. Sign in via Cognito → GitHub OAuth and run a real review against a small public PR; the SSE stream renders a final narrative.

If anything in this plan disagrees with [07](./07-cd-image.md) / [08](./08-cd-infra.md), **the plan wins**. The design docs were written before the platform/app split and several decisions changed in planning (single TF role, live-fetch task-def, drift-detect deferred). Doc updates land in this plan's final commit.

---

## Goal

Phase D delivers four observable outcomes:

- **Image CD.** Pushing to `main` builds + pushes + rolls out the new image automatically. CI (format/lint/typecheck/test) gates the deploy.
- **Infra CD.** Terraform changes are reviewed via plan-as-PR-comment, then applied via approval-gated GitHub Environment.
- **Real-image cutover.** ECS service running the actual Next.js app. Cognito gates the ALB; Auth.js handles GitHub OAuth inside the app; Drizzle migrations applied; allowlist seeded; live SSE stream + narrative render against a real review.
- **Updated docs.** 07, 08, 00, 09, 10, AGENTS.md, README, RUNNING aligned to the implemented system.

Phase D ends when the verification checklist below is fully ticked.

---

## Architectural choices made during planning

These were chosen 2026-05-09 ahead of execution. Marked **DECIDED** so future-you doesn't re-litigate them.

| #   | Topic                  | Decision                                                                                                              | Why                                                                                                                                                                                                  |
| --- | ---------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Task-def base for image deploy | Live-fetch via `aws ecs describe-task-definition` in the workflow                                              | No checked-in `task-definition.json`, no auto-commit-back-to-main, no bot push (which branch protection would block anyway), no CI loops. Doc 07's "export-and-commit" pattern is replaced.          |
| D2  | TF deploy IAM role     | One shared `enhanced-review-github-tf` in `terraform/platform/iam-github-tf.tf`                                       | Single-tenant POC; one role keeps workflow secrets simple. Broad-but-name-prefix-scoped permissions (`enhanced-review-*` and `platform-*`). Doc 08's "two roles" framing is updated to one.          |
| D3  | Phase D end state      | Pipelines plumbed **and** real-image cutover verified end-to-end                                                      | Matches Phase D row in 00-overview.md ("Push a benign change; new task running with new image SHA"). Half-pipeline-only would defer a real verification to Phase E and lose the cutover focus.       |
| D4  | Executor at cutover    | `REVIEW_EXECUTOR=claude` from the first real deploy                                                                   | Validates the full stack at once. Stub-then-claude is a half-step; we'd repeat the verification later. Costs a few Anthropic tokens at smoke time, which is acceptable.                              |
| D5  | Apply approval gate    | `production` GitHub Environment with maintainer as required reviewer                                                  | Self-approval click is the safety net against an accidental merge or replay. Cost: one click per merge. Benefit: deliberate intent at the apply boundary.                                            |
| D6  | Drift detection        | Deferred to Phase E                                                                                                   | Keeps Phase D scoped to "pipelines + cutover". Drift detect adds value once the system has been stable a while; near-zero benefit during initial bring-up.                                          |
| D7  | Executor flip ordering | Use the new infra pipeline to flip `stub`→`claude` (it's the first real-content TF change)                            | Tests the infra pipeline against a meaningful diff (one env-var change) before the high-stakes image cutover. Doubles as a smoke test of the plan/apply/approve flow.                                |
| D8  | Auto-commit back to main | None — no `task-definition.json` to refresh, and branch protection (PRs required, no bypass) blocks bot pushes anyway | Live-fetch (D1) makes auto-commit unnecessary. Falls cleanly out of D1 + branch-protection state.                                                                                                    |
| D9  | Smoke target           | A small (5–20 file, ~200 LOC) public-repo PR picked at smoke time                                                     | Concrete enough to surface real bugs (clone, executor, SSE drain, narrative render). Vague enough to choose at smoke time once the rest of the system is up.                                         |
| D10 | Allowlist seeding      | One-time manual `INSERT` via ECS Exec / psql after first task boot                                                    | The current entrypoint runs migrations + orphan-recovery, not seed. Adding `SEED_GITHUB_LOGIN` to the task def + a seed step in entrypoint is a code change that's not strictly required. Manual once is fine. Optional polish in Phase E. |
| D11 | TF role permissions    | Broad, scoped by name prefix (`enhanced-review-*`, `platform-*`)                                                      | Doc 08's recommended POC-scope shortcut. Iterating on tighter perms is a Phase E hardening task.                                                                                                     |
| D12 | Plan format            | This file (`phase-d-plan.md`) — same shape as `phase-c-plan.md`                                                       | Phase B/C pattern proven; reuse it.                                                                                                                                                                  |

---

## Pre-flight (current state of the branch)

Phase C is merged on `migrate-ecs`. The repo has:

- `terraform/platform/` — VPC, ECS cluster, ALB, Cognito user pool + hosted UI domain, Route 53 zone, wildcard ACM cert, ECR repo, GitHub OIDC provider.
- `terraform/apps/enhanced-review/` — task definition (placeholder image, REVIEW_EXECUTOR=stub), service, EFS, ALB target group + listener rule, Cognito user pool client, Route 53 ALIAS record, 5 secrets (postgres-password + auth-secret populated, others empty), 3 IAM roles (task-execution, task, github-image-deploy), CloudWatch log group, security groups.
- `terraform/apps/enhanced-review/iam.tf` already defines `enhanced-review-github-image-deploy` (image-deploy role). Phase D adds the broader TF-deploy role.
- `.github/workflows/ci.yml` runs format/lint/typecheck/test + a `docker-build` verification job. **No `workflow_call` trigger yet** — Phase D adds it.
- AWS state: ECS service `runningCount = 1`, placeholder image responding 200 behind Cognito at `https://enhanced-review.{domain}`.
- No `deploy-image.yml` / `deploy-infra.yml` workflows.
- No `AWS_ACCOUNT_ID` GitHub secret.
- No `production` GitHub Environment.
- Branch protection on `main`: **PRs required, no bypass.** Every Phase D change lands via PR.

Pre-flight verification (run before commit 1):

```sh
gh secret list                          # confirm AWS_ACCOUNT_ID absent
gh api repos/twynsicle/enhanced-review/environments  # confirm production absent
gh api repos/twynsicle/enhanced-review/branches/main/protection  # confirm PR-required, no-bypass

aws ecs describe-services --cluster platform-cluster --services enhanced-review \
  --query 'services[0].[runningCount,desiredCount,taskDefinition]'  # 1, 1, ARN of placeholder revision
aws secretsmanager list-secrets --filters Key=name,Values=enhanced-review/  # 5 entries
aws ecr describe-repositories --repository-names enhanced-review  # exists
```

If any of these don't match, stop and reconcile before proceeding.

---

## Task sequence (one logical commit per heading)

Each section below is one logical commit (one PR), in order. Any prefix is independently green: every commit ends with the system in a working state. Several commits include **manual steps** that the maintainer runs once.

### 1. CI: enable `workflow_call` reuse

**Files:**

- `.github/workflows/ci.yml`

Add `workflow_call:` to the `on:` trigger so `deploy-image.yml` can reuse the existing CI as a job. The trigger list becomes:

```yaml
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
  workflow_call:
```

No other change to `ci.yml`. The existing `ci` and `docker-build` jobs continue to run on PR/push as today; calling workflows can `uses: ./.github/workflows/ci.yml` and get the same job graph.

**Why standalone:** the change is one line and has no AWS side effects. Lands trivially via PR.

**Verify:**

- Open the PR. Existing CI still runs on the PR (format/lint/typecheck/test/docker-build all green).
- After merge, `gh workflow view ci.yml` shows `workflow_call` listed under triggers.

---

### 2. Platform IAM: shared TF deploy role + plan-time variables

**Files (new):**

- `terraform/platform/iam-github-tf.tf`

**Files (edited):**

- `terraform/platform/variables.tf` — add `github_owner` (default `"twynsicle"`) and `github_repo` (default `"enhanced-review"`)
- `terraform/platform/outputs.tf` — add `output "github_tf_role_arn"`

**`iam-github-tf.tf` shape:**

```hcl
data "aws_iam_policy_document" "github_tf_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${var.github_owner}/${var.github_repo}:ref:refs/heads/main",
        "repo:${var.github_owner}/${var.github_repo}:pull_request",
      ]
    }
  }
}

resource "aws_iam_role" "github_tf" {
  name               = "enhanced-review-github-tf"
  assume_role_policy = data.aws_iam_policy_document.github_tf_trust.json
}

# POC-scoped permissions: by name prefix where AWS allows, "*" elsewhere.
data "aws_iam_policy_document" "github_tf" {
  # VPC + EC2 (subnet/route/IGW management — these don't support resource-level conditions cleanly,
  # so we scope by tag where possible and accept "*" elsewhere.
  statement {
    actions   = ["ec2:*"]
    resources = ["*"]
    # condition by tag if/when we add aws_resourcegroupstaggingapi tagging discipline.
  }

  # ECS / ECR / ELBv2 / EFS / ACM / Cognito / Route53 / SecretsManager / Logs.
  # Each of these requires action+resource patterns; full permissions doc is large.
  # For brevity, the actual file lists each statement explicitly.
  # See risks section: missing permissions surface as AccessDenied during first apply,
  # iterate from there.

  # IAM: scoped to enhanced-review-* and platform-* role names and the existing roles.
  statement {
    actions = [
      "iam:CreateRole", "iam:DeleteRole", "iam:GetRole", "iam:UpdateRole",
      "iam:AttachRolePolicy", "iam:DetachRolePolicy", "iam:ListAttachedRolePolicies",
      "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:GetRolePolicy", "iam:ListRolePolicies",
      "iam:TagRole", "iam:UntagRole", "iam:PassRole",
    ]
    resources = [
      "arn:aws:iam::*:role/enhanced-review-*",
      "arn:aws:iam::*:role/platform-*",
    ]
  }
  statement {
    actions = ["iam:CreateOpenIDConnectProvider", "iam:GetOpenIDConnectProvider",
               "iam:DeleteOpenIDConnectProvider", "iam:UpdateOpenIDConnectProviderThumbprint",
               "iam:TagOpenIDConnectProvider"]
    resources = ["arn:aws:iam::*:oidc-provider/token.actions.githubusercontent.com"]
  }

  # State backend
  statement {
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
    resources = [
      "arn:aws:s3:::enhanced-review-tfstate-*",
      "arn:aws:s3:::enhanced-review-tfstate-*/*",
    ]
  }
  statement {
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:DescribeTable"]
    resources = ["arn:aws:dynamodb:*:*:table/enhanced-review-tflock"]
  }
}

resource "aws_iam_role_policy" "github_tf" {
  name   = "enhanced-review-github-tf"
  role   = aws_iam_role.github_tf.id
  policy = data.aws_iam_policy_document.github_tf.json
}
```

The above sketches the structure; the real file lists each service's actions explicitly (ECS, ECR, ELBv2, EFS, ACM, Cognito-IDP, Route53, Secrets Manager, Logs). Expect to iterate on permission gaps the first few applies — `AccessDenied` surfaces during plan or apply, add the missing action, re-apply locally, retry.

**Manual step (post-edit, before commit):**

```sh
cd terraform/platform
terraform plan   # confirm only IAM additions
terraform apply  # creates the role locally — the workflow can't bootstrap itself
```

After this apply, `aws iam get-role --role-name enhanced-review-github-tf` returns the role, with the trust policy + inline permissions attached.

**Why this is its own commit:** the trust policy + permissions are a security boundary. Reviewing them in isolation is easier than alongside workflow YAML.

**Verify:**

- `terraform plan` is additive (1 role + 1 policy attached + 2 vars + 1 output).
- `terraform apply` succeeds.
- `aws iam get-role --role-name enhanced-review-github-tf` returns role with `AssumeRolePolicyDocument` containing the OIDC trust statement.
- Manual sanity: `aws sts assume-role-with-web-identity` would fail without a valid GitHub OIDC token (expected) — only the trust shape is verifiable locally.

---

### 3. GitHub repo configuration (manual, not a code change)

This is documentation in the plan, not a commit. The maintainer runs these one-time setup steps:

```sh
# 1. AWS_ACCOUNT_ID secret
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
gh secret set AWS_ACCOUNT_ID --body "$ACCOUNT_ID"

# 2. Verify
gh secret list   # AWS_ACCOUNT_ID listed
```

Then via the GitHub web UI (no CLI for environments + reviewers in `gh` as of writing):

1. Settings → Environments → New environment → name: `production`
2. Required reviewers → add yourself
3. Optionally: Deployment branches → Selected branches → `main`
4. Save

Verify via:

```sh
gh api repos/twynsicle/enhanced-review/environments
# Look for {"name":"production","protection_rules":[{"type":"required_reviewers",...}]}
```

**Why no commit:** these are repo-config side effects not tracked in code. The plan is the documentation that they need to exist.

---

### 4. `deploy-image.yml` workflow (image CD)

**Files (new):**

- `.github/workflows/deploy-image.yml`

Final shape (using live-fetch per D1; corrected names per current Phase C state):

```yaml
name: Deploy image

on:
  push:
    branches: [main]
    paths-ignore:
      - 'terraform/**'
      - 'docs/**'
      - '*.md'
      - '.github/workflows/deploy-infra.yml'
  workflow_dispatch:
    inputs:
      sha:
        description: 'Commit SHA to deploy (defaults to HEAD of main)'
        required: false

concurrency:
  group: deploy-image-${{ github.ref }}
  cancel-in-progress: false

permissions:
  id-token: write
  contents: read

env:
  AWS_REGION: us-west-2
  ECR_REPOSITORY: enhanced-review
  ECS_CLUSTER: platform-cluster
  ECS_SERVICE: enhanced-review
  ECS_TASK_FAMILY: enhanced-review

jobs:
  ci:
    uses: ./.github/workflows/ci.yml

  deploy:
    needs: ci
    runs-on: ubuntu-latest
    timeout-minutes: 25
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ inputs.sha || github.sha }}

      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::${{ secrets.AWS_ACCOUNT_ID }}:role/enhanced-review-github-image-deploy
          aws-region: ${{ env.AWS_REGION }}

      - name: Login to ECR
        id: ecr-login
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build and push image
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ./Dockerfile
          push: true
          tags: |
            ${{ steps.ecr-login.outputs.registry }}/${{ env.ECR_REPOSITORY }}:sha-${{ github.sha }}
            ${{ steps.ecr-login.outputs.registry }}/${{ env.ECR_REPOSITORY }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max
          provenance: false

      - name: Fetch current task definition
        run: |
          aws ecs describe-task-definition \
            --task-definition ${{ env.ECS_TASK_FAMILY }} \
            --query taskDefinition > task-def.json

      - name: Render new task definition
        id: task-def
        uses: aws-actions/amazon-ecs-render-task-definition@v1
        with:
          task-definition: task-def.json
          container-name: web
          image: ${{ steps.ecr-login.outputs.registry }}/${{ env.ECR_REPOSITORY }}:sha-${{ github.sha }}

      - name: Deploy to ECS
        uses: aws-actions/amazon-ecs-deploy-task-definition@v2
        with:
          task-definition: ${{ steps.task-def.outputs.task-definition }}
          cluster: ${{ env.ECS_CLUSTER }}
          service: ${{ env.ECS_SERVICE }}
          wait-for-service-stability: true
          wait-for-minutes: 15
```

Notes:

- **Live-fetch step replaces a checked-in `task-definition.json`.** `describe-task-definition --task-definition <family>` (no revision) returns the LATEST ACTIVE revision. `--query taskDefinition` strips the response wrapper to match the file format `amazon-ecs-render-task-definition` expects.
- **Role name is `enhanced-review-github-image-deploy`** — matches `terraform/apps/enhanced-review/iam.tf:88-91`. Doc 07's `enhanced-review-github-deploy` is stale; corrected here and updated in commit 9.
- **Region is `us-west-2`** — matches Phase C decision C1. Doc 07's `us-east-1` is stale.
- **Cluster name is `platform-cluster`** — Phase C named platform resources with `platform-` prefix. Doc 07's `enhanced-review` cluster is stale.
- **Concurrency `cancel-in-progress: false`** — never cancel a deploy mid-flight.
- **CI is reused via `uses:`** — if format/lint/typecheck/test/docker-build fail, deploy is gated.

**Why this commit doesn't trigger a deploy yet:** the workflow file is in `.github/workflows/` which is NOT in `paths-ignore`, so merging this PR to `main` DOES fire the workflow. That means commit 4's merge IS the first-real-image deploy attempt — except auth-github-id/secret/anthropic-key are still empty in Secrets Manager. The image will deploy, the app will boot, sign-in attempts will fail at the GitHub OAuth step.

To avoid this big-bang on commit 4's merge:

- **Option A (chosen):** include a `if: false`-gated deploy job, OR merge with `paths-ignore: ['**']` temporarily, OR…
- **Option B (simpler, chosen):** accept the deploy fires on merge. Real Next.js boots. /api/health returns 200. Cognito gates everything else. Sign-in attempts fail (OAuth empty) — a known acceptable state. We populate OAuth secrets in commit 8 _after_ the infra pipeline is verified in commits 5–7.

Going with **Option B**. The placeholder is replaced when commit 4 merges. Subsequent commits (5, 6, 7) operate against the real (but uncredentialed) image. Sign-in starts working at commit 8.

Alternative if Option B feels risky: revert to Option A by merging deploy-image.yml with a `paths-ignore: ['**']` initially, then a follow-up PR removes the wildcard. That trades one extra commit for "no deploy until I'm ready". Plan keeps Option B.

**Verify (post-merge):**

- `aws ecs describe-tasks --cluster platform-cluster ...` shows new task on a new task-def revision with image `...amazonaws.com/enhanced-review:sha-<commit>`.
- `aws ecs describe-services --cluster platform-cluster --services enhanced-review --query 'services[0].deployments'` shows `PRIMARY` rolloutState `COMPLETED`.
- `curl https://enhanced-review.{domain}/api/health` returns 200 from real Next.js (not http-echo).
- ECR has `:sha-<commit>` and `:latest` tagged.
- CloudWatch logs `/ecs/enhanced-review` show `[entrypoint] running migrations…` then drizzle output then `[entrypoint] starting next…` then Next.js startup logs.
- Browser: hitting the host triggers Cognito redirect. Signing in lands on `/login` (the app's signin page). Clicking "Continue with GitHub" 500s (no client_id) — expected; fixed in commit 8.

---

### 5. `deploy-infra.yml` workflow (infra CD)

**Files (new):**

- `.github/workflows/deploy-infra.yml`

Final shape (matrix over both modules; sequential apply with platform first; plan-on-PR + apply-on-main):

```yaml
name: Deploy infra

on:
  pull_request:
    paths: ['terraform/**', '.github/workflows/deploy-infra.yml']
  push:
    branches: [main]
    paths: ['terraform/**', '.github/workflows/deploy-infra.yml']
  workflow_dispatch:

permissions:
  id-token: write
  contents: read
  pull-requests: write

env:
  AWS_REGION: us-west-2
  TF_VERSION: 1.9.8
  TF_IN_AUTOMATION: 'true'

concurrency:
  group: deploy-infra
  cancel-in-progress: false

jobs:
  plan:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    strategy:
      fail-fast: false
      matrix:
        include:
          - module: platform
            state_key: platform/terraform.tfstate
          - module: apps/enhanced-review
            state_key: apps/enhanced-review/terraform.tfstate

    defaults:
      run:
        working-directory: terraform/${{ matrix.module }}

    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::${{ secrets.AWS_ACCOUNT_ID }}:role/enhanced-review-github-tf
          aws-region: ${{ env.AWS_REGION }}

      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: ${{ env.TF_VERSION }}

      - name: terraform init
        env:
          TF_STATE_BUCKET: enhanced-review-tfstate-${{ secrets.AWS_ACCOUNT_ID }}
        run: |
          terraform init \
            -backend-config="bucket=${TF_STATE_BUCKET}" \
            -backend-config="key=${{ matrix.state_key }}" \
            -backend-config="region=${AWS_REGION}" \
            -backend-config="dynamodb_table=enhanced-review-tflock" \
            -backend-config="encrypt=true"

      - run: terraform fmt -check
      - run: terraform validate

      - id: plan
        env:
          TF_VAR_platform_state_bucket: enhanced-review-tfstate-${{ secrets.AWS_ACCOUNT_ID }}
        run: |
          terraform plan -no-color -out=tfplan -input=false 2>&1 | tee plan.txt
          terraform show -no-color tfplan > plan-show.txt
        continue-on-error: true

      - name: Post plan as PR comment
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const plan = fs.readFileSync(`terraform/${{ matrix.module }}/plan-show.txt`, 'utf8').slice(0, 60_000);
            const body = `### Terraform plan: \`${{ matrix.module }}\`\n\n<details><summary>Plan output</summary>\n\n\`\`\`hcl\n${plan}\n\`\`\`\n\n</details>`;
            github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body,
            });

      - name: Fail if plan errored
        if: steps.plan.outcome != 'success'
        run: exit 1

      - name: Upload plan artifact
        if: github.event_name == 'push'
        uses: actions/upload-artifact@v4
        with:
          name: tfplan-${{ matrix.module == 'platform' && 'platform' || 'app' }}
          path: terraform/${{ matrix.module }}/tfplan
          retention-days: 7

  apply-platform:
    needs: plan
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production
    timeout-minutes: 30
    defaults:
      run:
        working-directory: terraform/platform
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::${{ secrets.AWS_ACCOUNT_ID }}:role/enhanced-review-github-tf
          aws-region: ${{ env.AWS_REGION }}
      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: ${{ env.TF_VERSION }}
      - name: terraform init
        env:
          TF_STATE_BUCKET: enhanced-review-tfstate-${{ secrets.AWS_ACCOUNT_ID }}
        run: |
          terraform init \
            -backend-config="bucket=${TF_STATE_BUCKET}" \
            -backend-config="key=platform/terraform.tfstate" \
            -backend-config="region=${AWS_REGION}" \
            -backend-config="dynamodb_table=enhanced-review-tflock" \
            -backend-config="encrypt=true"
      - uses: actions/download-artifact@v4
        with:
          name: tfplan-platform
          path: terraform/platform/
      - run: terraform apply -input=false tfplan

  apply-app:
    needs: apply-platform
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production
    timeout-minutes: 30
    defaults:
      run:
        working-directory: terraform/apps/enhanced-review
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::${{ secrets.AWS_ACCOUNT_ID }}:role/enhanced-review-github-tf
          aws-region: ${{ env.AWS_REGION }}
      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: ${{ env.TF_VERSION }}
      - name: terraform init
        env:
          TF_STATE_BUCKET: enhanced-review-tfstate-${{ secrets.AWS_ACCOUNT_ID }}
        run: |
          terraform init \
            -backend-config="bucket=${TF_STATE_BUCKET}" \
            -backend-config="key=apps/enhanced-review/terraform.tfstate" \
            -backend-config="region=${AWS_REGION}" \
            -backend-config="dynamodb_table=enhanced-review-tflock" \
            -backend-config="encrypt=true"
      - uses: actions/download-artifact@v4
        with:
          name: tfplan-app
          path: terraform/apps/enhanced-review/
      - run: terraform apply -input=false tfplan
```

Notes:

- **Matrix for plan** (parallel across modules) but **sequential apply** via `needs: apply-platform` on the app job. Platform must apply before the app reads its remote state.
- **`production` environment** on both apply jobs. Each apply pauses for one approval click. Approving the platform job auto-runs the app job after platform completes.
- **Plan posted per module** as separate PR comments. Easier to review than a merged comment.
- **Plan artifact reused at apply time.** Avoids the "plan said X, apply did Y" drift if state changes between the two.
- **`TF_VAR_platform_state_bucket`** environment variable supplies the app module's required input without committing it to a `tfvars` file.
- **Drift-detect workflow deferred** (D6); not in this commit.

**Why this commit doesn't deploy infra changes:** the PR adds the workflow file. On merge, the `paths` filter on `push: main` is `'terraform/**', '.github/workflows/deploy-infra.yml'` — and the merge commit DOES touch `.github/workflows/deploy-infra.yml`. So the workflow runs against itself: plan job fires (no `terraform/**` changes vs current state → "no changes"), apply pauses for approval, approve, apply runs as a no-op.

This first-fire-on-self is intentional: it's the cheapest possible end-to-end smoke test of the infra pipeline.

**Verify (during commit 5's PR + after merge):**

- During PR review: plan job runs. PR comments appear: "Terraform plan: platform — no changes" and "Terraform plan: apps/enhanced-review — no changes".
- After merge: apply-platform job pauses on `production` env. Approve. Plan downloaded, apply runs, "No changes" reported.
- apply-app job pauses on `production` env. Approve. Plan downloaded, apply runs, "No changes" reported.
- ECS service unchanged.

---

### 6. PR: REVIEW_EXECUTOR=claude — first real-content TF change through the pipeline

**Files:**

- `terraform/apps/enhanced-review/task-definition.tf` — change `{ name = "REVIEW_EXECUTOR", value = "stub" }` to `"claude"`

**Why this is the first real-content change:** it's the smallest meaningful TF change that exercises plan/apply/approve end-to-end with a non-zero diff. One env-var flip. Failure mode is bounded (one task-def attribute).

**Verify (during PR + after merge):**

- During PR: plan job comments show one task-def revision change (env var).
- After merge: apply-platform pauses (no platform changes; click approve, "No changes"). apply-app pauses; approve; apply registers a new task-def revision N+1 with `REVIEW_EXECUTOR=claude`.
- Service still on revision N (lifecycle.ignore_changes guards). `aws ecs describe-task-definition --task-definition enhanced-review --revision <N+1> --query 'taskDefinition.containerDefinitions[0].environment'` shows `REVIEW_EXECUTOR=claude`.
- Service `runningCount=1` unchanged, still on the N image (real Next.js, but with stub executor in the running task — the new revision will roll out at the next image deploy).

---

### 7. Optional: tagged-no-op TF change to round out the smoke test

Skippable. If commit 6 felt like a bigger jump than wanted, an optional intermediate PR adds a benign `tags = { phase = "d" }` to one platform resource. Plan posts → merge → approve → apply — pure smoke. No functional change.

In auto mode, **skip** unless the maintainer wants extra paranoia. The commit numbering below assumes skipped.

---

### 7. Manual: GitHub OAuth App + populate Secrets Manager

Manual steps. No commit.

```sh
# 1. Create the OAuth App at https://github.com/settings/applications/new
#    Application name:        enhanced-review (prod)
#    Homepage URL:            https://enhanced-review.<domain>
#    Authorization callback:  https://enhanced-review.<domain>/api/auth/callback/github
# Note Client ID. Generate Client Secret (one-time visible — copy immediately).

# 2. Populate Secrets Manager
aws secretsmanager put-secret-value \
  --secret-id enhanced-review/auth-github-id \
  --secret-string "<client-id>"

aws secretsmanager put-secret-value \
  --secret-id enhanced-review/auth-github-secret \
  --secret-string "<client-secret>"

aws secretsmanager put-secret-value \
  --secret-id enhanced-review/anthropic-key \
  --secret-string "<anthropic-api-key>"

# 3. Verify
aws secretsmanager get-secret-value --secret-id enhanced-review/auth-github-id --query SecretString --output text
aws secretsmanager get-secret-value --secret-id enhanced-review/auth-github-secret --query SecretString --output text
aws secretsmanager get-secret-value --secret-id enhanced-review/anthropic-key --query SecretString --output text
```

Secrets are injected as env vars on container start, so the running task **does not** pick up new secret values until the task restarts. This is fine: commit 8's image deploy registers a new task revision, which forces a fresh task — the new task reads the populated secrets.

**Verify:**

- All three `get-secret-value` calls return non-empty strings.
- The OAuth App's callback URL exactly matches `https://enhanced-review.<domain>/api/auth/callback/github` (no trailing slash, exact case). Mistypes manifest as `redirect_uri_mismatch` at sign-in.

---

### 8. Code-touching commit → first end-to-end real review

**Files:**

- Trivial source change. Options: bump a comment, fix a README typo (NOTE: README is in `paths-ignore` for image deploy — pick a non-`*.md` file). Recommended: a one-character comment edit in `src/lib/log.ts` or any source file.

**On merge:**

- `deploy-image.yml` fires (paths-ignore doesn't match the changed file).
- CI passes. Image builds (~2 min cold, ~30s warm). Pushes to ECR.
- Live-fetch picks up task-def revision N+1 (with `REVIEW_EXECUTOR=claude`).
- Renders revision N+2 with new image SHA + claude env var inherited.
- UpdateService rolls task to N+2.
- New task starts: entrypoint runs migrations (idempotent on existing schema; no-op since commit 4 already created tables), runs orphan-recovery, exec's `node server.js`.
- ALB target group health check on `/api/health` passes after ~10–30s.
- Old task drains, new task in steady state.

**Manual: seed allowlist (one-time).** Per D10, the entrypoint doesn't seed. After the new task is healthy:

```sh
aws ecs execute-command \
  --cluster platform-cluster \
  --task $(aws ecs list-tasks --cluster platform-cluster --service-name enhanced-review --query 'taskArns[0]' --output text) \
  --container postgres \
  --interactive \
  --command "psql -U app -d enhanced_review -c \"INSERT INTO allowed_users (github_login, created_at) VALUES ('twynsicle', now()) ON CONFLICT DO NOTHING;\""
```

Verify:

```sh
aws ecs execute-command --cluster platform-cluster --task <arn> --container postgres --interactive \
  --command "psql -U app -d enhanced_review -c 'SELECT * FROM allowed_users;'"
# Expect one row with github_login = 'twynsicle'.
```

**End-to-end smoke test (Phase D exit gate):**

1. Browser: `https://enhanced-review.<domain>` → Cognito hosted UI → sign in (existing user from Phase C).
2. Lands on `/login` (app's signin page). Click "Continue with GitHub".
3. GitHub OAuth flow. Approve. Redirects to `/api/auth/callback/github` → cookie set → redirect to `/`.
4. Home page renders. Top bar shows GitHub avatar + login.
5. Pick a small public PR (5–20 changed files, ~200 LOC). Paste URL into the form. Submit.
6. Redirects to `/jobs/<id>`. Live view streams chunks via SSE. Each chunk renders inline as it arrives.
7. Job completes with `status=done`. Auto-redirect (or manual click) to `/reviews/<id>`.
8. Final narrative renders: PR title, overview summary, chapters with insights and diff snippets.
9. CloudWatch `/ecs/enhanced-review` shows clone, executor SDK calls, no errors.
10. AWS Cost Explorer (next day): the day's spend reasonable (Anthropic API + ECS + EFS + transfer).

**Failure modes to watch:**

- Migrations re-run on second boot — should be no-op; if they fail, drizzle migration table inconsistent (rare).
- GitHub OAuth `redirect_uri_mismatch` — fix the OAuth App callback URL.
- Auth.js `signIn` callback rejects (allowlist) — confirm `INSERT INTO allowed_users` ran.
- Anthropic 401 — confirm `anthropic-key` populated and the key is valid.
- SSE stream stalls — check ALB `idle_timeout=120` (commit 6 of phase-c-plan; should be 120s already), check CloudWatch for `LISTEN` errors.

---

### 9. Doc updates

**Files:**

- `docs/ecs-migration/07-cd-image.md` — rewrite for live-fetch + correct role (`enhanced-review-github-image-deploy`) + correct path (split modules) + region (`us-west-2`) + cluster name (`platform-cluster`). Remove the "generating the base task definition" section (no longer a checked-in file). Update "Drift between image and infra" section to reflect live-fetch (image deploy always reads the latest task-def, including the most recent infra-applied revision).
- `docs/ecs-migration/08-cd-infra.md` — rewrite to remove auto-commit-back-to-main section; describe the matrix structure across two modules; describe the single shared `enhanced-review-github-tf` role (remove "two roles" framing); move drift-detect section out (or mark "deferred to Phase E"); update region to `us-west-2`; correct `working-directory` examples.
- `docs/ecs-migration/00-overview.md` — add `phase-d-plan.md` row to the Doc Index. Update Phase D row's "Verify" column if needed.
- `docs/ecs-migration/09-cost-and-operations.md` — add manual `INSERT INTO allowed_users` to the day-2 runbook ("first-time setup of a new app or fresh environment"). Reference deploy-image.yml + deploy-infra.yml in the rollback / kill-switch sections.
- `docs/ecs-migration/10-existing-docs-updates.md` — note that AGENTS.md, README, and RUNNING get CD references in Phase D commit 9.
- `AGENTS.md` — Deployment section: remove "CD workflows (image deploy + infra deploy) don't exist yet"; describe the actual workflows. Add `.github/workflows/deploy-image.yml` and `deploy-infra.yml` to the repo layout's Conventions/Repo layout section. Add a one-line Deployment subsection note about `production` environment + AWS_ACCOUNT_ID secret + `enhanced-review-github-tf` role.
- `README.md` — small section: "Pushes to `main` deploy automatically. Image CD: deploy-image.yml. Infra CD: deploy-infra.yml. See docs/ecs-migration/phase-d-plan.md for the cutover playbook."
- `docs/RUNNING.md` — add a short "deploy" section pointing at the workflows. (RUNNING.md is currently focused on local dev.)
- This file — flip status to "completed" once the verification checklist is fully ticked.

**Why this is its own commit:** the doc rewrite is mechanical text-shuffling and would dilute reviewability if bundled with workflow YAML or TF code commits.

**Verify:**

- `git grep -n "enhanced-review-github-deploy"` returns only historical references (this plan + commit history).
- `git grep -n "task-definition.json"` returns only references to the live-fetched local file (`task-def.json` in deploy-image.yml).
- `git grep -n "us-east-1"` in `docs/ecs-migration/` is empty.
- `git grep -n "drift-detect"` in `docs/ecs-migration/` either is empty or mentions "deferred to Phase E".
- AGENTS.md "Deployment" section reflects current truth.
- 00-overview.md doc index lists `phase-d-plan.md`.

---

## Risks & gotchas to watch for during execution

- **Big-bang on commit 4 merge.** The deploy-image.yml workflow's first run is its own merge. The placeholder is replaced with real Next.js immediately. Mitigation: confirm Phase C's `auth-secret` and `postgres-password` are populated _before_ commit 4 merges (per phase-c-plan commit 7); confirm `MAX_JOBS_PER_USER`, `LOG_LEVEL` etc. are set in the task def. If anything's missing, the new task crashloops, the deploy circuit breaker reverts, the placeholder comes back.
- **Race condition: PR touching both `terraform/**` and `src/**`.** Both workflows fire in parallel. Image deploy's `describe-task-definition` could land on either pre- or post-apply revision depending on timing. **Rule: keep terraform and source changes in separate PRs.** Document in 07/08.
- **OIDC trust thumbprint rotation.** GitHub's OIDC thumbprint is hardcoded in `iam-oidc.tf`. Rotation is rare; symptom is a sudden `Not authorized to perform sts:AssumeRoleWithWebIdentity` after months of working deploys. Fix: re-read GitHub's OIDC docs and update the thumbprint via TF.
- **TF role permission gaps.** First infra apply via the new pipeline is the first time `enhanced-review-github-tf` is exercised at scale. Expect 1–3 `AccessDenied` failures the first time (e.g., a `tag:GetResources` action we forgot). Iterate: add the missing action to `iam-github-tf.tf`, re-apply locally, retry the pipeline.
- **Service `lifecycle.ignore_changes = [task_definition]`.** Commit 6's TF change registers a new task-def revision but doesn't update the running service. The next image deploy is what rolls the new env var to running tasks. Surprise factor: between commit 6 merge and commit 8 merge, the service runs the OLD env var values. Acceptable — both flips happen in the same Phase D execution window.
- **`workflow_call` reuse semantics.** Adding `workflow_call:` to ci.yml shouldn't break PR/push runs (the trigger is additive), but verify by opening a no-op PR and confirming CI runs.
- **Drizzle migrations on EFS.** First real deploy runs migrations against the (empty) postgres data dir on EFS. If migrations fail, the container exits, ECS retries with the same image, the deploy circuit breaker eventually rolls back. Recovery: ECS Exec into postgres, inspect schema state, decide whether to drop+recreate. EFS data is sticky across task restarts; rollback to placeholder doesn't drop the DB.
- **Manual allowlist seeding.** Easy to forget. Symptom: GitHub OAuth flow completes successfully but the app redirects to `/denied` because `signIn` callback rejects. Fix: ECS Exec the INSERT (or in Phase E, add SEED_GITHUB_LOGIN env var + a seed step in entrypoint).
- **Concurrency mid-cutover.** Don't open multiple TF-touching PRs in parallel during Phase D. They'll race on plan artifacts and one will overwrite the other's plan. The workflow's `concurrency: deploy-infra` group serializes the runs, but two open PRs both with stale plans are confusing.
- **GitHub OAuth callback exact match.** The callback URL in the OAuth App must exactly match `https://enhanced-review.<domain>/api/auth/callback/github` (case-sensitive, no trailing slash). Mistype symptoms: GitHub redirects to error page with `redirect_uri_mismatch`.
- **ECR image growth.** ECR lifecycle policy keeps last 10 sha-tagged images (per Phase C commit 3). After 10 deploys, old images expire automatically. If you need to roll back to one >10 deploys old, build it from source — that's intentional (per doc 07).
- **Anthropic spend during smoke test.** A 200-LOC PR through claude-haiku-4-5 costs ~$0.05–0.20. Budget accordingly. Watch for runaway loops (the runner's REVIEW_TIMEOUT_MIN=15 caps a single review).

---

## Verification checklist (Phase D exit gate)

Tick all before marking Phase D done:

**Pipeline plumbing (commits 1–5):**

- [ ] Commit 1: ci.yml accepts `workflow_call`; existing PR/push CI green.
- [ ] Commit 2: `enhanced-review-github-tf` role exists in IAM (verified via `aws iam get-role`); locally applied; outputs include `github_tf_role_arn`.
- [ ] Commit 3: `gh secret list` includes `AWS_ACCOUNT_ID`; `gh api repos/.../environments` shows `production` with required-reviewer protection rule.
- [ ] Commit 4: deploy-image.yml fires on merge; image built + pushed; new task running with new image SHA; `/api/health` returns 200 from real Next.js.
- [ ] Commit 5: deploy-infra.yml fires on merge; plan job posts "no changes" PR comments for both modules; apply-platform + apply-app pause on `production` env; approval click runs each apply; both succeed as no-ops.

**Real-app cutover (commits 6–8):**

- [ ] Commit 6: PR shows plan diff for one task-def env var; merge → approve → apply registers task-def revision with `REVIEW_EXECUTOR=claude`; service still on prior revision (lifecycle.ignore_changes).
- [ ] Commit 7 (manual): GitHub OAuth App created; `auth-github-id`, `auth-github-secret`, `anthropic-key` populated.
- [ ] Commit 8: trivial code change PR merged; deploy-image.yml builds and rolls out new task; new task on revision with claude env var.
- [ ] Manual seed: `INSERT INTO allowed_users` ran; row exists.
- [ ] Sign-in flow: Cognito → app `/login` → GitHub OAuth → land on home page; avatar + GH login visible.
- [ ] End-to-end review: small public PR submitted; SSE chunks stream; final narrative renders; no errors in CloudWatch.
- [ ] Cost ≤ $1 for the day's smoke (rough; Anthropic dominates).

**Doc updates (commit 9):**

- [ ] 07-cd-image.md aligned with live-fetch + corrected names.
- [ ] 08-cd-infra.md aligned with matrix + single role; drift-detect section removed/deferred.
- [ ] 00-overview.md doc index lists `phase-d-plan.md`.
- [ ] 09-cost-and-operations.md mentions allowlist seeding + CD rollback path.
- [ ] 10-existing-docs-updates.md flags AGENTS/README/RUNNING updates as done.
- [ ] AGENTS.md Deployment section reflects current state.
- [ ] README.md and RUNNING.md mention CD.
- [ ] `git grep -n "us-east-1"` is empty in `docs/ecs-migration/`.
- [ ] `git grep -n "enhanced-review-github-deploy"` returns only historical/plan refs.

---

## Open questions deferred to a later phase

These came up during planning but don't block Phase D. Captured here so they're not lost.

- **Drift detection workflow** (`drift-detect.yml`) — Phase E ops.
- **Account-level $50/mo budget alarm** — Phase E ops.
- **Allowlist seeding via env var + entrypoint step** (`SEED_GITHUB_LOGIN`) — Phase E polish; manual `INSERT` is fine for one user.
- **Tighter TF role permissions.** Current is name-prefix-scoped; per-app boundary policies are a Phase E hardening task and align with doc 11's org-scale pitch.
- **PR-time deploy preview environments.** Out of POC scope.
- **Image scanning gate.** ECR `scan_on_push` is enabled; we don't act on findings yet. Phase E.
- **Slack/email deploy notifications.** Phase E ops.
- **Rollback runbook in 09.** Phase E ops.
- **GitHub Actions runner cache hygiene.** GHA cache for buildx may grow; ECR's lifecycle handles ECR but not GHA cache. Phase E or "when it bites".
- **Per-environment deploy (staging vs prod).** Out of POC scope.
- **Cognito hosted-UI custom domain.** Cognito-managed subdomain is fine for POC; custom domain is doc 11 / Phase F+.
- **Workflow `paths-ignore` precision.** Current `paths-ignore` lists `'docs/**'`, `'*.md'`, `'terraform/**'`, `'.github/workflows/deploy-infra.yml'`. If we add another infra-only path (e.g. `scripts/aws-only/`), it should join the list. Convention noted.
