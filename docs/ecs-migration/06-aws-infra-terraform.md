# 06 — AWS infrastructure via Terraform

The largest doc. Defines every AWS resource the deployed system uses, organized as a single Terraform root module. Covers VPC, ECS, EFS, ALB, Cognito, Route53, ACM, Secrets Manager, IAM, OIDC, and the deliberate cost trade-offs (especially around NAT Gateway).

This is Phase C. By this point Phases A and B are complete: the app runs locally as a single docker-compose'd Next.js + Postgres stack.

---

## Decisions feeding into this doc

- **D5** ECS Fargate, single task, two containers (web + postgres sidecar)
- **D6** EFS volume for Postgres data
- **D7** ALB + Cognito for "only me" access
- **D8** Registered domain in Route53 + ACM cert
- **D9** Secrets Manager for credentials
- **D10** GitHub OIDC federation for deploy
- **D11** Public subnet for the Fargate task — drops the NAT Gateway

---

## Architecture (as deployed)

```
                                 ┌──────────────────┐
                                 │   Route 53       │
                                 │  yourdomain.com  │
                                 └────────┬─────────┘
                                          │ ALIAS
                                          ▼
                ┌─────────────────────────────────────┐
                │  Application Load Balancer (HTTPS)  │
                │  - ACM cert (DNS-validated)         │
                │  - Cognito auth action on listener  │
                │  - SG: 0.0.0.0/0 :443               │
                └────────────────┬────────────────────┘
                                 │
                                 ▼
                ┌─────────────────────────────────────┐
                │   ECS Fargate task (1)              │
                │   ┌──────────┐  ┌──────────┐        │
                │   │ web      │  │ postgres │        │
                │   │ :3000    │  │ :5432    │        │
                │   └──────────┘  └──────────┘        │
                │   Public subnet, public IP          │
                │   SG: ingress 3000 from ALB-SG only │
                │   EFS volume mounted on postgres    │
                └─────────────────────────────────────┘
                                 │
                                 ▼
              ┌──────────────────────────────────────┐
              │   EFS file system + access point     │
              │   /var/lib/postgresql/data           │
              └──────────────────────────────────────┘

   Cognito user pool (1 user) ←── ALB authenticate-cognito action
   Secrets Manager (5 secrets) ──→ ECS task definition `secrets`
   ECR (private)               ──→ ECS task definition `image`
   CloudWatch Logs (7d ret.)   ←── awslogs driver
```

---

## Terraform layout

Single root module to keep the surface small. Files at `terraform/` in repo root:

```
terraform/
  versions.tf            # required_providers + backend
  variables.tf           # all inputs
  outputs.tf             # ALB DNS, Cognito hosted UI URL, ECR repo URI, etc.
  vpc.tf                 # VPC, subnets, route table, IGW
  ecr.tf                 # private ECR repository
  ecs.tf                 # cluster, task def, service
  efs.tf                 # FS, mount target, access point
  alb.tf                 # ALB, target group, listener with Cognito auth
  cognito.tf             # user pool, app client, hosted UI domain
  route53.tf             # zone + ALIAS record + ACM cert + DNS validation
  secrets.tf             # Secrets Manager entries (values supplied via tfvars or admin tooling)
  iam.tf                 # task execution role, task role, GitHub OIDC role
  cloudwatch.tf          # log group
  README.md              # how to bootstrap and apply
```

> Why one big root module instead of separate modules? Cost-of-abstraction. The whole stack is ~250 lines of HCL; splitting it adds ceremony without benefit. If we ever templatize for multiple apps (the proposal in [11](./11-proposal-lightweight-infra.md)), *that's* the point to extract a module.

### State backend (chicken-and-egg)

State lives in S3 + DynamoDB lock. Created once via a tiny bootstrap script outside Terraform, because Terraform can't manage its own state backend.

`terraform/bootstrap.sh`:

```sh
#!/bin/sh
set -e
REGION=${AWS_REGION:-us-east-1}
BUCKET="enhanced-review-tfstate"
TABLE="enhanced-review-tflock"

aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" --create-bucket-configuration LocationConstraint="$REGION" || true
aws s3api put-bucket-versioning --bucket "$BUCKET" --versioning-configuration Status=Enabled
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

aws dynamodb create-table --table-name "$TABLE" \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region "$REGION" || true
```

