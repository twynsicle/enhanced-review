# Phase C — AWS infrastructure via Terraform — execution plan

**Status:** ready to execute. **Companion to:** [06a-platform.md](./06a-platform.md) and [06b-application.md](./06b-application.md) (design references — split out of the original doc 06 in this plan's commit 9) and [00-overview.md](./00-overview.md) (phase map).

This file is the ordered task list for Phase C: produce a working AWS deployment of `enhanced-review` with the `terraform/` directory under source control. By the end, two `terraform apply` invocations (one platform, one app) bring up VPC + ECS cluster + ALB + Cognito + Route 53 + ACM + ECR + GitHub OIDC + an ECS service running a placeholder image, gated by Cognito at `https://enhanced-review.{domain_name}`.

Phase C ends at **infra-only** verification — placeholder image responds 200 behind Cognito. Real GitHub OAuth login + real reviews are Phase D's first image deploy.

If anything here disagrees with [06a](./06a-platform.md) / [06b](./06b-application.md), the plan wins (the design docs were split out of doc 06 in commit 9 of this plan).

---

## Goal

A maintainer can:

1. Run `terraform/bootstrap.sh` once to create the S3 state bucket + DynamoDB lock table.
2. `cd terraform/platform && terraform init && terraform apply -var="domain_name=…"` succeeds and produces an ALB, Cognito user pool, Route 53 zone, wildcard ACM cert, ECS cluster, ECR repository, GitHub OIDC provider.
3. After updating their domain registrar's NS records to point at the Route 53 zone (and waiting for DNS propagation + ACM validation), `cd terraform/apps/enhanced-review && terraform init && terraform apply` succeeds and produces an ECS service running a placeholder web container + real Postgres sidecar, an ALB listener rule, a Cognito user pool client, and a Route 53 alias record.
4. After creating a Cognito user out-of-band and signing in via the hosted UI, `https://enhanced-review.{domain_name}` returns a 200 from the `hashicorp/http-echo` placeholder.

Nothing about the application code changes in Phase C. The repo grows a `terraform/` directory; that's it.

---

## Architectural shape — why two modules, not one

Doc 06 originally described a single root module. During planning we split it into a **platform** module (one apply per AWS account, owns shared infra) and an **application** module (one apply per app, owns app-specific resources). Reasoning:

- **Cost amortization.** ALB (~$18/mo) is the biggest fixed line item and amortizes across every app sharing it.
- **Matches the doc 11 vision.** The "lightweight infra pattern" proposal already framed this as the multi-tenant generalization. Adopting it now means doc 11 describes what we built, not what we'd build later.
- **Resolves the ECR↔ECS chicken-and-egg.** Platform creates ECR before the app's ECS service ever tries to pull. App's first apply uses a public placeholder image; Phase D pushes the real image to ECR.
- **Smaller blast radius.** App-only changes never touch shared platform infra.

### Resource allocation

| Layer       | Resources                                                                                                                                                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Platform** | VPC + 2 public subnets + IGW + route table; ECS cluster; ALB + HTTPS listener (default 404 fixed-response) + ALB SG; Cognito **user pool** + hosted UI domain; Route 53 hosted zone; wildcard ACM cert (`*.{domain}` + apex SAN); GitHub OIDC provider; per-app ECR repositories |
| **Application** | ECS task definition + service; EFS file system + access point + EFS SG; ALB target group + listener rule (host header + `authenticate-cognito` action); Cognito user pool **client**; Route 53 ALIAS record; Secrets Manager entries; task SG; task execution / task / GitHub-deploy IAM roles; CloudWatch log group |

### Boundary cost

The "second app" doesn't exist yet. We're designing the platform interface against a single use case — risk of getting it wrong because there's no second consumer to test against. Mitigation: keep platform outputs minimal (only what `enhanced-review` actually consumes) and let a future app's needs grow them.

---

## Decisions made during planning

These were chosen on 2026-05-09 when the plan was drafted. Doc 06 will be edited in-place (split into 06a/06b) in commit 9 to match.

| #   | Topic                                  | Decision                                                                                                                                       | Rationale                                                                                                                                                                                                                                                              |
| --- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Region                                 | `us-west-2`                                                                                                                                    | User preference. Doc 06's default of `us-east-1` is updated throughout. ECR pricing identical; egress to Anthropic / GitHub roughly equal.                                                                                                                             |
| C2  | Module layout                          | Two root modules: `terraform/platform/` and `terraform/apps/enhanced-review/`                                                                  | Cost amortization + matches doc 11. See "Architectural shape" above.                                                                                                                                                                                                   |
| C3  | State files                            | Two state files — `s3://<bucket>/platform/terraform.tfstate` and `s3://<bucket>/apps/enhanced-review/terraform.tfstate`                        | Clean blast-radius separation. App reads platform via `terraform_remote_state` data source.                                                                                                                                                                            |
| C4  | ECR ownership                          | Platform module declares one `aws_ecr_repository` per registered app                                                                           | Resolves ECR↔ECS chicken-and-egg cleanly: ECR exists before app's ECS service applies. Slight coupling: a new app requires a platform-side change, but that's also where the OIDC trust scoping lives anyway.                                                          |
| C5  | First image                            | Placeholder `hashicorp/http-echo:0.2.3` listening on `:3000`, returning 200 on every path. App's `var.web_image` defaults to it.               | Public image, ~5 MB, satisfies ALB target-group health check on `/api/health` without special config. Phase D's first real image push updates `var.web_image` to the ECR URI + SHA tag.                                                                                |
| C6  | Postgres in placeholder task           | Yes — full task definition from day one (web=placeholder + postgres=`postgres:17-alpine` with EFS mount). Requires populating `postgres-password` secret before app applies. | Exercises EFS, secrets injection, dependsOn ordering, and postgres healthcheck during Phase C. Phase D's image swap changes only `var.web_image`. Avoids "first real deploy is also first real test of postgres sidecar".                                              |
| C7  | App URL pattern                        | Subdomain `enhanced-review.{domain_name}`                                                                                                      | Wildcard cert covers it; pattern scales for future apps. Apex left free for a later landing page.                                                                                                                                                                      |
| C8  | Domain                                 | `var.domain_name` is a required tfvars input; user supplies before platform's first apply. Domain itself can be Route 53–registered or external (NS-delegated). | User wants to defer domain choice. Plan stays domain-agnostic. **Manual step**: register or NS-delegate before commit 4's apply finishes.                                                                                                                              |
| C9  | Phase C end state                      | Infra-only — placeholder responds 200 behind Cognito. Real OAuth + reviews are Phase D.                                                       | Keeps Phase C scoped. Phase D's first image push is the natural place to verify GitHub OAuth, real review streaming, and final narrative rendering.                                                                                                                    |
| C10 | Doc 06 strategy                        | Split into `06a-platform.md` + `06b-application.md` in commit 9 of this plan                                                                   | Matches doc 11's framing (platform team owns the platform module; app team owns the app module).                                                                                                                                                                       |
| C11 | Plan format                            | This file (`phase-c-plan.md`) — same shape as `phase-b-plan.md`                                                                                | Phase B pattern proven; reuse it.                                                                                                                                                                                                                                      |
| C12 | Platform name prefix                   | `platform-` for shared resources (e.g. `platform-vpc`, `platform-alb`, `platform-cluster`)                                                     | Generic. Reads naturally even if more apps adopt the pattern.                                                                                                                                                                                                          |
| C13 | GitHub repo for OIDC trust             | `twynsicle/enhanced-review`                                                                                                                    | Doc 06's `steven/enhanced-review` was a placeholder; updated.                                                                                                                                                                                                          |
| C14 | Prod GitHub OAuth App                  | Deferred to Phase D                                                                                                                            | Phase C verification ends at Cognito-gated placeholder. Phase D adds OAuth + first real review. App secrets `auth-github-id` / `auth-github-secret` are created but stay empty during Phase C.                                                                          |
| C15 | `/api/health` Cognito exemption        | Not needed                                                                                                                                     | ALB target-group health checks are internal (ALB → target IP), don't traverse the listener's `authenticate-cognito` action. External monitoring (UptimeRobot etc.) is out of scope per doc 06.                                                                          |
| C16 | Listener default action                | `fixed-response 404`                                                                                                                           | Per-app listener rules carry their own `authenticate-cognito + forward` actions. Default fires when no host header matches a registered app.                                                                                                                           |
| C17 | State bucket naming                    | `enhanced-review-tfstate-${ACCOUNT_ID}` (account ID supplied by `bootstrap.sh` from `aws sts get-caller-identity`)                              | Globally unique by construction. Avoids the doc 06 default name colliding in the global S3 namespace.                                                                                                                                                                  |
| C18 | DynamoDB lock table                    | `enhanced-review-tflock` (one table, both modules use the same `LockID` partition because keys differ)                                        | Single table is fine since key paths in the same bucket are distinct.                                                                                                                                                                                                  |

---

## Pre-flight (current state of the branch)

Phase B is merged on `migrate-ecs`. The repo has:

- `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `scripts/entrypoint.sh`, `scripts/recover-jobs.cjs` — Phase B artifacts.
- `next.config.ts` with `output: 'standalone'`.
- `drizzle/migrate.mts` (compiled to `.mjs` at Docker build time).
- `.github/workflows/ci.yml` running format/lint/typecheck/test + a `docker-build` verification job.
- No `terraform/` directory yet.
- No AWS resources provisioned.

This pre-flight is the ground truth Phase C builds on. No application code changes are anticipated; only infra files and docs.

---

## Task sequence (one logical commit per heading)

Each section below describes one commit. They are ordered so that any prefix is independently green: every commit ends with a `terraform plan` (or `terraform apply` where AWS state changes) that succeeds with no errors. Several commits include **manual AWS steps** that the user runs once between commits.

### 1. Bootstrap script + repo scaffolding

**Files (new):**

- `terraform/bootstrap.sh`
- `terraform/platform/versions.tf` (backend stub + provider config)
- `terraform/platform/variables.tf` (placeholder, `region` only)
- `terraform/platform/outputs.tf` (empty placeholder)
- `terraform/apps/enhanced-review/versions.tf` (backend stub + provider config)
- `terraform/apps/enhanced-review/variables.tf`
- `terraform/apps/enhanced-review/outputs.tf` (empty placeholder)
- `terraform/apps/enhanced-review/data.tf` (`terraform_remote_state.platform` data source)
- `terraform/README.md` (one-page bootstrap walkthrough)

**`terraform/bootstrap.sh`** creates the state backend before any Terraform runs. Idempotent (`|| true` on existing-resource errors):

```sh
#!/bin/sh
set -eu

REGION="${AWS_REGION:-us-west-2}"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="enhanced-review-tfstate-${ACCOUNT_ID}"
TABLE="enhanced-review-tflock"

echo "[bootstrap] region=$REGION account=$ACCOUNT_ID bucket=$BUCKET table=$TABLE"

aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
  --create-bucket-configuration "LocationConstraint=$REGION" || true
aws s3api put-bucket-versioning --bucket "$BUCKET" \
  --versioning-configuration Status=Enabled
aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
aws s3api put-bucket-encryption --bucket "$BUCKET" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

aws dynamodb create-table --table-name "$TABLE" \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region "$REGION" || true

echo "[bootstrap] done. Use these in versions.tf:"
echo "    bucket         = \"$BUCKET\""
echo "    dynamodb_table = \"$TABLE\""
```

**`versions.tf` (both modules)** uses `-backend-config` flags at `terraform init` time so the bucket name (account-ID-suffixed) doesn't have to be hardcoded:

```hcl
terraform {
  required_version = ">= 1.7"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.70" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
  backend "s3" {
    # bucket, key, region, dynamodb_table, encrypt supplied via -backend-config flags
  }
}

provider "aws" {
  region = var.region
}
```

**`terraform/README.md`** documents the bring-up flow at a high level (one-page) and references this plan for the full ordering.

**Verify:**

- `bash terraform/bootstrap.sh` runs cleanly with valid AWS credentials. `aws s3 ls` shows the bucket; `aws dynamodb describe-table --table-name enhanced-review-tflock` works.
- Both modules' `terraform init` succeeds with the `-backend-config` flags (no resources defined yet, so no apply).
- `git grep -n "terraform/"` shows references in `README.md` / `AGENTS.md` are still planned for commit 9 (no premature mentions).

---

### 2. Platform: VPC + networking

**Files (new):**

- `terraform/platform/vpc.tf`

**Contents (sketch):**

```hcl
data "aws_availability_zones" "available" { state = "available" }

resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags = { Name = "platform-vpc" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "platform-igw" }
}

