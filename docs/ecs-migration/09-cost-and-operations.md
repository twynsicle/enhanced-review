# 09 — Cost & operations

What this thing costs per month, what to do when it breaks, and how to put it to sleep when you're not using it.

This is the day-2 doc. Read it once during Phase E, then come back when you need to do something operational.

---

## Monthly cost

Estimates for `us-west-2`, post-launch, no traffic. Real numbers will vary by ±20% based on egress and image build cache.

### Default (public subnet, no NAT)

| Line item                                     | Cost          | Notes                                                                      |
| --------------------------------------------- | ------------- | -------------------------------------------------------------------------- |
| Application Load Balancer                     | **~$18/mo**   | Fixed. ~$0.0225/h \* 720h + LCU charges. The single biggest item.          |
| Fargate task (0.5 vCPU + 1 GB, 24/7)          | **~$15/mo**   | $0.04/h \* 720h. Two-container task uses one set of vCPU/memory.           |
| EFS (1 GB, bursting throughput)               | **~$0.30/mo** | $0.30/GB/mo for standard. Tiny.                                            |
| Route 53 hosted zone                          | **~$0.50/mo** | $0.50/zone, no per-query at our volume.                                    |
| Secrets Manager (5 secrets)                   | **~$2/mo**    | $0.40/secret/mo. Plus $0.05 per 10k API calls (we make ~3 per task start). |
| CloudWatch Logs (under 5 GB/mo, 7d retention) | **~$0**       | First 5 GB ingestion + storage free.                                       |
| ECR storage (10 images, ~150 MB each)         | **~$0.15/mo** | $0.10/GB/mo. Plus pulls (free for same-region).                            |
| Data egress (GitHub clones + Anthropic API)   | **~$1-3/mo**  | Wild guess. ~$0.09/GB after first 100 GB free. Minimal for a personal POC. |
| Cognito user pool (1 user)                    | **$0**        | First 50,000 MAU free.                                                     |
| ACM certificate                               | **$0**        | Free.                                                                      |
| GitHub OIDC IAM role                          | **$0**        | Free.                                                                      |
| S3 state bucket + DynamoDB lock               | **~$0.50/mo** | Pennies.                                                                   |
| Domain registration                           | **~$1/mo**    | Amortized: $12/yr `.com`, ~$5/yr `.dev`.                                   |
| **TOTAL**                                     | **~$37/mo**   |                                                                            |

### If we'd chosen private subnet + NAT (rejected)

Add **~$32/mo** for the NAT Gateway (`$0.045/h + $0.045/GB`) → ~$69/mo total. Roughly double. Doc [11](./11-proposal-lightweight-infra.md) frames this as the central cost lever for SREs reviewing the pattern.

### If we removed Cognito + ALB (alternative considered, rejected)

Drop ALB (-$18) and Cognito (already $0), replace with Cloudflare Tunnel sidecar (free) → ~$18/mo total.
That's the cheap path; we accepted ~$18/mo more for AWS-native auth. Documented in case the user changes their mind.

---

## Kill switch — pausing the app for cheap

When you go on vacation or aren't actively using the POC, you can drop cost to <$2/mo without destroying state.

### Soft-kill (keeps state, stops compute)

```sh
# Scale ECS service to 0
aws ecs update-service --cluster platform-cluster --service enhanced-review --desired-count 0
```

Cost drops to:

