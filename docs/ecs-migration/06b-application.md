# 06b — Application Terraform module

The per-app layer. One Terraform module per app deployed onto the platform. Owns the ECS task + service, EFS data store, ALB target group + listener rule, Cognito user pool client, Route 53 ALIAS record, Secrets Manager entries, scoped IAM roles, CloudWatch log group, and per-app security groups.

This is **Phase C** material. Companion to [06a-platform.md](./06a-platform.md) (the shared infra) and [phase-c-plan.md](./phase-c-plan.md) (execution playbook).

Code lives at `terraform/apps/enhanced-review/` in the repo root. A second app would copy this module to `terraform/apps/<app-name>/` with `var.app_name`, `var.subdomain`, `var.github_owner`/`var.github_repo` overridden.

---

## How the app reads platform outputs

```hcl
data "terraform_remote_state" "platform" {
  backend = "s3"
  config = {
    bucket         = var.platform_state_bucket
    key            = "platform/terraform.tfstate"
    region         = var.region
    dynamodb_table = var.platform_state_lock_table
    encrypt        = true
  }
}
```

A `local.platform = data.terraform_remote_state.platform.outputs` map gives access to `vpc_id`, `ecs_cluster_id`, `alb_listener_https_arn`, `cognito_user_pool_arn`, `route53_zone_id`, etc. (full list in [06a](./06a-platform.md)).

The platform module must be applied first; on initial app apply Terraform reads platform outputs at plan time.

---

## Decisions feeding into this doc

- **D1, D5** Single multi-container task: web + postgres sidecar
- **D6** EFS volume for Postgres data (no NAT, no EBS — Fargate's only native persistent option)
- **D7** Per-app Cognito user pool client + listener rule (`authenticate-cognito + forward`)
- **D9** Secrets Manager for credentials, populated out-of-band so values never enter terraform state
- **D10** GitHub OIDC deploy role scoped to the specific repo (`repo:twynsicle/enhanced-review:*`)

---

## Architecture (per-app)

```
                                 │ host header: enhanced-review.<domain>
                                 ▼
         ┌─────────────────────────────────────────────┐
         │  Listener rule (priority 100)               │
         │   action 1: authenticate-cognito            │
         │            (this app's user pool client)    │
         │   action 2: forward → target group          │
         └─────────────────────────────────────────────┘
                                 │
                                 ▼
         ┌─────────────────────────────────────────────┐
         │  Target group `enhanced-review-web` :3000   │
         │  health: GET /api/health → 200              │
         └─────────────────────────────────────────────┘
                                 │
                                 ▼
         ┌─────────────────────────────────────────────┐
         │  ECS task (1)                               │
         │  ┌────────────┐    ┌────────────┐           │
         │  │ web :3000  │    │ postgres   │           │
         │  │ var.web_   │    │ :17-alpine │           │
         │  │   image    │    │ EFS mount  │           │
         │  └────────────┘    └─────┬──────┘           │
         │  Public subnet (assigned public IP)         │
         │  Task SG: ingress :3000 from ALB-SG only    │
         └─────────────────────────────────────────────┘
                                       │
                                       ▼
                  ┌───────────────────────────────────────┐
                  │   EFS file system + access point       │
                  │   /var/lib/postgresql/data/pgdata      │
                  │   2 mount targets (one per AZ)         │
                  └───────────────────────────────────────┘

   Secrets Manager (5)  ──→ ECS task definition `secrets[]`
   ECR (from platform)  ──→ ECS task definition `image` (Phase D)
   Route 53 ALIAS       ──→ ALB DNS
   CloudWatch Logs      ←── awslogs driver
   GitHub OIDC role     ←── Phase D's image-deploy workflow
```

---

## ECS task definition

Two containers, one shared task ENI, one EFS volume mounted into postgres.

| Container | Image                                              | Notes                                                                                    |
| --------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `web`     | `var.web_image` (default `hashicorp/http-echo`)    | `essential = true`. Listens on `:3000`. depends on postgres being HEALTHY.               |
| `postgres`| `postgres:17-alpine`                               | `essential = true`. EFS-mounted at `/var/lib/postgresql/data`; `PGDATA=.../pgdata` (subdir to avoid `lost+found`). pg_isready healthcheck. |

**Both containers `essential`** — if postgres dies, the whole task restarts. Required, because the web container can't survive losing its DB.

**Web waits for postgres HEALTHY** before booting. ECS handles the ordering.

**ECS Exec enabled** (`enable_execute_command = true`) — lets `aws ecs execute-command` open a shell into either container for ops (psql, log inspection). See [09](./09-cost-and-operations.md).

**Service `lifecycle.ignore_changes = [task_definition]`** — Phase D's image-deploy pipeline registers new task definition revisions and updates the service out-of-band. Without `ignore_changes`, every `terraform apply` would fight the pipeline.

### Phase C placeholder vs Phase D real image

- Phase C's first apply uses `var.web_image = "public.ecr.aws/hashicorp/http-echo:0.2.3"` with `command = ["-listen=:3000", "-text=enhanced-review placeholder"]`. http-echo answers 200 on every path including `/api/health`, so the ALB target group health check passes without app changes.
- Phase D's image-deploy pipeline pushes the real image to ECR (the platform-owned repo), registers a new task-def revision pointing at the SHA-tagged ECR URL, and `aws ecs update-service` rolls it out. The placeholder is gone after that.

The full task def is identical between Phase C and Phase D — only the web image URI changes.

---

## EFS

```
aws_efs_file_system.pgdata          (encrypted, generalPurpose, bursting throughput)
├─ aws_efs_mount_target.pgdata[<subnet-a>]
├─ aws_efs_mount_target.pgdata[<subnet-b>]
└─ aws_efs_access_point.pgdata      (UID/GID 999, /pgdata 0700)
```

Mount targets in both AZs let either subnet's task mount the same FS. The access point pins ownership to UID 999 (the postgres image's user) so the container starts cleanly.