resource "aws_subnet" "public" {
  for_each                = toset(slice(data.aws_availability_zones.available.names, 0, 2))
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(aws_vpc.main.cidr_block, 8, index(data.aws_availability_zones.available.names, each.key) + 1)
  availability_zone       = each.key
  map_public_ip_on_launch = true
  tags                    = { Name = "platform-public-${each.key}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = { Name = "platform-public-rt" }
}

resource "aws_route_table_association" "public" {
  for_each       = aws_subnet.public
  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}
```

Outputs added in `outputs.tf`:

```hcl
output "vpc_id"            { value = aws_vpc.main.id }
output "public_subnet_ids" { value = [for s in aws_subnet.public : s.id] }
output "availability_zones" { value = keys(aws_subnet.public) }
```

**Why standalone:** networking is foundational and has no dependencies on cert / Cognito / cluster. `terraform apply` on this commit creates a working VPC; nothing else depends on outputs yet.

**Verify:**

- `terraform plan` shows VPC + 2 subnets + IGW + route table + 2 associations.
- `terraform apply` succeeds.
- `aws ec2 describe-vpcs --filters Name=tag:Name,Values=platform-vpc` shows the VPC.

---

### 3. Platform: ECS cluster + ECR + GitHub OIDC provider

**Files (new):**

- `terraform/platform/ecs-cluster.tf`
- `terraform/platform/ecr.tf`
- `terraform/platform/iam-oidc.tf`

**`ecs-cluster.tf`:**

```hcl
resource "aws_ecs_cluster" "main" {
  name = "platform-cluster"
  setting {
    name  = "containerInsights"
    value = "disabled"  # POC; flip to enabled if alarms become useful
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]
  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}
```

**`ecr.tf`** — one repo per registered app. Driven by `var.registered_apps`:

```hcl
variable "registered_apps" {
  description = "Apps that need ECR repositories. Adding a new app requires a platform-side commit."
  type        = list(string)
  default     = ["enhanced-review"]
}

resource "aws_ecr_repository" "app" {
  for_each             = toset(var.registered_apps)
  name                 = each.key
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration { scan_on_push = true }
  encryption_configuration { encryption_type = "AES256" }
}

resource "aws_ecr_lifecycle_policy" "app" {
  for_each   = aws_ecr_repository.app
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 sha-tagged images"
      selection    = { tagStatus = "tagged", tagPrefixList = ["sha-"], countType = "imageCountMoreThan", countNumber = 10 }
      action       = { type = "expire" }
    }]
  })
}
```

**`iam-oidc.tf`:**

```hcl
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}
```

Outputs added:

```hcl
output "ecs_cluster_id"   { value = aws_ecs_cluster.main.id }
output "ecs_cluster_name" { value = aws_ecs_cluster.main.name }
output "ecs_cluster_arn"  { value = aws_ecs_cluster.main.arn }
output "ecr_repository_urls" {
  value = { for k, v in aws_ecr_repository.app : k => v.repository_url }
}
output "ecr_repository_arns" {
  value = { for k, v in aws_ecr_repository.app : k => v.arn }
}
output "github_oidc_provider_arn" { value = aws_iam_openid_connect_provider.github.arn }
```

**Why grouped:** none of these need DNS / domain. They can land before the user has decided on / delegated their domain. Lets the user start populating ECR with images before the cert is even validated.

**Verify:**

- `terraform plan` is additive (cluster + ECR repo + lifecycle policy + OIDC provider).
- `terraform apply` succeeds.
- `aws ecr describe-repositories --repository-names enhanced-review` returns the URI.
- `aws ecs describe-clusters --clusters platform-cluster` shows ACTIVE.

---

### 4. Platform: Route 53 hosted zone (manual NS delegation step)

**Files (new):**

- `terraform/platform/route53.tf`
- `terraform/platform/variables.tf` (add `domain_name`)

**`route53.tf`:**

```hcl
variable "domain_name" {
  description = "Parent domain (e.g. example.com). Subdomain apps live under this."
  type        = string
}

