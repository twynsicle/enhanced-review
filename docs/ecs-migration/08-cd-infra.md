# 08 — CD pipeline: Terraform infra deploy

GitHub Actions workflow that runs `terraform plan` on every PR touching `terraform/`, posts the plan as a PR comment per module (platform + app), and runs `terraform apply` on merge to `main` (gated by a manual approval). Uses GitHub OIDC federation; one shared IAM role assumes for both modules.

This is Phase D-part-2. Builds on the state-backend bootstrap from [06a](./06a-platform.md) and the platform-side IAM role added in Phase D commit 2.

The implemented workflow is `.github/workflows/deploy-infra.yml`. Execution playbook is in [phase-d-plan.md](./phase-d-plan.md).

---

## Decisions feeding into this doc

- **D10** GitHub Actions ↔ AWS via OIDC federation
- **Phase D, D2** One shared `enhanced-review-github-tf` IAM role in the platform module (broad-but-name-prefix-scoped permissions). Both modules' deploy jobs assume it.
- **Phase D, D5** Plan-on-PR for review; apply-on-main with a `production` GitHub Environment manual approval
- **Phase D, D6** Drift detection deferred to Phase E
- **Phase D, D7** Apply order is platform first, then app (the app reads platform via `terraform_remote_state`)

---

## Goals

- **Plan-on-PR.** Reviewer sees what will change, in two PR comments (one per module), before merge.
- **Approval-gated apply.** Merging to `main` triggers an apply, but the `production` GitHub Environment requires reviewer approval. Self-approval is allowed; the gate is there to make "I forgot I had drift" a deliberate click.
- **Sequential apply.** Platform first, app second. The app's `terraform_remote_state` data source reads platform outputs at plan time; if platform changes haven't applied yet, the app would plan against stale outputs.
- **One IAM role for both modules.** Single-tenant POC; the role uses name-prefix scoping (`enhanced-review-*`, `platform-*`) instead of separate roles per module. Smaller surface to maintain; trust policy lives in the platform module.

---

## Files

```
.github/workflows/
  ci.yml                 # existing
  deploy-image.yml       # from doc 07
  deploy-infra.yml       # this doc

terraform/
  platform/iam-github-tf.tf  # the shared TF deploy role (Phase D commit 2)
  platform/*.tf              # rest of platform config
  apps/enhanced-review/*.tf  # app config
```

There is **no checked-in `task-definition.json`** — the image deploy live-fetches the task def at deploy time. See [07](./07-cd-image.md).

---

## `deploy-infra.yml`

The actual file lives at `.github/workflows/deploy-infra.yml`. Shape:

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
  pull-requests: write # plan-as-comment

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
            artifact: tfplan-platform
            state_key: platform/terraform.tfstate
          - module: apps/enhanced-review
            artifact: tfplan-app
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
      - name: terraform plan
        id: plan
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
            const planFile = `terraform/${{ matrix.module }}/plan-show.txt`;
            const plan = fs.readFileSync(planFile, 'utf8').slice(0, 60_000);
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
          name: ${{ matrix.artifact }}
          path: terraform/${{ matrix.module }}/tfplan
          retention-days: 7

  apply-platform:
    needs: plan
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production # required reviewer = maintainer
    timeout-minutes: 30
    defaults:
      run:
        working-directory: terraform/platform
    steps:
      # checkout, configure AWS, setup-terraform, init,
      # download-artifact (tfplan-platform), terraform apply tfplan

  apply-app:
    needs: apply-platform # strict ordering: platform applies before app
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production
    timeout-minutes: 30
    defaults:
      run:
        working-directory: terraform/apps/enhanced-review
    steps:
      # same shape as apply-platform but for the app module
