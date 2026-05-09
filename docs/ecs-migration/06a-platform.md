# 06a — Platform Terraform module

The shared infrastructure layer. One Terraform module per AWS account. Owns the resources that don't change when an app is added or removed: the VPC, the ECS cluster, the ALB, the Cognito user pool, the Route 53 zone, the wildcard ACM cert, the GitHub OIDC provider, and the per-app ECR repositories.

This is **Phase C** material. Companion to [06b-application.md](./06b-application.md) (the per-app module) and [phase-c-plan.md](./phase-c-plan.md) (execution playbook). Reference proposal: [11-proposal-lightweight-infra.md](./11-proposal-lightweight-infra.md).

Code lives at `terraform/platform/` in the repo root.

---

## Why a separate platform module

The original doc 06 plan (since split into 06a + 06b) described a single root module per app. During Phase C planning we changed that to a two-module split because:

- **Cost amortization.** ALB (~$18/mo) is the biggest fixed line item. Sharing it across N apps drops per-app fixed cost to $18/N.
- **Solves the ECR↔ECS chicken-and-egg.** ECR repositories are platform-owned, so they exist before any app's ECS service tries to pull. App's first apply uses a placeholder image (Phase D's pipeline pushes the real one).
- **Matches the proposal narrative.** [11](./11-proposal-lightweight-infra.md) framed this as a multi-tenant pattern. Adopting it now means the proposal describes what we built rather than what we'd build later.

Cost: with N=1 (only `enhanced-review` adopts the platform today), we're designing the interface against a single use case. Mitigation: keep platform outputs minimal — only what the app actually consumes — and let the next app's needs grow them.

---

## Decisions feeding into this doc

- **D5** ECS Fargate (cluster, capacity providers)
- **D7** ALB + Cognito for "only-me" access (the user pool, hosted UI, and ALB live here; per-app clients + listener rules are in 06b)
- **D8** Registered domain in Route 53 + ACM cert (wildcard, covers `*.{domain}` plus apex SAN)
- **D10** GitHub OIDC federation (single provider per AWS account)
- **D11** Public subnet for the Fargate task — drops the NAT Gateway

---

## Architecture (platform-side)

```
                                ┌────────────────────────┐
                                │   Route 53 zone        │
                                │   <var.domain_name>    │
                                └───────────┬────────────┘
                                            │
                                            ▼
                  ┌─────────────────────────────────────────┐
                  │  Application Load Balancer (HTTPS)      │
                  │  - listener :443 (cert: *.<domain>)     │
                  │     default action: 404 fixed-response  │
                  │  - listener :80 → :443 redirect         │
                  │  - SG: 0.0.0.0/0 :443, :80              │
                  └─────────────────────────────────────────┘
                                            ▲
                                  apps register their
                                listener-rule + target-group
                                            │
                  ┌─────────────────────────────────────────┐
                  │  ECS cluster `platform-cluster`         │
                  │  capacity providers: FARGATE, FARGATE_SPOT │
                  │  apps create services in this cluster   │
                  └─────────────────────────────────────────┘

   VPC 10.0.0.0/16 ── 2 public subnets across 2 AZs ── IGW + public route table
   Cognito user pool `platform-users` (shared) + hosted UI domain
   Wildcard ACM cert `*.<domain>` (DNS-validated)
   GitHub OIDC provider — apps' deploy roles trust this
   ECR repositories — one per app in var.registered_apps
```

---

## State backend bootstrap

State lives in S3 + DynamoDB lock. Created once via `terraform/bootstrap.sh` outside Terraform (Terraform can't manage its own state backend cleanly).

```sh
bash terraform/bootstrap.sh
```

Creates:

- `s3://enhanced-review-tfstate-<account-id>` — bucket name embeds the account ID for global uniqueness, encrypted at rest, versioned, public-access blocked.
- `enhanced-review-tflock` — DynamoDB table with `LockID` partition key.

Both modules' state files live in the same bucket: `platform/terraform.tfstate` and `apps/enhanced-review/terraform.tfstate`.

The script prints the `-backend-config` flags to use at `terraform init` time.

---

## VPC and networking

```
VPC 10.0.0.0/16, DNS support + hostnames on
├─ public subnet @ 10.0.1.0/24 (AZ "a")  ─── IGW route 0.0.0.0/0
├─ public subnet @ 10.0.2.0/24 (AZ "b")  ─── IGW route 0.0.0.0/0
└─ Internet Gateway
```

Two public subnets across the first two AZs of whatever region the apply runs in. ALB requires two AZs even with one task. The Fargate task gets a public IP and reaches the internet directly through the IGW. **No NAT Gateway** — saves ~$32/mo. Task SG (defined in 06b) restricts ingress to the ALB SG only.

Picking the first two AZs alphabetically keeps subnet→AZ mapping stable across applies, which keeps EFS mount targets attached to consistent subnets.

See [09](./09-cost-and-operations.md) for the public-vs-private cost breakdown and [11](./11-proposal-lightweight-infra.md) for the SRE-facing framing.

---

## ECS cluster

`platform-cluster` with FARGATE + FARGATE_SPOT capacity providers (default FARGATE). Container Insights off by default — adds CloudWatch metric cost; flip on if alarms become useful.

Apps create their own `aws_ecs_service` resources targeting this cluster. The cluster itself is just a logical grouping, free.

---

## ECR

One repository per app, defined via `var.registered_apps` (default `["enhanced-review"]`). Adding a new app to the platform = a commit on the platform module that adds it to the list — that's the coupling point between platform and apps.

Each repo:
- `image_tag_mutability = "MUTABLE"` — `:latest` can be overwritten; `:sha-<commit>` tags are unique by convention.
- `scan_on_push = true` — surfaces vulnerability findings in the ECR console.
- Lifecycle policy keeps the last 10 `sha-`tagged images, expires the rest.

Outputs: a `ecr_repository_urls` map and `ecr_repository_arns` map, keyed by app name. Apps look up their own URI/ARN by `var.app_name`.

---

## GitHub OIDC provider

One `aws_iam_openid_connect_provider` per AWS account. Trust scope (which repo, which branch) is enforced in each app's deploy role assume-role policy, not here.

`thumbprint_list` includes the historical 2021 thumbprint; AWS validates GitHub OIDC tokens via JWKS now, so the thumbprint is essentially a placeholder.

---

## Route 53

Hosted zone for `var.domain_name`. Apps create ALIAS records under this zone (e.g. `enhanced-review.{domain}`).

The output `route53_name_servers` is the four AWS NS records. **If the domain is registered outside Route 53**, update the registrar's NS records to these values before commit 5 (ACM cert validation) runs. DNS propagation can take minutes to hours.

If the domain is registered through `aws route53domains register-domain`, Route 53 is automatically authoritative and no NS update is needed.

---

## ACM wildcard cert

`*.{domain}` with `{domain}` as a SAN. DNS-validated against the Route 53 zone. The cert covers all current and future apps' subdomains under the parent — adding a new app doesn't require a new cert.

`aws_acm_certificate_validation.wildcard` blocks until ACM marks the cert ISSUED. First apply can take 5–30 min depending on registrar NS propagation. If it hangs past 30 min, suspect NS delegation.

ACM's emitted validation records may overlap (one for the wildcard, one for the apex); Terraform's standard `for_each` over `domain_validation_options` handles this. `allow_overwrite = true` mitigates the rare collision case.

---

## ALB + listener

```hcl
resource "aws_lb_listener" "https" {
  port = 443
  protocol = "HTTPS"
  certificate_arn = ... # the wildcard cert
  ssl_policy = "ELBSecurityPolicy-TLS13-1-2-2021-06"

  default_action {
    type = "fixed-response"
    fixed_response { message_body = "platform-alb: no app matched" status_code = 404 }
  }
}
```

The listener default action is `fixed-response 404`. Per-app listener **rules** (defined in 06b) carry their own `authenticate-cognito + forward` actions, gated by host header. Default fires only when no app's host matches.

`idle_timeout = 120` — SSE heartbeats are 15s; the default 60 is fine but tight.

Plus a separate `:80` listener that redirects to `:443` (HTTP_301).

---

## Cognito

Single shared user pool `platform-users`:

- Password policy: 12+ chars, lowercase + uppercase + digits required, no symbol requirement.
- MFA: OPTIONAL, TOTP enabled (users opt in via the hosted UI).
- Email recovery enabled, email auto-verified.
- Hosted UI domain `platform-{random_id}` on the cognito-amzn subdomain (custom domain skipped per 06b's "users only see this on first login" reasoning).

Per-app clients live in 06b. The shared pool means **the same Cognito user can reach all apps** that adopt this platform — clean for a "team of 5" pattern but worth thinking through if apps need different access lists.

Single user creation is out-of-band:

```sh
aws cognito-idp admin-create-user \
  --user-pool-id <terraform output cognito_user_pool_id> \
  --username you@example.com \
  --user-attributes Name=email,Value=you@example.com Name=email_verified,Value=true \
  --message-action SUPPRESS \
  --temporary-password 'TempPass123!'
```

First login resets the temp password via the hosted UI. See [09](./09-cost-and-operations.md).

---

## Outputs (the platform→app interface)

The full output list lives in `terraform/platform/outputs.tf`. Apps read all of these via `data "terraform_remote_state" "platform"`:

- `vpc_id`, `public_subnet_ids`, `availability_zones`
- `ecs_cluster_id`, `ecs_cluster_name`, `ecs_cluster_arn`
- `ecr_repository_urls` (map), `ecr_repository_arns` (map)
- `github_oidc_provider_arn`
- `route53_zone_id`, `route53_name_servers`, `domain_name`
- `acm_certificate_arn`
- `alb_arn`, `alb_dns_name`, `alb_zone_id`, `alb_listener_https_arn`, `alb_security_group_id`
- `cognito_user_pool_id`, `cognito_user_pool_arn`, `cognito_user_pool_domain`

Treat this as the **stable contract** between layers. Adding a new output is fine; renaming or removing one breaks every app that consumes it.

---

## Verification

Phase C platform success:

1. `bash terraform/bootstrap.sh` — bucket + lock table created.
2. `cd terraform/platform && terraform init -backend-config=…`
3. `terraform apply -var="domain_name=yourdomain.com"` — completes through ACM validation. (May take 5–30 min on the cert step; longer if NS delegation hasn't propagated.)
4. `aws ec2 describe-vpcs --filters Name=tag:Name,Values=platform-vpc` — VPC visible.
5. `aws ecs describe-clusters --clusters platform-cluster` — ACTIVE.
6. `aws ecr describe-repositories --repository-names enhanced-review` — exists.
7. `curl -kv https://<alb_dns_name>/` — 404 fixed-response.
8. `curl -kv http://<alb_dns_name>/` — 301 → HTTPS.
9. `aws acm list-certificates` — wildcard cert ISSUED.
10. `aws cognito-idp describe-user-pool --user-pool-id <id>` — pool exists.

**At this point, the application module can apply against the same AWS account.** See [06b](./06b-application.md).

---

## Out of scope (platform layer)

- **Application-specific resources.** ECS task/service, EFS, target group, listener rule, Cognito client, Route 53 record, secrets, scoped IAM — all in 06b.
- **WAF / Shield.** Listener has no WAF web ACL attached. Add at the ALB level if exposing to the open internet.
- **Multi-AZ task placement.** Platform provides two subnets; apps run a single task that lands in one AZ. Acceptable for POC.
- **Cross-region.** Single region per platform stack.
- **Custom Cognito domain.** Default Cognito-managed subdomain; users only see it on first login.
- **Multi-tenancy at the user pool.** Single shared pool. Apps requiring isolated user pools would need a per-app pool — different pattern, listed for future reference.