resource "aws_route53_zone" "main" {
  name = var.domain_name
}
```

Outputs:

```hcl
output "route53_zone_id"      { value = aws_route53_zone.main.zone_id }
output "route53_name_servers" { value = aws_route53_zone.main.name_servers }
output "domain_name"          { value = var.domain_name }
```

**Why standalone (and why this is the manual-step pivot):** ACM cert validation in commit 5 requires the Route 53 zone to be authoritative for the domain. If the user's domain is registered through Route 53, AWS handles delegation automatically; if it's registered elsewhere (Namecheap, Google Domains, etc.), the user must update NS records at the registrar to point at this zone. That can take minutes to hours to propagate.

By landing this commit alone (not bundled with ACM), the apply produces the NS records as outputs immediately, and the user can update their registrar before the next commit's apply tries to validate the cert.

**Manual step (post-apply, before commit 5):**

```sh
terraform output route53_name_servers
# → ["ns-123.awsdns-12.com", "ns-456.awsdns-34.net", "ns-789.awsdns-56.org", "ns-1011.awsdns-78.co.uk"]
```

User logs into their domain registrar and replaces the existing NS records with these four. Then verifies propagation with `dig +short NS yourdomain.com` (or `nslookup -type=NS yourdomain.com`) until the AWS NS values appear.

If the domain is already in Route 53 (e.g. registered through `aws route53domains register-domain`), this step is a no-op.

**Verify:**

- `terraform apply` succeeds; `terraform output route53_name_servers` lists 4 NS records.
- `dig +short NS {domain_name}` returns the AWS NS values (after registrar update).
- `aws route53 list-hosted-zones-by-name --dns-name {domain_name}` shows the zone.

---

### 5. Platform: wildcard ACM cert + DNS validation

**Files (new):**

- `terraform/platform/acm.tf`

**`acm.tf`:**

```hcl
resource "aws_acm_certificate" "wildcard" {
  domain_name               = "*.${var.domain_name}"
  subject_alternative_names = [var.domain_name]
  validation_method         = "DNS"
  lifecycle { create_before_destroy = true }
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.wildcard.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }
  zone_id = aws_route53_zone.main.zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 60
  records = [each.value.record]
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "wildcard" {
  certificate_arn         = aws_acm_certificate.wildcard.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}
