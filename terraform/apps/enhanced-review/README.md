# enhanced-review — application module

This is the Terraform root module for the `enhanced-review` app. Provisions the per-app resources (ECS task + service, EFS, listener rule, Cognito client, Route 53 record, secrets, scoped IAM, log group, security groups). Reads platform outputs (VPC, cluster, ALB, Cognito user pool, ECR repo, etc.) via `terraform_remote_state`.

Design reference: [`docs/ecs-migration/06b-application.md`](../../../docs/ecs-migration/06b-application.md). Bring-up playbook: [`docs/ecs-migration/phase-c-plan.md`](../../../docs/ecs-migration/phase-c-plan.md).

---

## First-time apply

Prerequisite: the platform module ([`../../platform/`](../../platform/)) must be applied first — this module reads its outputs.

```sh
cd terraform/apps/enhanced-review

terraform init \
  -backend-config="bucket=enhanced-review-tfstate-<account-id>" \
  -backend-config="key=apps/enhanced-review/terraform.tfstate" \
  -backend-config="region=us-west-2" \
  -backend-config="dynamodb_table=enhanced-review-tflock" \
  -backend-config="encrypt=true"

# First apply: creates secrets, IAM, EFS, log group, SGs (no service yet)
terraform apply -var="platform_state_bucket=enhanced-review-tfstate-<account-id>"
```

Between this apply and the next, populate `postgres-password` (the postgres sidecar will not start with an empty password):

```sh
aws secretsmanager put-secret-value \
  --secret-id enhanced-review/postgres-password \
  --secret-string "$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-32)"

aws secretsmanager put-secret-value \
  --secret-id enhanced-review/auth-secret \
  --secret-string "$(openssl rand -base64 32)"
```

Then re-apply to bring up the ECS task definition + service + ALB target + listener rule + Cognito client + Route 53 record. The web container starts on the placeholder image (`hashicorp/http-echo`) and answers 200 on every path until Phase D's image-deploy pipeline pushes the real image.

---

## Verifying

After apply succeeds and a Cognito user is created in the platform's pool, hit the app URL:

```sh
terraform output app_url
# https://enhanced-review.yourdomain.com

# In a browser: redirected to Cognito hosted UI, sign in, see the placeholder response.
```

Useful one-liner to exec into postgres:

```sh
TASK_ARN=$(aws ecs list-tasks --cluster $(terraform -chdir=../../platform output -raw ecs_cluster_name) --service-name enhanced-review --query 'taskArns[0]' --output text)
aws ecs execute-command --cluster platform-cluster --task "$TASK_ARN" --container postgres --interactive --command "psql -U app -d enhanced_review"
```

---

## Day-2 ops

See [`docs/ecs-migration/09-cost-and-operations.md`](../../../docs/ecs-migration/09-cost-and-operations.md): secret rotation, allowlist edits via ECS Exec, kill switch, manual backups.

---

## Files

- `versions.tf` — Terraform + AWS provider version constraints + S3 backend stub.
- `variables.tf` — All inputs (region, app_name, subdomain, web_image, github_owner/repo, etc.).
- `data.tf` — `terraform_remote_state.platform` data source + computed locals.
- `outputs.tf` — App URL, ECS service ARN, GitHub deploy role ARN (for Phase D), etc.
- `secrets.tf` — 5 Secrets Manager entries (created empty).
- `iam.tf` — Task execution role, task role, GitHub image-deploy role.
- `cloudwatch.tf` — `/ecs/enhanced-review` log group.
- `efs.tf` — File system + 2 mount targets + access point (UID/GID 999).
- `security-groups.tf` — Task SG + EFS SG.
- `task-definition.tf` — Two-container task (web + postgres sidecar).
- `service.tf` — ECS service in the platform cluster.
- `alb-target.tf` — Target group + listener rule.
- `cognito-client.tf` — Per-app user pool client.
- `route53.tf` — ALIAS A record subdomain → ALB.
