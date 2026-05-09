# Terraform — enhanced-review on AWS

Two Terraform root modules deploy this app on AWS:

- **`platform/`** — shared infra (VPC, ECS cluster, ALB + listener, Cognito user pool, Route 53 zone, wildcard ACM cert, GitHub OIDC provider, ECR repos). One apply per AWS account; reused if more apps adopt the pattern.
- **`apps/enhanced-review/`** — this app's resources (ECS task + service, EFS, listener rule, Cognito client, Secrets Manager entries, scoped IAM, log group, DNS record). Reads platform outputs via `terraform_remote_state`.

The full design lives in [`docs/ecs-migration/06a-platform.md`](../docs/ecs-migration/06a-platform.md) and [`docs/ecs-migration/06b-application.md`](../docs/ecs-migration/06b-application.md). The execution playbook (commit-by-commit) is in [`docs/ecs-migration/phase-c-plan.md`](../docs/ecs-migration/phase-c-plan.md).

---

## First-time bring-up

### 1. Create the state backend (one-time, per AWS account)

```sh
bash terraform/bootstrap.sh
```

Creates an S3 bucket `enhanced-review-tfstate-<account-id>` and a DynamoDB table `enhanced-review-tflock`. Idempotent. Prints the `-backend-config` values to use in step 2.

### 2. Apply the platform module

```sh
cd terraform/platform
terraform init \
  -backend-config="bucket=enhanced-review-tfstate-<account-id>" \
  -backend-config="key=platform/terraform.tfstate" \
  -backend-config="region=us-west-2" \
  -backend-config="dynamodb_table=enhanced-review-tflock" \
  -backend-config="encrypt=true"

terraform apply -var="domain_name=yourdomain.com"
```

After commit 4 of phase-c-plan applies the Route 53 zone, **update your domain registrar's NS records** to point at the four AWS NS values (visible via `terraform output route53_name_servers`). Wait for DNS propagation before commit 5's apply.

### 3. Apply the application module

```sh
cd ../apps/enhanced-review
terraform init \
  -backend-config="bucket=enhanced-review-tfstate-<account-id>" \
  -backend-config="key=apps/enhanced-review/terraform.tfstate" \
  -backend-config="region=us-west-2" \
  -backend-config="dynamodb_table=enhanced-review-tflock" \
  -backend-config="encrypt=true"

terraform apply -var="platform_state_bucket=enhanced-review-tfstate-<account-id>"
```

Between commits 7 and 8 of phase-c-plan, populate `postgres-password` in Secrets Manager (the postgres sidecar will not start with an empty password):

```sh
aws secretsmanager put-secret-value \
  --secret-id enhanced-review/postgres-password \
  --secret-string "$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-32)"
```

After the app applies and you create a Cognito user out-of-band, hit `https://enhanced-review.yourdomain.com` to verify the placeholder responds.

---

## Layout

```
terraform/
  bootstrap.sh              State backend bootstrap. One-time per AWS account.
  README.md                 This file.
  platform/                 Platform root module (shared infra).
    versions.tf
    variables.tf
    outputs.tf              Read by the app module via terraform_remote_state.
    vpc.tf                  Commit 2.
    ecs-cluster.tf          Commit 3.
    ecr.tf                  Commit 3 (one ECR repo per registered app).
    iam-oidc.tf             Commit 3.
    route53.tf              Commit 4. Hosted zone only; cert lives in acm.tf.
    acm.tf                  Commit 5. Wildcard cert + DNS validation.
    alb.tf                  Commit 6. ALB + HTTPS listener + ALB SG.
    cognito.tf              Commit 6. Shared user pool + hosted UI domain.
  apps/enhanced-review/     Application root module.
    versions.tf
    variables.tf
    outputs.tf
    data.tf                 Reads platform outputs via remote state.
    secrets.tf              Commit 7. 5 Secrets Manager entries.
    iam.tf                  Commit 7. Task exec / task / GitHub deploy roles.
    cloudwatch.tf           Commit 7. /ecs/enhanced-review log group.
    efs.tf                  Commit 7. FS + mount targets + access point.
    security-groups.tf      Commit 7. Task SG + EFS SG.
    task-definition.tf      Commit 8. web (placeholder) + postgres sidecar.
    service.tf              Commit 8.
    alb-target.tf           Commit 8. Target group + listener rule.
    cognito-client.tf       Commit 8. App-specific user pool client.
    route53.tf              Commit 8. ALIAS record for the subdomain.
```

---

## Day-2 ops

See [`docs/ecs-migration/09-cost-and-operations.md`](../docs/ecs-migration/09-cost-and-operations.md): kill-switch, secret rotation, allowlist management via ECS Exec, manual backup, log queries.