```

Output:

```hcl
output "acm_certificate_arn" { value = aws_acm_certificate_validation.wildcard.certificate_arn }
```

**Why standalone:** validation can take 5–30 minutes depending on DNS TTLs. Running this as its own apply means the user knows the previous commits are clean and the only thing they're waiting on is ACM. If validation hangs (typical cause: NS delegation not propagated), they can kill the apply and retry without re-running other resource graphs.

**Verify:**

- `terraform apply` runs to completion (may take up to 30 min on first apply).
- `aws acm list-certificates --region us-west-2` shows ISSUED status.
- `terraform output acm_certificate_arn` returns the validated cert ARN.

---

### 6. Platform: ALB + Cognito user pool

**Files (new):**

- `terraform/platform/alb.tf`
- `terraform/platform/cognito.tf`

**`alb.tf`:**

```hcl
resource "aws_security_group" "alb" {
  name        = "platform-alb"
  description = "ALB ingress"
  vpc_id      = aws_vpc.main.id
  ingress { from_port = 443  to_port = 443  protocol = "tcp"  cidr_blocks = ["0.0.0.0/0"] }
  ingress { from_port = 80   to_port = 80   protocol = "tcp"  cidr_blocks = ["0.0.0.0/0"] }
  egress  { from_port = 0    to_port = 0    protocol = "-1"   cidr_blocks = ["0.0.0.0/0"] }
}

resource "aws_lb" "main" {
  name               = "platform-alb"
  load_balancer_type = "application"
  subnets            = [for s in aws_subnet.public : s.id]
  security_groups    = [aws_security_group.alb.id]
  idle_timeout       = 120  # SSE heartbeats are 15s; default 60 is fine but tight
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  certificate_arn   = aws_acm_certificate_validation.wildcard.certificate_arn
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "platform-alb: no app matched"
      status_code  = "404"
    }
  }
}

resource "aws_lb_listener" "http_redirect" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect { port = "443"  protocol = "HTTPS"  status_code = "HTTP_301" }
  }
}
```

**`cognito.tf`:**

```hcl
resource "random_id" "cognito_suffix" { byte_length = 4 }

resource "aws_cognito_user_pool" "main" {
  name = "platform-users"
  password_policy {
    minimum_length    = 12
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
    require_symbols   = false
  }
  mfa_configuration = "OPTIONAL"
  software_token_mfa_configuration { enabled = true }
  account_recovery_setting {
    recovery_mechanism { name = "verified_email" priority = 1 }
  }
  auto_verified_attributes = ["email"]
}

