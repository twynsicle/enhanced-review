# 07 — CD pipeline: image build & deploy

GitHub Actions workflow that builds a Docker image on push to `main`, pushes it to ECR, registers a new ECS task definition revision, and updates the service. Uses GitHub OIDC federation so no AWS keys live in GitHub secrets. The task definition is **fetched live from ECS at deploy time** — no JSON file is checked into the repo.

This is Phase D-part-1. Phase C's Terraform-managed infra must already exist; this pipeline only updates the running app.

The implemented workflow is `.github/workflows/deploy-image.yml`. The execution playbook for landing it is in [phase-d-plan.md](./phase-d-plan.md).

---

## Decisions feeding into this doc

- **D10** GitHub Actions ↔ AWS via OIDC federation
- **Phase D, D1** Live-fetch the current task definition from ECS in the workflow (no checked-in JSON, no auto-commit-back-to-main)
- Two separate pipelines: image (this doc) and infra ([08](./08-cd-infra.md))
- Push-to-deploy on `main`; manual `workflow_dispatch` always available

---

## Goals

- **One-step deploy.** Merging to `main` is the ship signal. No manual ECR push, no manual task-def edit.
- **No long-lived AWS credentials.** OIDC trust policy on the IAM role restricts to this repo + branch.
- **Deploys gated by CI.** If `format:check`, `lint`, `typecheck`, or `test` fail, no deploy.
- **Traceable.** Every deployed image is tagged with its commit SHA. Rollback = redeploy a previous SHA.
- **Safe by default.** ECS deployment circuit breaker auto-rolls back failed deployments.
- **Single source of truth for the task def.** Whatever is in ECS now is what we patch. Terraform owns env vars / secrets / resources; the image deploy only touches the `image` field.

---

## File layout

```
.github/workflows/
  ci.yml              # existing — runs on PR + push, also exposes workflow_call for reuse
  deploy-image.yml    # this doc — runs on push to main + manual dispatch
  deploy-infra.yml    # doc 08 — Terraform plan/apply
```

---

## `deploy-image.yml`

The actual file lives at `.github/workflows/deploy-image.yml`. Shape:

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
  AWS_REGION: us-west-2
  ECR_REPOSITORY: enhanced-review
  ECS_CLUSTER: platform-cluster
  ECS_SERVICE: enhanced-review
  ECS_TASK_FAMILY: enhanced-review

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

### Step-by-step

- **`paths-ignore`** keeps the image pipeline from firing on infra-only or docs-only PRs. The `*.md` entry covers the README typo case.
- **`concurrency` with `cancel-in-progress: false`** prevents a second push from cancelling a running deploy. ECS will sequentially apply both task-definition revisions in order.
- **`uses: ./.github/workflows/ci.yml`** reuses the existing CI workflow, which exposes `workflow_call` (added in Phase D commit 1). If CI fails, deploy never starts.
- **`docker/build-push-action@v6`** with `cache-from: type=gha` uses the GitHub Actions cache to keep build times down (~2 min cold, ~30s warm).
- **`amazon-ecr-login`** uses the temporary credentials from the OIDC step.
- **`aws ecs describe-task-definition --query taskDefinition`** fetches the LATEST ACTIVE revision for the family. This is the most recent revision that Terraform (or this workflow itself) registered. The `--query` strips the API response wrapper to match the file shape `amazon-ecs-render-task-definition` expects.
- **`amazon-ecs-render-task-definition`** patches only the `image` field for container `web`. Everything else (env vars, secrets, postgres sidecar, EFS mount) is preserved from the live task def.
- **`amazon-ecs-deploy-task-definition`** registers the new revision and updates the service. `wait-for-service-stability: true` blocks until the deploy is steady, so a failing health check fails the workflow and ECS auto-rolls back.

---

## Why live-fetch instead of a checked-in `task-definition.json`

