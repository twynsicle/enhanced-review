# 08 — CD pipeline: Terraform infra deploy

GitHub Actions workflow that runs `terraform plan` on every PR touching `terraform/`, posts the plan as a PR comment, and runs `terraform apply` on merge to `main` (gated by a manual approval). Uses GitHub OIDC federation, separate IAM role from the image-deploy pipeline.

This is Phase D-part-2. Builds on the state-backend bootstrap from [06a](./06a-platform.md). Two infra-deploy roles in scope: one for the platform module, one per app module — both follow the trust-policy pattern from [06b](./06b-application.md)'s image-deploy role.

---

## Decisions feeding into this doc

- **D10** GitHub Actions ↔ AWS via OIDC federation
- Plan-on-PR for review; apply-on-main with manual approval
- Daily drift detection via scheduled workflow

---

## Goals

- **Plan-on-PR.** Reviewer sees what will change, in the PR body, before merge.
- **Approval-gated apply.** Merging to `main` triggers an apply, but a `production` GitHub Environment requires reviewer approval. (You can self-approve as the maintainer; the gate is there to make "I forgot I had drift" a deliberate click.)
- **Drift detection.** A daily scheduled `terraform plan` opens an issue if drift is detected. Catches manual console edits.
- **Separate IAM role from image deploys.** Infra apply has broad permissions (creates VPCs, IAM roles, etc.); image deploy has scoped permissions. Different roles, different blast radii.

---

## Files

```
.github/workflows/
  ci.yml                 # existing
  deploy-image.yml       # from doc 07
  deploy-infra.yml       # new
  drift-detect.yml       # new — scheduled

terraform/
  *.tf                   # actual config
  task-definition.json   # exported by infra deploy for image deploy to consume
```

---

## `deploy-infra.yml`

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
  pull-requests: write # for plan-as-comment

env:
  AWS_REGION: us-east-1
  TF_VERSION: 1.9.8
  TF_IN_AUTOMATION: 'true'

concurrency:
  group: deploy-infra
  cancel-in-progress: false

jobs:
  plan:
    if: github.event_name == 'pull_request' || github.event_name == 'push' || github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    timeout-minutes: 15
    defaults:
      run:
        working-directory: terraform

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

      - run: terraform init
      - run: terraform fmt -check
      - run: terraform validate
      - id: plan
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
            const plan = fs.readFileSync('terraform/plan-show.txt', 'utf8').slice(0, 60_000);
            const body = `### Terraform plan\n\n<details><summary>Plan output</summary>\n\n\`\`\`hcl\n${plan}\n\`\`\`\n\n</details>`;
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
          name: tfplan
          path: terraform/tfplan
          retention-days: 7

  apply:
    needs: plan
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production # requires manual approval per GitHub Env config
    timeout-minutes: 30
    defaults:
      run:
        working-directory: terraform

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

      - run: terraform init

      - uses: actions/download-artifact@v4
        with:
          name: tfplan
          path: terraform/

      - run: terraform apply -input=false tfplan

      - name: Export task-definition.json for image deploys
        run: |
          terraform output -raw task_definition_json > task-definition.json
          if ! git diff --quiet task-definition.json; then
            git config user.name 'github-actions[bot]'
            git config user.email 'github-actions[bot]@users.noreply.github.com'
            git add task-definition.json
            git commit -m "chore(infra): refresh task-definition.json"
            git push
          fi
```

### Step-by-step

- **Two jobs: `plan` and `apply`.** `plan` runs on every event; `apply` only runs on `push: main` and only if `plan` succeeds.
- **`environment: production`.** GitHub Environment with required reviewers turned on. The `apply` job pauses for human approval before executing. Self-approval is allowed; the "click to approve" is the safety net.
- **Plan as PR comment.** Truncated to 60 KB to fit GitHub's comment size limit. Bigger plans get cut off; if you see "Plan output truncated", review locally.
- **Plan artifact uploaded on push.** The `apply` job downloads the saved plan rather than re-planning. Avoids the "plan said X, apply did Y" drift that can happen if state changed between plan and apply.
- **Auto-commit `task-definition.json`.** Ensures the file consumed by the image-deploy pipeline reflects the current task def. The bot commits back to `main`. (Yes, this triggers the `paths-ignore` filter in `deploy-image.yml`, so it's a safe self-update.)

### Plan-format option

If you want richer PR comments (with collapsible diffs, color, summary stats), the [Hashicorp `setup-terraform`](https://github.com/hashicorp/setup-terraform) action supports a `plan_format` mode that outputs a markdown summary. We use the simpler "raw plan in a code block" approach — easier to debug, no extra dependency. Either is fine.

---

## `drift-detect.yml`

Daily check that catches manual console edits or out-of-band changes.

```yaml
name: Drift detect

on:
  schedule:
    - cron: '0 14 * * *' # 14:00 UTC daily
  workflow_dispatch:

permissions:
  id-token: write
  contents: read
  issues: write

env:
  AWS_REGION: us-east-1
  TF_VERSION: 1.9.8