resource "aws_cognito_user_pool_domain" "main" {
  domain       = "platform-${random_id.cognito_suffix.hex}"
  user_pool_id = aws_cognito_user_pool.main.id
}
```

Outputs:

```hcl
output "alb_arn"               { value = aws_lb.main.arn }
output "alb_dns_name"          { value = aws_lb.main.dns_name }
output "alb_zone_id"           { value = aws_lb.main.zone_id }
output "alb_listener_https_arn" { value = aws_lb_listener.https.arn }
output "alb_security_group_id" { value = aws_security_group.alb.id }
output "cognito_user_pool_id"  { value = aws_cognito_user_pool.main.id }
output "cognito_user_pool_arn" { value = aws_cognito_user_pool.main.arn }
output "cognito_user_pool_domain" { value = aws_cognito_user_pool_domain.main.domain }
```

**Why grouped:** ALB needs the validated cert; Cognito needs nothing else. Both are platform-scoped (the listener has a fixed-response 404 default; per-app rules + `authenticate-cognito` are application-scoped). Bundling lets a single apply complete the platform module.

**Verify:**

- `terraform apply` succeeds.
- `curl -kv https://{alb_dns_name}/` returns 404 (the fixed-response default).
- `curl -kv http://{alb_dns_name}/` returns 301 → HTTPS.
- `aws cognito-idp describe-user-pool --user-pool-id <id>` returns the pool.
- **Platform module applied end-to-end at this point.** All platform outputs are now consumable by the app module.

---

### 7. App: scaffolding + non-service AWS resources

**Files (new):**

- `terraform/apps/enhanced-review/data.tf` (already created in commit 1, now wires up)
- `terraform/apps/enhanced-review/variables.tf` (filled in)
- `terraform/apps/enhanced-review/secrets.tf`
- `terraform/apps/enhanced-review/iam.tf`
- `terraform/apps/enhanced-review/cloudwatch.tf`
- `terraform/apps/enhanced-review/efs.tf`
- `terraform/apps/enhanced-review/security-groups.tf`

**`data.tf`:**

```hcl
data "terraform_remote_state" "platform" {
  backend = "s3"
  config = {
    bucket         = var.platform_state_bucket
    key            = "platform/terraform.tfstate"
    region         = var.region
    dynamodb_table = "enhanced-review-tflock"
    encrypt        = true
  }
}

locals {
  platform = data.terraform_remote_state.platform.outputs
  app_url  = "https://${var.subdomain}.${local.platform.domain_name}"
}

data "aws_caller_identity" "current" {}
```

**`variables.tf`** highlights:

```hcl
variable "region"                { type = string  default = "us-west-2" }
variable "platform_state_bucket" { type = string }                       # required
variable "app_name"              { type = string  default = "enhanced-review" }
variable "subdomain"             { type = string  default = "enhanced-review" }
variable "github_owner"          { type = string  default = "twynsicle" }
variable "github_repo"           { type = string  default = "enhanced-review" }
variable "web_image" {
  type    = string
  default = "public.ecr.aws/hashicorp/http-echo:0.2.3"
}
variable "web_image_command" {
  type    = list(string)
  default = ["-listen=:3000", "-text=enhanced-review placeholder"]
}
variable "desired_count" { type = number  default = 1 }
variable "cpu"           { type = string  default = "512" }
variable "memory"        { type = string  default = "1024" }
```

**`secrets.tf`:** five empty secrets, populated out-of-band:

```hcl
locals {
  secret_names = ["auth-secret", "auth-github-id", "auth-github-secret", "anthropic-key", "postgres-password"]
}

resource "aws_secretsmanager_secret" "app" {
  for_each = toset(local.secret_names)
  name     = "${var.app_name}/${each.key}"
}
```

**`iam.tf`:** task execution role (read secrets + ECR + write logs), task role (empty), GitHub deploy role (image push + ECS update). Trust policy on the deploy role uses the platform OIDC provider ARN and is scoped to `repo:${var.github_owner}/${var.github_repo}:ref:refs/heads/main` and `repo:${var.github_owner}/${var.github_repo}:pull_request` — tighter than a literal `:*` so only main-branch pushes and PR runs from the same repo can assume the deploy role.

**`cloudwatch.tf`:**

```hcl
resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${var.app_name}"
  retention_in_days = 7
}
```

**`efs.tf`:** file system + mount targets in both AZs + access point (UID/GID 999).

**`security-groups.tf`:** task SG (ingress :3000 from platform ALB SG only) + EFS SG (ingress :2049 from task SG only).

**Manual step (post-apply, before commit 8):**

```sh
aws secretsmanager put-secret-value --secret-id enhanced-review/postgres-password \
  --secret-string "$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-32)"

aws secretsmanager put-secret-value --secret-id enhanced-review/auth-secret \
  --secret-string "$(openssl rand -base64 32)"

# auth-github-id, auth-github-secret, anthropic-key remain empty until Phase D.
# Postgres needs a non-empty password to start; the others are referenced by
# the (placeholder) web container, but http-echo ignores env vars it doesn't
# use, so empty-string secrets are fine for Phase C.
```

**Why standalone:** these resources don't depend on each other in tight cycles, and none of them depend on the ECS task being live. Landing them as a separate apply keeps commit 8 (the actual service bring-up) focused on task / target group / listener rule / Cognito client / DNS record.

**Verify:**

- `terraform apply` succeeds.
- `aws secretsmanager list-secrets --filters Key=name,Values=enhanced-review/` shows 5 entries.
- `aws efs describe-file-systems --query 'FileSystems[?CreationToken==`enhanced-review-pgdata`]'` shows ACTIVE.
- `aws iam get-role --role-name enhanced-review-task-execution` returns the role.
- `aws logs describe-log-groups --log-group-name-prefix /ecs/enhanced-review` shows the group.

---

### 8. App: ECS task definition + service + ALB integration + Route 53 record

**Files (new):**

- `terraform/apps/enhanced-review/task-definition.tf`
- `terraform/apps/enhanced-review/service.tf`
- `terraform/apps/enhanced-review/alb-target.tf`
- `terraform/apps/enhanced-review/cognito-client.tf`
- `terraform/apps/enhanced-review/route53.tf`