- ALB: still ~$18/mo (it stays up, can't easily be paused without DNS surgery).
- Fargate: $0 (no running tasks).
- EFS: $0.30/mo (data preserved).
- Everything else unchanged: ~$4/mo.
- **~$22/mo when paused.**

To resume: `--desired-count 1`. ~5 minutes to fully come back.

### Hard-kill (destroys app stack, keeps state)

For longer pauses, destroy the platform's ALB + this app's ECS service. EFS data and Secrets Manager values are preserved (they're per-app resources but not targeted here).

```sh
# In the app module, destroy just the service:
cd terraform/apps/enhanced-review
terraform destroy -target=aws_ecs_service.app

# In the platform module, destroy the ALB:
cd ../../platform
terraform destroy -target=aws_lb.main
```

Cost drops to:

- EFS: $0.30/mo (data preserved).
- Route 53 + ECR + Secrets Manager + S3 + domain: ~$4/mo.
- **~$5/mo when hard-killed.**

To resume: `terraform apply` in platform (recreates ALB), then `terraform apply` in the app module (recreates the service). ~10 minutes total. DNS A-ALIAS points at the new ALB automatically because the app's `aws_route53_record.app` is recreated to alias the new ALB.

> **Don't `terraform destroy` everything** — destroying the EFS volume in the app module or the Cognito user pool in the platform module is data loss. The targeted destroys above are the safe variant.

### Nuke (complete teardown)

Only if you're done with the POC for good. Destroy in reverse dependency order — app first, then platform:

```sh
cd terraform/apps/enhanced-review
terraform destroy

cd ../../platform
terraform destroy
```

EFS data, Cognito users, Secrets Manager values — gone. Empty the S3 state bucket and delete the DynamoDB lock table by hand (they're not Terraform-managed). Deregister the domain in Route 53 if you don't want to keep paying $12/yr.

---

## Continuous deployment

Two GitHub Actions workflows handle deploys; both use OIDC federation, no long-lived AWS keys:

- **`.github/workflows/deploy-image.yml`** — fires on push to `main` (paths-ignored: `terraform/**`, `docs/**`, `*.md`, the other workflow). Runs CI as a `workflow_call` job, builds the Docker image, pushes to ECR with `:sha-<commit>` and `:latest` tags, live-fetches the current ECS task definition, patches the `image` field for container `web`, registers a new revision, and `UpdateService`. ECS deployment circuit breaker auto-rolls back failed deployments. See [07](./07-cd-image.md).
- **`.github/workflows/deploy-infra.yml`** — fires on PRs and pushes to `main` that touch `terraform/**`. Plan-on-PR (one comment per module: `platform`, `apps/enhanced-review`); apply-on-merge gated by the `production` GitHub Environment (one approval click per module). Sequential apply: platform first, app second. See [08](./08-cd-infra.md).

Both workflows assume IAM roles defined in Terraform: `enhanced-review-github-image-deploy` (app module, scoped image-deploy perms) and `enhanced-review-github-tf` (platform module, broader infra perms scoped by name prefix).

Rollback paths: see [07](./07-cd-image.md) "Rollback" — the recommended flow is `workflow_dispatch` of `deploy-image.yml` with a previous commit SHA.

---

## Day-2 runbook

### Adding/removing a user from the allowlist

Connect to the running Postgres via ECS Exec:

```sh
TASK_ARN=$(aws ecs list-tasks --cluster platform-cluster --service-name enhanced-review --query 'taskArns[0]' --output text)
aws ecs execute-command --cluster platform-cluster --task "$TASK_ARN" --container postgres --interactive --command "psql -U app -d enhanced_review"
```

Then in psql:

```sql
-- add
INSERT INTO allowed_users (id, github_login) VALUES (gen_random_uuid()::text, 'newuser');
-- remove
DELETE FROM allowed_users WHERE github_login = 'oldsuser';
-- list
SELECT github_login, created_at FROM allowed_users ORDER BY created_at;
```

`\q` to exit. ECS Exec session times out after 20 minutes idle.

### Rotating a secret

For Anthropic API keys, GitHub OAuth secrets, AUTH_SECRET — same pattern:

```sh
aws secretsmanager put-secret-value --secret-id enhanced-review/anthropic-key --secret-string "$NEW_VALUE"
aws ecs update-service --cluster platform-cluster --service enhanced-review --force-new-deployment
```

`force-new-deployment` makes ECS spin up a new task that fetches the rotated value.

For **POSTGRES_PASSWORD**: rotation is harder because the password is hashed in the Postgres data dir. Options:

1. (Easy, with downtime) Stop the service → exec into postgres → `ALTER USER app WITH PASSWORD '...'` → update Secrets Manager → start the service. ~5 min downtime.
2. (Harder, no downtime) Add a second user, switch the app to it, drop the old user. Out of scope for this runbook.

### Adding a new secret

When the app needs a new env var that's a secret:

```sh
# 1. Create the secret value
aws secretsmanager put-secret-value --secret-id enhanced-review/new-thing --secret-string "..."

# 2. Add the secretsmanager_secret resource to terraform/apps/enhanced-review/secrets.tf
# 3. Reference it in the task definition's `secrets[]` array in terraform/apps/enhanced-review/task-definition.tf
# 4. Add it to terraform/apps/enhanced-review/iam.tf — read access for the task execution role
# 5. PR + merge → deploy-infra.yml runs (plan-as-PR-comment, approval-gated apply) → next code push → deploy-image.yml picks up the new task-def via live-fetch
```

### Viewing logs

CloudWatch Logs Insights query examples:

```
# Web container errors
fields @timestamp, @message
| filter @logStream like 'web/'
| filter level = 'error'
| sort @timestamp desc
| limit 100

# Postgres slow queries
fields @timestamp, @message
| filter @logStream like 'postgres/'
| filter @message like /duration:/
| sort @timestamp desc
```

Or just stream live with the AWS CLI:

```sh
aws logs tail /ecs/enhanced-review --follow
aws logs tail /ecs/enhanced-review --follow --filter-pattern '"ERROR"'
```

### Forcing a redeploy without a code change

Useful when you want to pick up a rotated secret or restart the postgres connection pool:

```sh
aws ecs update-service --cluster platform-cluster --service enhanced-review --force-new-deployment
```

ECS will draw down the old task and start a new one. ~3 min total. **In-flight reviews are lost** (see [04](./04-job-runner-rewrite.md)) — only do this when no jobs are running.

### Backups (manual)

The POC has no automated backups. To take a manual snapshot:

```sh
TASK_ARN=$(aws ecs list-tasks --cluster platform-cluster --service-name enhanced-review --query 'taskArns[0]' --output text)
aws ecs execute-command --cluster platform-cluster --task "$TASK_ARN" --container postgres --interactive --command "pg_dump -U app -d enhanced_review -F c -f /tmp/backup.dump"

# Then copy out via S3:
# (inside the postgres exec session)
# 1. Set up an AWS CLI install once via apk add aws-cli (or copy a static binary)
# 2. aws s3 cp /tmp/backup.dump s3://your-bucket/backups/$(date +%F).dump
```

For a POC this is fine. For org-wide adoption ([11](./11-proposal-lightweight-infra.md)), a scheduled task that does `pg_dump | aws s3 cp -` is the next iteration.

### Stuck task / stuck deployment

ECS deploy is stuck for >15 minutes:

1. `aws ecs describe-services --cluster platform-cluster --services enhanced-review` — look for `events` array; recent failures bubble up here.
2. `aws ecs describe-tasks --cluster platform-cluster --tasks <task-arn>` — look for `stoppedReason`. Common ones: `EssentialContainerExited` (one of the two containers crashed), `Task failed ELB health checks`, `OutOfMemoryError`.
3. Check CloudWatch logs for both containers near the timestamp.

If the circuit breaker doesn't roll back automatically (timeout: 15min), force it:

```sh
aws ecs update-service --cluster platform-cluster --service enhanced-review --task-definition enhanced-review:<previous-good-revision>
```

### Postgres won't start (EFS mount issues)

Symptoms: `postgres` container repeatedly restarts; logs show `could not lock /var/lib/postgresql/data/...` or `permission denied`.

Common causes:

- **Multiple tasks tried to mount EFS at once.** Should be impossible (`desiredCount=1`), but if you forced two during a deploy edge case, both may hold a lock. Fix: scale to 0, wait 60s, scale back to 1.
- **EFS access point UID/GID mismatch.** The access point is configured with UID/GID 999. If you change the postgres image to a non-default user, this breaks. Fix: align the image and access point.
- **`PGDATA` env var path drift.** Set to `/var/lib/postgresql/data/pgdata` to keep PG happy with EFS root having `lost+found`. Verify in [06b](./06b-application.md).

---

## Health monitoring

`/api/health` returns 200 unconditionally with a JSON body:

```json
{ "ok": true|false, "queueDepth": N, "oldestPendingAgeSec": N, "errorsLast24h": N }
```

ALB target group health check uses this. CloudWatch alarm setup (recommended, optional):

```hcl
resource "aws_cloudwatch_metric_alarm" "task_unhealthy" {
  alarm_name          = "enhanced-review-task-unhealthy"
  metric_name         = "UnHealthyHostCount"
  namespace           = "AWS/ApplicationELB"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 5    # 5 minutes
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  dimensions = {
    LoadBalancer = aws_lb.main.arn_suffix
    TargetGroup  = aws_lb_target_group.web.arn_suffix
  }
  alarm_actions = [aws_sns_topic.alarms.arn]
}
```

Plus an SNS topic with an email subscription to your address. SNS email is free up to 1k/mo.

For "is the queue stuck?" — ingest `oldestPendingAgeSec` from `/api/health` into CloudWatch as a custom metric. Out of scope for the POC; flagged for [11](./11-proposal-lightweight-infra.md).

---

## Concurrent-user / scaling notes

This pattern is designed for **1-2 concurrent users** and **1-2 concurrent reviews**. Beyond that, the bottlenecks (in order) are:

1. **Single Fargate task.** No HA. AZ failure = ~5 min downtime.
2. **In-process job runner.** A single task can run `MAX_JOBS_PER_USER` concurrent jobs per user, but they all share the task's CPU/memory. Default 1 is sane.
3. **Postgres on EFS.** Fine to ~50 connections, ~100 writes/s. EBS would be ~10x faster.
4. **One ALB target.** Scaling out the service requires splitting Postgres into a separate task/service, which is the next architectural step.

Doc [12](./12-proposal-software-stack.md) captures the migration paths for each of these.

---

## Cognito user creation (one-time)

Done out of band so the password isn't in Terraform state:

```sh
aws cognito-idp admin-create-user \
  --user-pool-id <pool-id> \
  --username steven@example.com \
  --user-attributes Name=email,Value=steven@example.com Name=email_verified,Value=true \
  --message-action SUPPRESS \
  --temporary-password 'TempPasswordHere!'
```

First login: Cognito requires you to set a permanent password. Use the hosted UI (it'll prompt).

To rotate your own password later: from the hosted UI, "Forgot password" flow works (email Cognito sends).

---

## Common ops commands cheat sheet

```sh
# Get current task ARN
aws ecs list-tasks --cluster platform-cluster --service-name enhanced-review --query 'taskArns[0]' --output text

# Exec into web container
aws ecs execute-command --cluster platform-cluster --task <arn> --container web --interactive --command "/bin/sh"

# Exec into postgres container
aws ecs execute-command --cluster platform-cluster --task <arn> --container postgres --interactive --command "psql -U app -d enhanced_review"

# Tail logs
aws logs tail /ecs/enhanced-review --follow

# Force redeploy
aws ecs update-service --cluster platform-cluster --service enhanced-review --force-new-deployment

# Pause (scale to 0)
aws ecs update-service --cluster platform-cluster --service enhanced-review --desired-count 0

# Resume
aws ecs update-service --cluster platform-cluster --service enhanced-review --desired-count 1

# Inspect Cognito users
aws cognito-idp list-users --user-pool-id <pool-id>

# Manually rotate a secret
aws secretsmanager put-secret-value --secret-id enhanced-review/<name> --secret-string '...'
```

Add to your shell aliases or to a `Makefile` for ergonomics.