Earlier drafts of this doc described exporting `terraform output -raw task_definition_json > terraform/task-definition.json` and committing the file, with the infra-deploy workflow auto-committing refreshes back to `main`.

That approach was abandoned in Phase D for three reasons:

1. **Branch protection blocks bot pushes.** The repo requires PRs to merge to `main` with no bypass. The bot would have had to open a PR to refresh the JSON, which is too much ceremony.
2. **CI loops.** A bot commit on `main` would re-trigger CI (and potentially other workflows) for what's effectively a generated artifact.
3. **Drift surface.** The committed file goes stale if anyone forgets the export step. Live-fetch makes "what ECS has now" the source of truth and eliminates the failure mode.

The trade-off: the image-deploy workflow is now coupled to ECS being reachable. If ECS is in a degraded state, the deploy can't even prepare the new task-def. Acceptable — if ECS is degraded, the deploy was going to fail anyway.

---

## Rollback

Three flavors:

### Manual rollback to a known SHA

1. `workflow_dispatch` the workflow with `sha: <previous-good-sha>`.
2. Wait ~3-5 min.

### Manual rollback via AWS console

If something is so broken the workflow won't run:

```sh
# List recent task definition revisions
aws ecs list-task-definitions --family-prefix enhanced-review

# Update service to point at a previous revision
aws ecs update-service --cluster platform-cluster --service enhanced-review --task-definition enhanced-review:42
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

The trust policy on `enhanced-review-github-image-deploy` (defined in [06b](./06b-application.md), `terraform/apps/enhanced-review/iam.tf`) restricts the role to:

- `repo:twynsicle/enhanced-review:ref:refs/heads/main` (push-to-main deploys)
- `repo:twynsicle/enhanced-review:pull_request` (allows future workflow_dispatch from PR runs; remove if you want to be strict)

Things that will trip you up if changed:

- **Forking and renaming the repo** invalidates the trust policy. Update the `:sub` condition to the new owner/repo.
- **Switching the default branch from `main`** breaks the `:ref` match. Don't.
- **GitHub OIDC thumbprint rotation.** Happens occasionally. The Terraform resource hardcodes `6938fd4d98bab03faadb97b34396831e3780aea1`. If GitHub rotates, deploys silently fail with `Not authorized to perform sts:AssumeRoleWithWebIdentity`. Fix: re-read the [GitHub docs](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments) for the current value.

---

## Drift between image and infra

What if a deploy needs both an image change and an infra change (e.g. a new env var)?

- **Default flow:** infra change first ([08](./08-cd-infra.md)) → infra deploy registers a new task-def revision with the env var → next image deploy fetches the latest revision and inherits that env var when patching the `image` field.
- **If you do them in reverse:** the new image runs without the env var. App may crash on startup. Fix: trigger an infra deploy.
- **Hard rule:** never edit envs/secrets in the image deploy workflow. The task-def template is owned by Terraform.
- **PRs that touch both `terraform/**` and source files** are a race. Both workflows fire in parallel; the image deploy's `describe-task-definition` may land on either pre- or post-apply revision depending on timing. **Keep TF and source changes in separate PRs.**

---

## Verification

Phase D-part-1 success:

1. Push a benign change to `main` (e.g. one-character source edit). Workflow runs. CI passes. Deploy runs. New task running with new SHA.
2. Trace: `aws ecs describe-tasks --cluster platform-cluster ... | jq '.tasks[].taskDefinitionArn'` shows the latest revision.
3. ECR has `:sha-<commit>` and `:latest` tagged with the same digest.
4. Rollback: `workflow_dispatch` with the previous SHA. New deploy succeeds. App is on the older image.
5. Forced failure: introduce a hard error in the entrypoint that makes startup fail. Workflow times out (15 min). Circuit breaker reverts to the previous task def. Service is healthy on the old image.
6. CI fails (e.g. lint error in the change). Deploy doesn't run; no image push.