**`task-definition.tf`** — full two-container task, with `web` using `var.web_image` (placeholder by default) and `postgres` using `postgres:17-alpine` with EFS mount and the `postgres-password` secret. `dependsOn: postgres healthy` on the web container so the placeholder waits for postgres to be ready (verifies the start-ordering plumbing).

```hcl
resource "aws_ecs_task_definition" "app" {
  family                   = var.app_name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
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
      name         = "web"
      image        = var.web_image
      command      = var.web_image_command
      essential    = true
      portMappings = [{ containerPort = 3000, protocol = "tcp" }]
      environment = [
        { name = "AUTH_TRUST_HOST",  value = "true" },
        { name = "AUTH_URL",         value = local.app_url },
        { name = "DATABASE_URL",     value = "postgres://app:placeholder@127.0.0.1:5432/enhanced_review" },
        { name = "REVIEW_EXECUTOR",  value = "stub" },
        { name = "REVIEW_MODEL",     value = "claude-haiku-4-5" },
        { name = "REVIEW_TIMEOUT_MIN", value = "15" },
        { name = "MAX_JOBS_PER_USER",  value = "1" },
        { name = "LOG_LEVEL",        value = "info" },
      ]
      secrets = [
        # Empty during Phase C; populated by Phase D. Referenced now to
        # validate the plumbing (task execution role can read them).
        { name = "AUTH_SECRET",         valueFrom = aws_secretsmanager_secret.app["auth-secret"].arn },
        { name = "AUTH_GITHUB_ID",      valueFrom = aws_secretsmanager_secret.app["auth-github-id"].arn },
        { name = "AUTH_GITHUB_SECRET",  valueFrom = aws_secretsmanager_secret.app["auth-github-secret"].arn },
        { name = "ANTHROPIC_API_KEY",   valueFrom = aws_secretsmanager_secret.app["anthropic-key"].arn },
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
      # http-echo answers 200 on every path, so the ALB target group's
      # health check on /api/health passes without app changes.
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
        { name = "POSTGRES_PASSWORD", valueFrom = aws_secretsmanager_secret.app["postgres-password"].arn },
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

**`alb-target.tf`** — target group + listener rule:

```hcl
resource "aws_lb_target_group" "web" {
  name        = "${var.app_name}-web"
  port        = 3000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = local.platform.vpc_id
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

resource "aws_lb_listener_rule" "app" {
  listener_arn = local.platform.alb_listener_https_arn
  priority     = 100  # one app, fixed priority; second app would use 110, etc.

  condition {
    host_header { values = ["${var.subdomain}.${local.platform.domain_name}"] }
  }

  action {
    type  = "authenticate-cognito"
    order = 1
    authenticate_cognito {
      user_pool_arn       = local.platform.cognito_user_pool_arn
      user_pool_client_id = aws_cognito_user_pool_client.alb.id
      user_pool_domain    = local.platform.cognito_user_pool_domain
      session_timeout     = 86400 * 7
    }
  }
  action {
    type             = "forward"
    order            = 2
    target_group_arn = aws_lb_target_group.web.arn
  }
}
```

**`cognito-client.tf`:**

```hcl
resource "aws_cognito_user_pool_client" "alb" {
  name                                 = "${var.app_name}-alb"
  user_pool_id                         = local.platform.cognito_user_pool_id
  generate_secret                      = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["email", "openid", "profile"]
  callback_urls                        = ["${local.app_url}/oauth2/idpresponse"]
  supported_identity_providers         = ["COGNITO"]
}
```

**`route53.tf`:**

```hcl
resource "aws_route53_record" "app" {
  zone_id = local.platform.route53_zone_id
  name    = var.subdomain
  type    = "A"
  alias {
    name                   = local.platform.alb_dns_name
    zone_id                = local.platform.alb_zone_id
    evaluate_target_health = true
  }
}
```

**`service.tf`:**

```hcl
resource "aws_ecs_service" "app" {
  name            = var.app_name
  cluster         = local.platform.ecs_cluster_id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = local.platform.public_subnet_ids
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3000
  }

  deployment_circuit_breaker { enable = true  rollback = true }
  enable_execute_command = true
  depends_on = [aws_lb_listener_rule.app]
}
```

**Manual step (post-apply, for verification):**

```sh
# Create a Cognito user. Email is yours; temp password gets reset on first login.
aws cognito-idp admin-create-user \
  --user-pool-id <from platform output> \
  --username twynsicle@example.com \
  --user-attributes Name=email,Value=twynsicle@example.com Name=email_verified,Value=true \
  --message-action SUPPRESS \
  --temporary-password 'TempPass123!'
```

**Verify (Phase C exit gate):**

1. `terraform apply` succeeds.
2. `aws ecs describe-services --cluster platform-cluster --services enhanced-review` shows `runningCount=1`, `desiredCount=1`, no `events` errors.
3. `aws ecs list-tasks --cluster platform-cluster --service-name enhanced-review` returns one task ARN; `describe-tasks` shows both `web` and `postgres` containers in `RUNNING` state and the task in `HEALTHY`.
4. `dig +short A enhanced-review.{domain_name}` returns the ALB IPs.
5. `curl -v https://enhanced-review.{domain_name}/` redirects to Cognito hosted UI (HTTP 302).
6. After signing into Cognito with the user from the manual step (and resetting the password), the placeholder responds with `enhanced-review placeholder` (or similar).
7. `aws ecs execute-command --cluster platform-cluster --task <arn> --container postgres --interactive --command "psql -U app -d enhanced_review"` works; `\dt` shows no tables (placeholder web doesn't run migrations — Phase D's image will).
8. CloudWatch log group `/ecs/enhanced-review` has streams for both `web/<task-id>` and `postgres/<task-id>`.