EFS SG ingress: NFS (2049) from the task SG only.

**Why EFS, not EBS:** EBS volumes attach to EC2 instances, not Fargate tasks. Fargate's only native persistent option is EFS. Trade-off: ~10ms p99 vs <1ms on EBS — invisible at POC traffic.

---

## Secrets Manager

Five entries per app, created empty by Terraform; values populated out-of-band so they never enter `terraform.tfstate`:

| Secret name                          | Use                                              | Phase C state                       |
| ------------------------------------ | ------------------------------------------------ | ----------------------------------- |
| `enhanced-review/auth-secret`        | `AUTH_SECRET` (Auth.js cookie/JWT signing)       | populate with 32-byte random        |
| `enhanced-review/auth-github-id`     | GitHub OAuth App client ID                       | empty until Phase D                 |
| `enhanced-review/auth-github-secret` | GitHub OAuth App client secret                   | empty until Phase D                 |
| `enhanced-review/anthropic-key`      | `ANTHROPIC_API_KEY` (when `REVIEW_EXECUTOR=claude`) | empty until Phase D              |
| `enhanced-review/postgres-password`  | `POSTGRES_PASSWORD` for the postgres sidecar     | **must be populated before commit 8** |

Population:

```sh
aws secretsmanager put-secret-value \
  --secret-id enhanced-review/postgres-password \
  --secret-string "$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-32)"

aws secretsmanager put-secret-value \
  --secret-id enhanced-review/auth-secret \
  --secret-string "$(openssl rand -base64 32)"
```

Why empty during Phase C is fine: the placeholder web container ignores env vars it doesn't read. Postgres needs a non-empty password.

> **Postgres password rotation is hard.** The password is hashed in the postgres data dir on EFS. Rotation requires either downtime (alter user via psql + Secrets Manager update + restart) or a second-user dance. Out of scope for the POC; see [09](./09-cost-and-operations.md).

---

## IAM

Three roles per app. All in `terraform/apps/<app>/iam.tf`.

### Task execution role (`<app>-task-execution`)

What ECS itself needs to start the container: pull from ECR, fetch secrets, write logs.

- Trust: `ecs-tasks.amazonaws.com`
- Managed policy: `AmazonECSTaskExecutionRolePolicy` (covers ECR pull + log writes).
- Inline policy: `secretsmanager:GetSecretValue` scoped to this app's 5 secret ARNs.

### Task role (`<app>-task`)

What the running app can do at AWS APIs. **For `enhanced-review`: nothing.** The app talks to GitHub + Anthropic + the sidecar postgres on localhost — no AWS APIs. Empty role; expand here if S3 backups, SES, etc. land later.

### GitHub image-deploy role (`<app>-github-image-deploy`)

Assumed by `.github/workflows/deploy-image.yml` in Phase D via OIDC.