jobs:
  drift:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    defaults:
      run:
        working-directory: terraform

    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::${{ secrets.AWS_ACCOUNT_ID }}:role/enhanced-review-github-tf
          aws-region: ${{ env.AWS_REGION }}
      - uses: hashicorp/setup-terraform@v3
        with: { terraform_version: '${{ env.TF_VERSION }}' }
      - run: terraform init
      - id: plan
        run: |
          set +e
          terraform plan -detailed-exitcode -no-color > plan.txt 2>&1
          echo "exit=$?" >> $GITHUB_OUTPUT
        continue-on-error: true

      - name: Open issue if drift detected
        if: steps.plan.outputs.exit == '2' # 2 = changes pending
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const plan = fs.readFileSync('terraform/plan.txt', 'utf8').slice(0, 50_000);
            github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: `[drift] Terraform detected ${new Date().toISOString().slice(0,10)}`,
              labels: ['drift'],
              body: `Daily drift check found pending changes:\n\n\`\`\`hcl\n${plan}\n\`\`\`\n\nReview and either reconcile manually or update Terraform config.`,
            });
```

`-detailed-exitcode`:

- `0` = no changes
- `1` = error
- `2` = changes pending (drift)

We treat `2` as actionable. `1` we let fail loudly so we notice the workflow's broken.

---

## IAM role for Terraform (`enhanced-review-github-tf`)

To be defined in Phase D — alongside (or as a sibling of) the image-deploy role from [06b](./06b-application.md). Trust policy is the same shape (OIDC, restricted to this repo). Permissions are broader because Terraform creates/destroys things:

```hcl
data "aws_iam_policy_document" "tf_permissions" {
  # VPC, EC2, ECS, ECR, ELB, EFS, ACM, Cognito, Route53, Secrets Manager, IAM, CloudWatch, S3 (state), DynamoDB (lock).
  # Scope each to the resources we manage where possible (Resource = arn:aws:..:..:enhanced-review-*).
  # Use a permissions boundary if your org requires it.
}
```

The exact policy is long; treat it as a checklist:

- `ec2:*` on VPC resources tagged `app=enhanced-review` (use [aws_iam_policy_document with conditions](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/iam_policy_document)).
- `ecs:*`, `ecr:*` on this cluster/repo only.
- `elasticloadbalancing:*` on this LB only.
- `elasticfilesystem:*` on this FS only.
- `acm:*`, `route53:*` for cert/zone management.
- `cognito-idp:*` on this user pool only.
- `secretsmanager:*` on `enhanced-review/*` ARNs.
- `iam:*Role*` only on roles named `enhanced-review-*`.
- `logs:*` on the app log group.
- `s3:*` on the state bucket; `dynamodb:*` on the lock table.

For the POC, "scope by name prefix" is a sane shortcut. Org-wide adoption ([11](./11-proposal-lightweight-infra.md)) recommends per-app boundary policies.

---

## State backend bootstrap (one-time)

The chicken-and-egg problem: Terraform can't manage its own state backend.

`terraform/bootstrap.sh` (described in [06a](./06a-platform.md)) creates the S3 bucket + DynamoDB lock table. Run once, by hand, before the first `terraform init`:

```bash
bash terraform/bootstrap.sh
cd terraform/platform
terraform init -backend-config="bucket=…" -backend-config="key=platform/terraform.tfstate" …
terraform apply
cd ../apps/enhanced-review
terraform init -backend-config="bucket=…" -backend-config="key=apps/enhanced-review/terraform.tfstate" …
terraform apply
```

After that, the workflow's `terraform init` finds the configured backend.

> **Don't put bootstrap into a workflow.** The workflow needs the role to exist, but the role is provisioned by Terraform, which needs the backend to exist. It's bootstrapping all the way down. Hand-bootstrap once.

---

## Order-of-operations between image and infra deploys

Common case: infra change adds an env var, code change reads it.

```
1. Branch off main.
2. Update terraform/ to add the env var to the task definition.
3. Update src/ to read it.
4. Open PR. Review the plan in the PR comment.
5. Merge PR.
6. deploy-infra.yml runs first (it watches terraform/**).
   → terraform apply registers a new task def revision with the env var.
   → bot commits the updated task-definition.json back to main.
7. The bot's commit triggers deploy-image.yml.
   → CI passes. Image is built. Image deploy renders a new task def revision (env var inherited from the JSON), updates the service.
8. The service rolls out the new image with the new env var.
```

The bot's commit is the bridge between the two pipelines. If you skip step 7's auto-commit, image deploys would still work (they patch the existing JSON), but `task-definition.json` would drift from reality until the next infra deploy.

### What if the env var depends on a secret you haven't put in Secrets Manager yet?

Apply order matters. Either:

- **Add the secret to Secrets Manager first** (manual `aws secretsmanager put-secret-value`).
- **Then merge the PR.**

Documented in [09](./09-cost-and-operations.md) under "adding a new secret".

---

## Verification

Phase D-part-2 success:

1. Open a PR adding a comment to a `.tf` file. Workflow runs, posts plan as comment. Plan shows zero changes.
2. Open a PR with an actual change (e.g. tag a resource). Plan shows the diff in the PR comment.
3. Merge. `apply` job pauses on the production environment. Click "Approve". Apply runs. Resource updated.
4. Manually edit a resource in the AWS console (e.g. add a tag). Wait until the daily drift workflow runs (or `workflow_dispatch` it). It opens an issue with the drift diff.
5. Run `terraform apply` from the workflow → drift reconciled → next drift check is silent.
6. After an apply that changes the task def: confirm `task-definition.json` was auto-committed; confirm the image-deploy workflow runs against the updated JSON.