---

### 9. Doc updates: split doc 06 into 06a + 06b

**Files:**

- New: `terraform/apps/enhanced-review/README.md` (one-page app-module bring-up)
- New: `docs/ecs-migration/06a-platform.md`
- New: `docs/ecs-migration/06b-application.md`
- Edited: `docs/ecs-migration/06-aws-infra-terraform.md` → either delete and replace with stub (header + redirect to 06a/06b) or repurpose as the design rationale doc. Plan: delete; the content lives in 06a/06b now.
- Edited: `docs/ecs-migration/00-overview.md` — Doc Index table (update the row that points at doc 06; add row for `phase-c-plan.md`).
- Edited: `docs/ecs-migration/09-cost-and-operations.md` — replace `[06](./06-aws-infra-terraform.md)` references with split links. Update kill-switch / hard-kill targets (the platform-vs-app split changes which Terraform module to `destroy`).
- Edited: `docs/ecs-migration/10-existing-docs-updates.md` — note that AGENTS.md gets a new top-level `terraform/` directory entry covering both submodules.
- Edited: `docs/ecs-migration/11-proposal-lightweight-infra.md` — section 6 (operational model, per-app onboarding) updates to describe the actual platform/app split. Section 10 (adoption checklist) updates accordingly.
- Edited: `docs/ecs-migration/12-proposal-software-stack.md` — minimal: any mention of doc 06 becomes 06a/06b.
- Edited: `AGENTS.md` — add `terraform/` to repo layout, two paragraphs in a "Deployment" subsection.

**Doc 06a** — platform module reference. Captures everything from doc 06 that lives in the platform layer, plus the rationale for the platform/app split.

**Doc 06b** — application module reference. Captures everything from doc 06 that lives in the app layer, plus the placeholder-image bootstrap pattern + manual secrets / Cognito-user steps.

**Why this is its own commit:** the doc rewrite is mechanical text-shuffling; bundling it with the Terraform code commits would dilute reviewability.

**Verify:**

- `git grep -n "06-aws-infra-terraform.md"` returns zero matches.
- All references in `00-overview.md`, `09-*.md`, `10-*.md`, `11-*.md`, `12-*.md` resolve to either `06a-platform.md` or `06b-application.md`.
- `ls docs/ecs-migration/0*.md` shows 06a + 06b; the original 06 is gone.
- `AGENTS.md` repo layout includes `terraform/` and both submodules.

---

## Risks & gotchas to watch for during execution