Run once. After that, `terraform { backend "s3" { ... } }` works.

---

## VPC and networking — the cost-driving decision

### Default plan: public subnet, no NAT Gateway

```hcl
# vpc.tf (sketch)
resource "aws_vpc" "main" { cidr_block = "10.0.0.0/16" }

resource "aws_subnet" "public_a" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "us-east-1a"
  map_public_ip_on_launch = true
}

resource "aws_subnet" "public_b" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.2.0/24"
  availability_zone       = "us-east-1b"
  map_public_ip_on_launch = true
}

resource "aws_internet_gateway" "main" { vpc_id = aws_vpc.main.id }

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route { cidr_block = "0.0.0.0/0"  gateway_id = aws_internet_gateway.main.id }
}

resource "aws_route_table_association" "public_a" { subnet_id = aws_subnet.public_a.id  route_table_id = aws_route_table.public.id }
resource "aws_route_table_association" "public_b" { subnet_id = aws_subnet.public_b.id  route_table_id = aws_route_table.public.id }
```

ALB requires two AZs for the target group (it's a hard ALB requirement, even if you only run one task). We satisfy this with two public subnets in two AZs. The ECS service can place the task in either subnet — the ALB cross-zone load balances.

**The Fargate task gets a public IP** and reaches the internet directly through the IGW. No NAT Gateway. The task SG locks ingress to "from the ALB SG only on port 3000" so the public IP isn't actually reachable from the world. Postgres on `localhost:5432` is never exposed because it's a sidecar in the same task ENI.

### Why not a private subnet + NAT?

Private subnet + NAT Gateway is the usual "production-correct" pattern. For us:

| Aspect          | Public subnet (default)                          | Private + NAT                                       |
| --------------- | ------------------------------------------------ | --------------------------------------------------- |
| Monthly cost    | ~$0 in extra networking                          | ~$32/mo NAT Gateway + per-GB egress                 |
| Egress IP       | Task ENI's public IP (changes per task)          | NAT EIP (stable, allowlist-friendly)                |
| Inbound surface | Task has a public IP (locked by SG)              | Task has only private IP                            |
| Operational     | Slightly less "production correct"               | Standard pattern                                    |

For a personal POC where the task has nothing public-listening *except* through the ALB, the public-subnet pattern is acceptable and saves the bill from ballooning. Doc [09](./09-cost-and-operations.md) has the cost breakdown; doc [11](./11-proposal-lightweight-infra.md) frames this for SREs as a "POC pattern" with the upgrade path.

---

## ECS cluster, task definition, service

### Cluster

```hcl
resource "aws_ecs_cluster" "main" { name = "enhanced-review" }
resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE"]
}
```

### Task definition

Two containers (`web`, `postgres`), one shared task ENI, one EFS volume mounted into postgres.

```hcl
resource "aws_ecs_task_definition" "app" {
  family                   = "enhanced-review"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"     # 0.5 vCPU
  memory                   = "1024"    # 1 GB
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  volume {
    name = "pgdata"
    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.pgdata.id
      transit_encryption = "ENABLED"
      authorization_config {
        access_point_id = aws_efs_access_point.pgdata.id
        iam             = "ENABLED"
      }
    }
  }

  container_definitions = jsonencode([
    {
      name      = "web"
      image     = "${aws_ecr_repository.app.repository_url}:latest"
      essential = true
      portMappings = [{ containerPort = 3000, protocol = "tcp" }]
      environment = [
        { name = "DATABASE_URL", value = "postgres://app:$${POSTGRES_PASSWORD}@127.0.0.1:5432/enhanced_review" },
        { name = "AUTH_TRUST_HOST", value = "true" },
        { name = "AUTH_URL", value = "https://${var.domain_name}" },
        { name = "REVIEW_EXECUTOR", value = "claude" },
        { name = "REVIEW_MODEL", value = "claude-haiku-4-5" },
        { name = "REVIEW_TIMEOUT_MIN", value = "15" },
        { name = "MAX_JOBS_PER_USER", value = "1" },
        { name = "LOG_LEVEL", value = "info" },
      ]
      secrets = [
        { name = "AUTH_SECRET",         valueFrom = aws_secretsmanager_secret.auth_secret.arn },
        { name = "AUTH_GITHUB_ID",      valueFrom = aws_secretsmanager_secret.github_id.arn },
        { name = "AUTH_GITHUB_SECRET",  valueFrom = aws_secretsmanager_secret.github_secret.arn },
        { name = "ANTHROPIC_API_KEY",   valueFrom = aws_secretsmanager_secret.anthropic_key.arn },
        { name = "POSTGRES_PASSWORD",   valueFrom = aws_secretsmanager_secret.postgres_password.arn },
      ]
      dependsOn = [{ containerName = "postgres", condition = "HEALTHY" }]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.app.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "web"
        }
      }
      healthCheck = {
        command  = ["CMD-SHELL", "wget -q -O- http://localhost:3000/api/health || exit 1"]
        interval = 30, timeout = 5, retries = 3, startPeriod = 60
      }
    },
    {
      name      = "postgres"
      image     = "postgres:17-alpine"
      essential = true
      environment = [
        { name = "POSTGRES_DB",   value = "enhanced_review" },
        { name = "POSTGRES_USER", value = "app" },
        { name = "PGDATA",        value = "/var/lib/postgresql/data/pgdata" },
      ]
      secrets = [
        { name = "POSTGRES_PASSWORD", valueFrom = aws_secretsmanager_secret.postgres_password.arn },
      ]
      mountPoints = [{ sourceVolume = "pgdata", containerPath = "/var/lib/postgresql/data" }]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.app.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "postgres"
        }
      }
      healthCheck = {
        command  = ["CMD-SHELL", "pg_isready -U app -d enhanced_review || exit 1"]
        interval = 10, timeout = 3, retries = 5, startPeriod = 30
      }
    },
  ])
}
```

### Service

```hcl
resource "aws_ecs_service" "app" {
  name            = "enhanced-review"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = [aws_subnet.public_a.id, aws_subnet.public_b.id]
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = true   # required because public subnet, no NAT
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3000
  }

  deployment_circuit_breaker { enable = true rollback = true }
  enable_execute_command = true   # so we can `aws ecs execute-command` for ops
  depends_on = [aws_lb_listener.https]
}
```

### Trade-offs called out

- **`essential = true` on both containers.** If postgres dies, the whole task restarts. Required, since the web container can't survive losing its DB.
- **Web depends on postgres being HEALTHY** before it boots. ECS handles the ordering. Postgres healthcheck is `pg_isready` against the local socket.
- **Single-AZ in practice.** Two subnets (ALB requirement) but only one task. If the AZ hosting the task fails, the service tries to start a new task in the other AZ, but EFS mount targets must exist in both AZs (they do — see EFS section). Brief downtime acceptable for a POC.
- **`enable_execute_command = true`.** Lets us `aws ecs execute-command` into either container to run psql, check logs, manually fix things. See [09](./09-cost-and-operations.md).

---

## EFS

```hcl
resource "aws_efs_file_system" "pgdata" {
  creation_token = "enhanced-review-pgdata"
  encrypted      = true
  performance_mode = "generalPurpose"  # default; "maxIO" is for >1000 ops/s, overkill
  throughput_mode = "bursting"          # default; switch to "elastic" if Postgres feels slow
}

resource "aws_efs_mount_target" "a" { file_system_id = aws_efs_file_system.pgdata.id  subnet_id = aws_subnet.public_a.id  security_groups = [aws_security_group.efs.id] }
resource "aws_efs_mount_target" "b" { file_system_id = aws_efs_file_system.pgdata.id  subnet_id = aws_subnet.public_b.id  security_groups = [aws_security_group.efs.id] }

resource "aws_efs_access_point" "pgdata" {
  file_system_id = aws_efs_file_system.pgdata.id
  posix_user { uid = 999  gid = 999 }   # postgres image's uid/gid
  root_directory {
    path = "/pgdata"
    creation_info { owner_uid = 999  owner_gid = 999  permissions = "0700" }
  }
}
```

The mount targets in both AZs let either subnet's task mount the same FS. The access point pins ownership to UID 999 (the `postgres` user inside the postgres image) so the container starts cleanly.

EFS SG: ingress NFS (port 2049) only from the task SG.

> **Why EFS and not EBS?** EBS volumes attach to EC2 instances, not Fargate tasks. Fargate's only native persistent option is EFS. The trade-off is lower IOPS (~10ms p99 vs <1ms on EBS), but for a POC's traffic this is invisible.

---

## ALB

```hcl
resource "aws_lb" "main" {
  name               = "enhanced-review"
  load_balancer_type = "application"
  subnets            = [aws_subnet.public_a.id, aws_subnet.public_b.id]
  security_groups    = [aws_security_group.alb.id]
  idle_timeout       = 120  # match SSE heartbeat
}

resource "aws_lb_target_group" "web" {
  name        = "enhanced-review-web"
  port        = 3000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id
  health_check {
    path                = "/api/health"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
    matcher             = "200"
  }
  deregistration_delay = 30
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  certificate_arn   = aws_acm_certificate_validation.cert.certificate_arn
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"

  default_action {
    type = "authenticate-cognito"
    authenticate_cognito {
      user_pool_arn       = aws_cognito_user_pool.main.arn
      user_pool_client_id = aws_cognito_user_pool_client.alb.id
      user_pool_domain    = aws_cognito_user_pool_domain.main.domain
      session_timeout     = 86400 * 7  # 1 week
    }
    order = 1
  }

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
    order            = 2
  }
}

resource "aws_lb_listener" "http_redirect" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect { port = "443" protocol = "HTTPS" status_code = "HTTP_301" }
  }
}
```

Notes:

- **Cognito auth on the listener default action** — every request must pass Cognito before reaching the task. Even `/api/health` (we may want to exempt this; see Open questions).
- **`idle_timeout = 120`** — SSE heartbeats are 15s, so we have headroom. The default 60s is fine but tight.
- **TLS 1.3 policy** — modern, broadly compatible. Cert via ACM (DNS-validated against Route53).
- **`/api/health` matcher = 200** — the route always returns 200 even on partial failures (by design). Health-check still works.

---

## Cognito

```hcl
resource "aws_cognito_user_pool" "main" {
  name = "enhanced-review"
  password_policy {
    minimum_length    = 12
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
    require_symbols   = false
  }
  mfa_configuration = "OPTIONAL"
}

resource "aws_cognito_user_pool_domain" "main" {
  domain       = "enhanced-review-${random_id.cog_suffix.hex}"  # unique on cognito-amzn
  user_pool_id = aws_cognito_user_pool.main.id
}

resource "aws_cognito_user_pool_client" "alb" {
  name                                 = "alb"
  user_pool_id                         = aws_cognito_user_pool.main.id
  generate_secret                      = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["email", "openid", "profile"]
  callback_urls                        = ["https://${var.domain_name}/oauth2/idpresponse"]
  supported_identity_providers         = ["COGNITO"]
}

# One user, created out-of-band (admin tooling) so the password isn't in TF state.
```

The single user is created via `aws cognito-idp admin-create-user --username steven@example.com --user-pool-id ...` outside Terraform, with `--message-action SUPPRESS` and a temporary password the user resets on first login. Documented in [09](./09-cost-and-operations.md).

> **Why no custom Cognito domain?** The Cognito-managed subdomain (`enhanced-review-abc.auth.us-east-1.amazoncognito.com`) is free and works out of the box. A custom domain on Cognito requires its own ACM cert and an extra zone record. Saved for later if anyone cares; the user doesn't see this URL after the first login (Cognito redirects fast).

---

## Route53 + ACM

```hcl
resource "aws_route53_zone" "main" { name = var.domain_name }

resource "aws_acm_certificate" "main" {
  domain_name       = var.domain_name
  validation_method = "DNS"
}

resource "aws_route53_record" "cert_validation" {
  for_each = { for dvo in aws_acm_certificate.main.domain_validation_options : dvo.domain_name => dvo }
  zone_id  = aws_route53_zone.main.id
  name     = each.value.resource_record_name
  type     = each.value.resource_record_type
  records  = [each.value.resource_record_value]
  ttl      = 60
}

resource "aws_acm_certificate_validation" "cert" {
  certificate_arn         = aws_acm_certificate.main.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

resource "aws_route53_record" "alb_alias" {
  zone_id = aws_route53_zone.main.id
  name    = var.domain_name
  type    = "A"
  alias { name = aws_lb.main.dns_name  zone_id = aws_lb.main.zone_id  evaluate_target_health = true }
}
```

Route53 hosted zone is ~$0.50/mo. ACM cert is free.

> The domain itself must be **registered** somewhere — ideally Route53 ($12-15/yr for `.com`, $5/yr for `.dev`, etc.). If you register through a different registrar (Namecheap, Google Domains migration target, etc.), update its NS records to point at the Route53 zone's NS records.

---

## Secrets Manager

Five secrets, plus the bootstrap convention:

```hcl
resource "aws_secretsmanager_secret" "auth_secret"      { name = "enhanced-review/auth-secret" }
resource "aws_secretsmanager_secret" "github_id"        { name = "enhanced-review/github-id" }
resource "aws_secretsmanager_secret" "github_secret"    { name = "enhanced-review/github-secret" }
resource "aws_secretsmanager_secret" "anthropic_key"    { name = "enhanced-review/anthropic-key" }
resource "aws_secretsmanager_secret" "postgres_password"{ name = "enhanced-review/postgres-password" }
```

Values are populated **out-of-band**, not via Terraform (so secrets never enter `terraform.tfstate`):

```sh
aws secretsmanager put-secret-value --secret-id enhanced-review/auth-secret --secret-string "$(openssl rand -base64 32)"
aws secretsmanager put-secret-value --secret-id enhanced-review/github-id --secret-string "<GitHub OAuth App client ID>"
# etc.
```

Documented as a one-time bootstrap step in [09](./09-cost-and-operations.md).

> The Postgres password must remain stable across deploys — changing it would require a manual data fixup since it's hashed in the Postgres data dir on EFS. Rotate carefully (with downtime).

---

## IAM

Three roles:

### Task execution role

What ECS itself needs to start the container: pull from ECR, fetch secrets, write logs.

```hcl
resource "aws_iam_role" "task_execution" { ... assume_role_policy: ecs-tasks.amazonaws.com ... }
resource "aws_iam_role_policy_attachment" "task_execution_basic" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}
resource "aws_iam_role_policy" "task_execution_secrets" {
  role   = aws_iam_role.task_execution.id
  policy = data.aws_iam_policy_document.read_secrets.json   # secretsmanager:GetSecretValue on the 5 ARNs
}
```

### Task role

What the running app can do at AWS APIs. **For this app: nothing.** The app only talks to GitHub + Anthropic + its own sidecar Postgres. Empty role for now; deliberate.

```hcl
resource "aws_iam_role" "task" { ... assume_role_policy: ecs-tasks.amazonaws.com ... }
# No inline policies, no attachments.
```

If we later add S3 backups, expand here.

### GitHub OIDC deploy role

Lets GitHub Actions assume an IAM role without storing AWS keys.

```hcl
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]  # GitHub's well-known thumbprint
}

resource "aws_iam_role" "github_deploy" {
  name = "enhanced-review-github-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_oidc_trust.json
}

# Trust policy: only assumed by the specific repo + branch.
data "aws_iam_policy_document" "github_oidc_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals { type = "Federated" identifiers = [aws_iam_openid_connect_provider.github.arn] }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:steven/enhanced-review:ref:refs/heads/main", "repo:steven/enhanced-review:pull_request"]
    }
  }
}
```

Permissions on the deploy role are scoped:

- **ECR push:** `ecr:GetAuthorizationToken`, `ecr:BatchCheckLayerAvailability`, `ecr:PutImage`, etc., on the `enhanced-review` repository ARN only.
- **ECS update:** `ecs:RegisterTaskDefinition`, `ecs:UpdateService`, `ecs:DescribeServices`, `iam:PassRole` (for the task roles) — scoped to this cluster/service.
- **Terraform apply (separate role):** broader perms, scoped to the resources we manage. Documented in [08](./08-cd-infra.md).

Two separate roles for image deploy vs infra deploy — different blast radii. See [07](./07-cd-image.md) and [08](./08-cd-infra.md).

---

## Security groups

```hcl
# ALB SG: 443 from world, 80 from world (for redirect).
resource "aws_security_group" "alb" {
  vpc_id = aws_vpc.main.id
  ingress { from_port = 443  to_port = 443  protocol = "tcp"  cidr_blocks = ["0.0.0.0/0"] }
  ingress { from_port = 80   to_port = 80   protocol = "tcp"  cidr_blocks = ["0.0.0.0/0"] }
  egress  { from_port = 0    to_port = 0    protocol = "-1"   cidr_blocks = ["0.0.0.0/0"] }
}

# Task SG: 3000 from ALB SG only. Egress open (GitHub, Anthropic, ECR).
resource "aws_security_group" "task" {
  vpc_id = aws_vpc.main.id
  ingress { from_port = 3000  to_port = 3000  protocol = "tcp"  security_groups = [aws_security_group.alb.id] }
  egress  { from_port = 0     to_port = 0     protocol = "-1"   cidr_blocks = ["0.0.0.0/0"] }
}

# EFS SG: 2049 from task SG only.
resource "aws_security_group" "efs" {
  vpc_id = aws_vpc.main.id
  ingress { from_port = 2049  to_port = 2049  protocol = "tcp"  security_groups = [aws_security_group.task.id] }
}
```

Three SGs, three layers. Even though the task has a public IP, port 3000 is only reachable from the ALB SG. Postgres on `localhost:5432` is never reachable externally because it's a sidecar — port 5432 isn't even exposed in the task's network namespace to the outside.

---

## CloudWatch logs

```hcl
resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/enhanced-review"
  retention_in_days = 7
}
```

Both containers stream to this group, distinguished by `awslogs-stream-prefix`. 7-day retention is plenty for a POC.

---

## ECR

```hcl
resource "aws_ecr_repository" "app" {
  name                 = "enhanced-review"
  image_tag_mutability = "MUTABLE"  # we tag :latest mutably; :sha-abc immutably by convention
  image_scanning_configuration { scan_on_push = true }
  encryption_configuration { encryption_type = "AES256" }
}

resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 sha-tagged images"
      selection    = { tagStatus = "tagged"  tagPrefixList = ["sha-"]  countType = "imageCountMoreThan"  countNumber = 10 }
      action       = { type = "expire" }
    }]
  })
}
```

Lifecycle policy keeps the 10 most recent SHA-tagged images, prunes the rest. Saves ECR storage cost (~$0.10/GB/mo, but accumulates).

---

## Open questions to resolve during execution

- **Cognito exemption for `/api/health`.** Today the listener default action is `authenticate-cognito + forward`. ALB target group health check uses `/api/health`. The ALB-to-target health check bypasses the Cognito step (it's the ALB hitting the target directly, not a user request), so this works. But if we want to expose `/api/health` to external monitoring (UptimeRobot etc.), we need a listener rule that bypasses Cognito for that path. Decide at execute time.
- **Public IP rotation.** Each task restart gets a new public IP. If GitHub gets twitchy about new IPs cloning rapidly (it doesn't, we tested similar patterns), we'd need NAT after all. Flag in [09](./09-cost-and-operations.md).
- **EFS throughput mode.** Start with `bursting`. If Postgres feels slow, switch to `elastic` (~$0.03/GB-month for committed throughput). Easy change.
- **ECS Service Connect.** Not needed because two containers in one task share `localhost`. Mentioning so future-you knows we considered it.

---

## Verification

Phase C success:

1. `cd terraform && ./bootstrap.sh` (one-time) → `terraform init` → `terraform apply` succeeds.
2. Domain resolves; `https://yourdomain.com` redirects to Cognito hosted UI.
3. Log into Cognito → forwarded to the app → GitHub OAuth → land on the home page.
4. Run a real review (`REVIEW_EXECUTOR=claude`); chunks stream live; final review renders.
5. `aws ecs execute-command --cluster enhanced-review --task <task-id> --container postgres --interactive --command "psql -U app -d enhanced_review"` works; can query rows.
6. CloudWatch log group has interleaved `web` and `postgres` streams.
7. Task restart (`aws ecs update-service --force-new-deployment`) survives — Postgres data persists on EFS.
8. Cost dashboard (Billing console) after 24h shows ~$1-2 (will extrapolate to ~$30-40/mo).