- Trust: federated via the platform's `github_oidc_provider_arn`. Restricted by `sub` claim to `repo:<github_owner>/<github_repo>:ref:refs/heads/main` and `repo:<github_owner>/<github_repo>:pull_request`.
- Permissions:
  - ECR push to this app's repo only (`ecr:PutImage` etc.).
  - `ecr:GetAuthorizationToken` (must be `*`, AWS rule).
  - `ecs:RegisterTaskDefinition` and `DescribeTaskDefinition` (must be `*`, AWS doesn't allow scoping these to a family).
  - `ecs:UpdateService`, `DescribeServices`, `ListTasks`, `DescribeTasks` scoped to this cluster/service ARN.
  - `iam:PassRole` for the two task roles only (required by RegisterTaskDefinition).

A separate **infra-deploy role** with broader Terraform permissions is described in [08](./08-cd-infra.md). Different blast radii.

---

## ALB target group + listener rule

Target group `<app>-web` on :3000, `target_type = "ip"`, health check `GET /api/health → 200`. `deregistration_delay = 30`.

Listener rule attached to the platform's HTTPS listener at `priority = 100`:

- Condition: `host_header = ["enhanced-review.<domain>"]`
- Action 1 (`order = 1`): `authenticate-cognito` referencing this app's user pool client
- Action 2 (`order = 2`): `forward` to the target group

**Convention:** each registered app uses a fixed priority (this=100, next=110, etc.). Ten-step gaps leave room to insert per-path bypass rules above (e.g. a `/webhooks/*` path that skips Cognito).

Route 53: ALIAS A record `<subdomain>.<domain>` → ALB DNS.

---

## Cognito user pool client

Sits inside the platform's shared `platform-users` pool. Per-app client because each app has its own callback URL:

```hcl
callback_urls = ["https://enhanced-review.<domain>/oauth2/idpresponse"]
```

`generate_secret = true` — the listener's authenticate-cognito flow uses a confidential client.

`supported_identity_providers = ["COGNITO"]` — only the platform's own user pool is allowed. To add Google or another federated IdP, edit the platform module's user pool, then add to this list.

---

## CloudWatch logs

Single log group `/ecs/<app_name>` with 7-day retention. Both containers stream here, distinguished by `awslogs-stream-prefix` (`web/...` and `postgres/...`).

Tail with: `aws logs tail /ecs/enhanced-review --follow`.

---

## Security groups

| SG               | Ingress                                | Egress             |
| ---------------- | -------------------------------------- | ------------------ |
| `<app>-task`     | `:3000` from `platform-alb` SG only    | unrestricted       |
| `<app>-efs`      | `:2049` from `<app>-task` SG only      | unrestricted       |

The task gets a public IP because it's in a public subnet, but port 3000 is only reachable from the ALB SG. Postgres on `127.0.0.1:5432` is never exposed because it's a sidecar in the same task ENI.

---

## Out-of-band steps

In order, around the Terraform applies:

1. **Before app commit 8 applies** — populate `postgres-password` (and ideally `auth-secret`) in Secrets Manager.
2. **After app commit 8 applies** — create a Cognito user (one-time):
   ```sh
   aws cognito-idp admin-create-user \
     --user-pool-id <from platform output> \
     --username you@example.com \
     --user-attributes Name=email,Value=you@example.com Name=email_verified,Value=true \
     --message-action SUPPRESS \
     --temporary-password 'TempPass123!'
   ```
3. **Phase D, before first real image deploy** — create a new GitHub OAuth App with callback URL `https://enhanced-review.<domain>/api/auth/callback/github`. Populate `auth-github-id` and `auth-github-secret`.
4. **Phase D, before first real review** — populate `anthropic-key`.

---

## Verification

Phase C app success (after platform applied):

1. `cd terraform/apps/enhanced-review && terraform init -backend-config=…`
2. `terraform apply -var="platform_state_bucket=enhanced-review-tfstate-<account-id>"` — completes for commit 7's resources (secrets, IAM, log group, EFS, SGs).
3. Populate `postgres-password` (and `auth-secret`) per the out-of-band step above.
4. `terraform apply` again — commit 8's resources (task def, service, target group, listener rule, Cognito client, Route 53 record).
5. `aws ecs describe-services --cluster platform-cluster --services enhanced-review` — `runningCount = 1`, no error events.
6. `aws ecs describe-tasks --cluster platform-cluster --tasks <task-arn>` — both `web` and `postgres` containers in `RUNNING` state.
7. `dig +short A enhanced-review.<domain_name>` — returns ALB IPs.
8. After creating the Cognito user, hit `https://enhanced-review.<domain_name>/` in a browser — 302 to Cognito hosted UI, sign in, land on the placeholder response.
9. `aws ecs execute-command --cluster platform-cluster --task <arn> --container postgres --interactive --command "psql -U app -d enhanced_review"` — works; `\dt` shows no tables (placeholder doesn't run migrations).
10. CloudWatch log group `/ecs/enhanced-review` has streams for both `web/<task-id>` and `postgres/<task-id>`.

---

## Open questions to resolve during execution

- **`/api/health` Cognito exemption.** Internal ALB→target health checks bypass the listener's `authenticate-cognito` action — they originate from the ALB itself, not authenticated users. So `/api/health` works for the target-group health check. **External monitoring** (UptimeRobot etc.) hitting `/api/health` from the public internet would be blocked by Cognito. If we ever want this, add a listener rule above priority 100 with path condition `/api/health` and action `forward` (no auth).
- **Public IP rotation.** Each task restart gets a new public IP. If GitHub or Anthropic ever rate-limit by IP rapidly, we'd need NAT after all. Highly unlikely for personal-POC traffic.
- **EFS throughput mode.** Start with `bursting`. If postgres feels slow, switch to `elastic` (~$0.03/GB-month committed). One-line change.
- **ECS Service Connect.** Not needed because two containers in one task share `localhost`. Worth revisiting if the app ever splits postgres into a separate service.
