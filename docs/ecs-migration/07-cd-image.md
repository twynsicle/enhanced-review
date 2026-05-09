# 07 — CD pipeline: image build & deploy

GitHub Actions workflow that builds a Docker image on push to `main`, pushes it to ECR, registers a new ECS task definition revision, and updates the service. Uses GitHub OIDC federation so no AWS keys live in GitHub secrets.

This is Phase D-part-1. Phase C (Terraform-managed infra) must already exist; this pipeline only updates the running app.

---

## Decisions feeding into this doc

- **D10** GitHub Actions ↔ AWS via OIDC federation
- Two separate pipelines: image (this doc) and infra ([08](./08-cd-infra.md))
- Push-to-deploy on `main`; manual `workflow_dispatch` always available

---

## Goals

- **One-step deploy.** Merging to `main` is the ship signal. No manual ECR push, no manual task-def edit.
- **No long-lived AWS credentials.** OIDC trust policy on the IAM role restricts to this repo + branch.
- **Deploys gated by CI.** If `format:check`, `lint`, `typecheck`, or `test` fail, no deploy.
- **Traceable.** Every deployed image is tagged with its commit SHA. Rollback = redeploy a previous SHA.
- **Safe by default.** ECS deployment circuit breaker auto-rolls back failed deployments.

---

## File layout

```
.github/workflows/
  ci.yml              # existing — runs on PR + push, no change
  deploy-image.yml    # new — runs on push to main + manual dispatch
```

---

## `deploy-image.yml`

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
  cancel-in-progress: false # never cancel a deploy mid-flight

permissions:
  id-token: write # OIDC
  contents: read

env:
  AWS_REGION: us-east-1
  ECR_REPOSITORY: enhanced-review
  ECS_CLUSTER: enhanced-review
  ECS_SERVICE: enhanced-review

jobs:
  ci:
    uses: ./.github/workflows/ci.yml # require CI green before deploying

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
          role-to-assume: arn:aws:iam::${{ secrets.AWS_ACCOUNT_ID }}:role/enhanced-review-github-deploy
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
          provenance: false # avoid surprising attestations on a small repo

      - name: Render new task definition
        id: task-def
        uses: aws-actions/amazon-ecs-render-task-definition@v1
        with:
          task-definition: terraform/task-definition.json # exported via terraform output
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

### Step-by-step

- **`paths-ignore`** keeps the image pipeline from firing on infra-only or docs-only PRs.
- **`concurrency` with `cancel-in-progress: false`** prevents a second push from cancelling a running deploy. ECS will sequentially apply both task-definition revisions in order.
- **`uses: ./.github/workflows/ci.yml`** reuses the existing CI workflow. If it fails, deploy never starts. (Requires `ci.yml` to declare `on: workflow_call`.)
- **`docker/build-push-action@v6`** with `cache-from: type=gha` uses the GitHub Actions cache to keep build times down (~2 min cold, ~30s warm).
- **`amazon-ecr-login`** uses the temporary credentials from the OIDC step.
- **`amazon-ecs-render-task-definition`** takes a base JSON task def from `terraform/task-definition.json` (exported by `terraform output -json task_definition`) and patches the `image` field.
- **`amazon-ecs-deploy-task-definition`** registers a new task def revision and updates the service. `wait-for-service-stability: true` blocks until the deploy is steady, so a failing health check fails the workflow.

---

## Generating the base task definition for the workflow

The action expects a JSON file. We generate it from Terraform once, then commit it. Drift is fine because the workflow only patches the `image` field; everything else is re-set by Terraform on infra changes.

```bash
cd terraform
terraform output -raw task_definition_json > task-definition.json
git add task-definition.json
```

Re-run after any infra change that touches the task definition (env vars, secrets, resource sizes). [08](./08-cd-infra.md) will document making this part of the infra pipeline so it stays in sync.

---

## Rollback

Two flavors:

### Manual rollback to a known SHA

1. `workflow_dispatch` the workflow with `sha: <previous-good-sha>`.
2. Wait ~3-5 min.

### Manual rollback via AWS console

If something is so broken the workflow won't run:

```sh
# List recent task definition revisions
aws ecs list-task-definitions --family-prefix enhanced-review

# Update service to point at a previous revision
aws ecs update-service --cluster enhanced-review --service enhanced-review --task-definition enhanced-review:42
```

### Automatic rollback (default)

ECS deployment circuit breaker (enabled in [06b](./06b-application.md)) detects failed deployments via target health and auto-reverts to the previous task definition. We don't have to do anything; just check CloudWatch and the ECS console.

---

## Image tagging

Every successful build pushes two tags:

| Tag                | Mutability | Purpose                                           |
| ------------------ | ---------- | ------------------------------------------------- |
| `sha-<commit-sha>` | Immutable  | Trace provenance; what's deployed at any time     |
| `latest`           | Mutable    | Convenience; emergency `docker run :latest` smoke |

**Don't tag with version numbers.** The repo doesn't ship versions. Commit SHA is the only stable identifier.

ECR lifecycle policy ([06a](./06a-platform.md)) keeps the last 10 `sha-` images, expires the rest. So a 6-month-old build is gone — _that's intentional_. If you need to deploy old code, build it from source.

---

## OIDC trust gotchas

The trust policy on `enhanced-review-github-image-deploy` (defined in [06b](./06b-application.md)) restricts the role to:

- `repo:twynsicle/enhanced-review:ref:refs/heads/main` (push-to-main deploys)
- `repo:twynsicle/enhanced-review:pull_request` (we don't currently let PR builds deploy, but this allows future workflow_dispatch from a fork PR; remove if you want to be strict)

Things that will trip you up if changed:

- **Forking and renaming the repo** invalidates the trust policy. Update `:sub` in the trust statement.
- **Switching default branch from `main`** (don't, but if you ever do) breaks the `:ref` match.
- **GitHub OIDC thumbprint rotation** — happens occasionally. The Terraform resource hardcodes `6938fd4d98bab03faadb97b34396831e3780aea1`. If GitHub rotates, deploys silently fail with `Not authorized to perform sts:AssumeRoleWithWebIdentity`. Fix: re-read the [GitHub docs](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments) for the current value.

---

## Drift between image and infra

What if a deploy needs both an image change and an infra change (e.g. a new env var)?

- **Default flow:** infra change first ([08](./08-cd-infra.md)) → infra deploy creates new task def with the env var → image deploy updates the image and inherits that env var.
- **If you do them in reverse:** the new image runs without the env var. App may crash on startup. Fix: trigger an infra deploy.
- **Hard rule:** never edit envs/secrets in the image deploy workflow. The task-def template is owned by Terraform.

---

## Verification

Phase D-part-1 success:

1. Push a benign change to `main` (e.g. README typo). Workflow runs. CI passes. Deploy runs. New task running with new SHA.
2. Trace: `aws ecs describe-tasks ... | jq '.tasks[].taskDefinitionArn'` shows the latest revision.
3. ECR has `:sha-<commit>` and `:latest` tagged with the same digest.
4. Rollback: `workflow_dispatch` with the previous SHA. New deploy succeeds. App is on the older image.
5. Forced failure: introduce a hard error in the entrypoint that makes startup fail. Workflow times out (15 min). Circuit breaker reverts to the previous task def. Service is healthy on the old image.
6. CI fails (e.g. lint error in the change). Deploy doesn't run; no image push.