```

### Step-by-step

- **Three jobs: `plan`, `apply-platform`, `apply-app`.** `plan` runs on every event, in parallel for both modules (matrix). `apply-platform` runs on `push: main` after `plan`; `apply-app` runs after `apply-platform`. Strict ordering matters because the app reads platform outputs.
- **`environment: production`.** GitHub Environment with required reviewers turned on. Each apply job pauses for human approval before executing. Approving `apply-platform` does not auto-approve `apply-app`; you click twice.
- **Plan as PR comment.** One comment per module, truncated to 60 KB to fit GitHub's comment size limit. Bigger plans get cut off; if you see "Plan output truncated", review locally.
- **Plan artifact uploaded on push.** The `apply-*` jobs download the saved plan rather than re-planning. Avoids the "plan said X, apply did Y" drift that can happen if state changed between plan and apply.
- **Single IAM role.** Both `apply-platform` and `apply-app` assume `enhanced-review-github-tf`. The role's permissions are scoped by name prefix (`enhanced-review-*` and `platform-*`).

### What's NOT in the workflow

- **No auto-commit-back-to-main.** Earlier drafts had this for `task-definition.json`; we removed it because the image deploy live-fetches (see [07](./07-cd-image.md)) and branch protection on `main` blocks bot pushes anyway.
- **No drift-detect.** Phase D scope cut it; deferred to Phase E ops.

---

## IAM role for Terraform (`enhanced-review-github-tf`)

Defined in `terraform/platform/iam-github-tf.tf` (Phase D commit 2). Trust policy: federated via the platform's existing `aws_iam_openid_connect_provider.github`, scoped to `repo:twynsicle/enhanced-review:ref:refs/heads/main` and `repo:twynsicle/enhanced-review:pull_request`.

Permissions are organized by service, scoped by name prefix where AWS allows:

- `ec2:Describe*` / `ec2:Get*` everywhere; `ec2:Create/Delete/Modify*` on VPC/subnet/IGW/route-table/SG (no resource-level conditions for these — AWS limitation).
- `ecs:*`, `elasticloadbalancing:*`, `elasticfilesystem:*`, `acm:*`, `cognito-idp:*`, `route53:*` everywhere (resource-level scoping is unreliable for these in TF flows).
- `ecr:*` on `enhanced-review` and `enhanced-review-*` repos; `ecr:GetAuthorizationToken` on `*` (AWS rule).
- `secretsmanager:*` on `enhanced-review/*` ARNs; `secretsmanager:ListSecrets` on `*`.
- `iam:*Role*` and `iam:PassRole` only on `enhanced-review-*` and `platform-*` role names.
- `iam:*OpenIDConnectProvider` only on `arn:aws:iam::*:oidc-provider/token.actions.githubusercontent.com`.
- `logs:*` on `/ecs/enhanced-review*` log groups; `logs:DescribeLogGroups` on `*`.
- `s3:*` on `arn:aws:s3:::enhanced-review-tfstate-*`; `dynamodb:*` on `arn:aws:dynamodb:*:*:table/enhanced-review-tflock`.
- `sts:GetCallerIdentity` on `*`.

For the POC, "scope by name prefix" is a sane shortcut. Org-wide adoption ([11](./11-proposal-lightweight-infra.md)) recommends per-app boundary policies. Expect 1–3 `AccessDenied` failures the first time the role is exercised at scale; iterate by adding the missing action and re-applying.

---

## Bootstrap order (chicken-and-egg)

The role can't exist before the platform module applies, but the workflow needs the role to exist before it can apply.

Resolution (one-time, by hand):

```bash
# 1. State backend bootstrap (S3 + DynamoDB), described in 06a.
bash terraform/bootstrap.sh

# 2. Apply platform once locally to create everything in the platform module
#    (including the new enhanced-review-github-tf role).
cd terraform/platform
terraform init -backend-config="bucket=…" -backend-config="key=platform/terraform.tfstate" …
terraform apply -var="domain_name=…"

# 3. Apply app once locally for the same reason (this happened in Phase C; only
#    needed again if you're rebuilding from scratch).
cd ../apps/enhanced-review
terraform init -backend-config="bucket=…" -backend-config="key=apps/enhanced-review/terraform.tfstate" …
terraform apply -var="platform_state_bucket=…"

# 4. From here, the deploy-infra.yml workflow can apply both modules using the
#    enhanced-review-github-tf role.
```

> **Don't put bootstrap into a workflow.** The workflow needs the role to exist, but the role is provisioned by Terraform, which needs the backend to exist. It's bootstrapping all the way down. Hand-bootstrap once.

---

## Order-of-operations between image and infra deploys

Common case: infra change adds an env var, code change reads it.

```
1. Branch off main.
2. Update terraform/apps/enhanced-review/task-definition.tf to add the env var.
3. Open a PR for just the TF change. Review the plan in the PR comment.
4. Merge. apply-platform runs (no platform changes; click approve, no-op).
   apply-app runs (registers a new task-def revision with the env var; click approve).
5. Service is still on the old revision (lifecycle.ignore_changes = [task_definition]).
6. Open a second PR with the source change that reads the env var.
7. Merge. deploy-image.yml fires. It live-fetches the latest task-def
   (with the new env var), patches the image field, registers a new revision,
   UpdateService rolls the new image with the env var.
```

The two PRs are deliberately separate. A combined PR triggers both workflows in parallel and the image-deploy's `describe-task-definition` may land on a pre-apply revision (race condition). Document the rule loud and clear.

### What if the env var depends on a secret you haven't put in Secrets Manager yet?

Apply order matters. Either:

- **Add the secret to Secrets Manager first** (manual `aws secretsmanager put-secret-value`).
- **Then merge the PR.**

Documented in [09](./09-cost-and-operations.md) under "adding a new secret".

---

## Verification

Phase D-part-2 success:

1. Open a PR adding a comment to a `.tf` file. Workflow runs, posts plan-as-comment for both `platform` and `apps/enhanced-review`. Each plan shows zero changes.
2. Open a PR with an actual change (e.g. tag a resource). Plan shows the diff in the PR comment for the affected module.
3. Merge. `apply-platform` job pauses on the production environment. Click "Approve". Apply runs. `apply-app` job pauses on the production environment. Click "Approve". Apply runs. Resource updated.
4. After an apply that changes the task def: confirm a new revision is registered (`aws ecs describe-task-definition --task-definition enhanced-review --revision <N>`); confirm the next image-deploy picks up the new revision via live-fetch.