- **NS delegation lag.** Commit 5's `terraform apply` will hang on `aws_acm_certificate_validation.wildcard` if the user hasn't updated NS records at their registrar (or the change hasn't propagated). Symptom: apply times out at 45 min. Mitigation: verify `dig +short NS {domain_name}` returns AWS NS values _before_ running commit 5's apply.
- **Cognito hosted UI domain conflicts.** The `random_id`-suffixed domain (`platform-{hex}.auth.us-west-2.amazoncognito.com`) is globally unique on first apply, but if the random_id is regenerated (e.g. someone deletes `random_id.cognito_suffix` from state), a fresh suffix is required. Use `lifecycle { ignore_changes = [byte_length] }` if this becomes a recurring issue.
- **First-task warm-up.** ECS Fargate task pull + boot is ~60–90 seconds on first task. The ALB target-group health check has `unhealthy_threshold = 3` × `interval = 30` = 90 seconds before marking unhealthy. Borderline; if first task flakes, bump `startPeriod` on the postgres healthcheck or increase ALB unhealthy threshold.
- **EFS access point UID mismatch.** Doc 06 specifies UID/GID 999 for the postgres image's `postgres` user. If a future postgres image bumps the UID, the access point breaks silently (postgres logs `permission denied` on `pgdata`). Fixed by the access-point config; just note for major-version bumps.
- **Backend init flag drift.** Both modules use `terraform init -backend-config="bucket=..."` etc. If the user re-runs `init` without flags, Terraform will prompt or fail. Mitigation: a `terraform/Makefile` (optional) wrapping init for both modules. Acceptable to land without it.
- **`var.platform_state_bucket` propagation.** The app module needs the platform's bucket name to read remote state. Hardcoding it in `terraform.tfvars` (gitignored) or passing on every apply via `-var=` is fine; just don't commit a tfvars with the literal bucket if you'd rather keep account-IDs out of git. (For a personal POC, the account ID is low-sensitivity — acceptable to commit.)
- **Secrets order on first app apply.** Commit 7 creates the `postgres-password` secret (empty). The postgres container in commit 8 will refuse to start with an empty password — apply commit 8 _after_ the manual `put-secret-value` step. Plan documents this; verify the user does it.
- **`terraform_remote_state` data source is read-only.** It loads platform outputs at app-apply time. If platform changes (e.g. new subnet) but app isn't re-applied, the app continues to reference the stale value cached in its plan. Symptom: surprising "drift" in subsequent app applies. Acceptable for our cadence; flag if it becomes confusing.
- **ALB listener rule priority numbering.** Commit 8 hardcodes `priority = 100`. Future apps would use 110, 120, etc. Document this convention in 06b so the next app doesn't collide on 100.
- **ACM cert SAN apex.** The cert covers `*.{domain}` plus `{domain}` as a SAN. Apex SAN is only needed if you ever serve from the apex; we deliberately don't (subdomain pattern). The SAN is harmless and costs nothing — keeps the option open.
- **Cost during placeholder phase.** Per the doc 09 cost model: ALB ($18) + Fargate ($15) + EFS ($0.30) + Route 53 ($0.50) + Secrets ($2) + ECR ($0.15) ≈ **$36/mo** even with placeholder traffic. Expected; if surprising, see doc 09's kill-switch section.
- **Manual Cognito user creation.** Using `--message-action SUPPRESS` skips the verification email. The temporary password resets on first login. If the user forgets the temp password, run `admin-set-user-password` to reset it.
- **Service ignores task-definition changes after first apply.** `service.tf` carries `lifecycle { ignore_changes = [task_definition] }` so Phase D's image-deploy pipeline (which registers a new task-def revision and calls `UpdateService` directly) doesn't fight Terraform on subsequent applies. Side effect: changing the task definition in Terraform alone won't actually update the running service — you have to either temporarily remove the `ignore_changes`, run an out-of-band `aws ecs update-service --force-new-deployment`, or push a new image through the Phase D pipeline.

---

## Verification checklist (Phase C exit gate)

Tick all before merging the Phase C branch:

- [ ] Commit 1: `bash terraform/bootstrap.sh` runs; bucket + lock table exist; both modules `terraform init` cleanly with the `-backend-config` flags.
- [ ] Commit 2: platform VPC + 2 subnets + IGW + route table visible in AWS console.
- [ ] Commit 3: ECS cluster ACTIVE, ECR repo `enhanced-review` exists, GitHub OIDC provider visible in IAM.
- [ ] Commit 4: Route 53 zone created; NS records output. **NS delegation completed at registrar.** `dig +short NS {domain_name}` returns AWS NS.
- [ ] Commit 5: ACM cert `*.{domain}` + apex SAN ISSUED. `aws acm list-certificates` shows status=ISSUED.
- [ ] Commit 6: ALB DNS responds with 404 default; HTTP→HTTPS redirect works; Cognito user pool + hosted UI domain exist.
- [ ] **Platform module fully applied; outputs available for app module.**
- [ ] Commit 7: 5 secrets exist (4 empty, 1 with `postgres-password` populated); EFS file system ACTIVE; IAM roles created; log group exists.
- [ ] Commit 8: ECS service `runningCount=1`; both containers HEALTHY; ALB target group has 1 healthy target; listener rule with host header `enhanced-review.{domain}` registered at priority 100; Route 53 alias record resolves to ALB.
- [ ] **Smoke test:** `https://enhanced-review.{domain_name}` redirects to Cognito → after manual user creation + first-login password reset → returns 200 from `hashicorp/http-echo` placeholder.
- [ ] **ECS Exec smoke test:** `aws ecs execute-command --container postgres --command "psql -U app -d enhanced_review"` works; can `\d` (no tables yet, expected).
- [ ] CloudWatch logs: both `web/...` and `postgres/...` streams have lines.
- [ ] Commit 9: `git grep -n "06-aws-infra-terraform"` returns zero matches outside of git history; `00-overview.md` doc index lists 06a + 06b + `phase-c-plan.md`; `AGENTS.md` mentions `terraform/`.
- [ ] Existing CI (format / lint / typecheck / test / docker-build) still green.
- [ ] **Cost check after 24h:** AWS Billing dashboard shows ~$1–2 (extrapolates to ~$30–40/mo). Doc 09 cost line items align.

---

## Open questions deferred to a later phase

These came up during planning but don't block Phase C. Captured here so they're not lost.

- **`/api/health` for external monitoring.** ALB target-group internal health checks bypass Cognito (per decision C15), but if the user later wants UptimeRobot / similar to hit `/api/health` from the public internet, a listener rule that bypasses Cognito for that path is needed. Defer until external monitoring is actually wanted; flag in doc 09 ops runbook updates (Phase E).
- **Public IP rotation for Anthropic / GitHub allowlists.** Each task restart gets a new public IP (no NAT). If GitHub or Anthropic ever rate-limit by IP rapidly, we'd need NAT after all. Highly unlikely for personal-POC traffic. Flagged in doc 09.
- **EFS throughput mode.** Currently `bursting`. If postgres feels slow, `elastic` (~$0.03/GB-month committed) is a one-line change. Defer until observed.
- **Multi-AZ task placement.** ECS service distributes across both subnets via `availability_zone_distribution_strategy = "BALANCED_AZ"` (default). Single task means it lands in one AZ; AZ failure = brief downtime until a new task starts. Acceptable for POC; would need autoscaling + RDS to genuinely scale.
- **Cognito user pool MFA.** Set to OPTIONAL with TOTP enabled; the user can opt in via the hosted UI. Force MFA = `mfa_configuration = "ON"`; defer until user decides.
- **Cost alarm.** Doc 09 recommends an account-level $50/mo budget alarm. Set up in Phase E ops.
- **Secrets rotation Lambdas.** Doc 09 mentions optional automation; not needed for POC.
- **ECS Service Connect / Cloud Map.** Not needed (web + postgres share localhost). Flagged in case we ever split them.
- **Multi-app stamping.** Adding a second app to this platform would require: (1) a platform-side commit adding the app to `var.registered_apps`, (2) a new `terraform/apps/<name>/` module (mostly a copy of `enhanced-review/`'s files with `var.subdomain` and `var.app_name` swapped), (3) `priority = 110` (or next available) on the listener rule. Not blocked; just documented.
