# Proposal: Lightweight AWS deployment pattern for internal apps

> **Status:** draft. **Audience:** SREs and platform engineers reviewing this for adoption beyond a single team.
> **Reference implementation:** `enhanced-review` — a Next.js 16 + Postgres app deployed via this pattern. See `docs/ecs-migration/` for the migration plan that produced it.
> **TL;DR:** ECS Fargate single-task with two containers (web + Postgres sidecar), EFS for persistence, ALB with Cognito for "only-me" or "only-us" gating, Terraform-managed, GitHub Actions CD via OIDC. Hits ~$37/mo per app. Designed to be the **paved path for engineers shipping internal POCs and small tools** without needing to learn the full platform.

---

## 1. Problem statement

Engineers in our org regularly want to ship small internal apps:

- A dashboard the team uses to review GenAI output (the reference app)
- A handful of scripts behind a UI for triggering common ops (deploys, data exports)
- A throwaway tool to validate an idea with two stakeholders
- A long-lived "5 of us use it daily" internal app that never grows beyond that

Today, the available options are:

- **Use the full platform.** All the right primitives but optimized for production-shaped workloads. Heavy ceremony for a 2-user POC.
- **Run it locally and screen-share.** Doesn't scale beyond the engineer's laptop; hostile to async use.
- **One-off Lambda + API Gateway.** Works for stateless tools but breaks down on anything stateful, anything streaming, or anything long-running.
- **Self-host on EC2.** No paved path for HTTPS, auth, deploys, or persistence; everyone hand-rolls.

This proposal defines a reusable AWS pattern that occupies the gap: cheap enough to leave running indefinitely, secure enough to expose to the internet, simple enough to deploy in an afternoon.

---

## 2. Goals and non-goals

### Goals

- **Cheap by default.** ~$30-40/mo per app, not per environment. Zero-traffic apps stay under $40.
- **Secure by default.** Public-facing endpoints require authenticated access (no `0.0.0.0/0`).
- **Reproducible.** All infra in Terraform, all deploys via CI. No "it worked on my laptop" infra drift.
- **Reasonable DX.** Local docker-compose mirrors prod closely. One command to start, one PR to ship.
- **Multi-team.** A team can adopt the pattern without coordinating with another team. Each app gets its own AWS resources.

### Non-goals

- **Compliance.** Pattern is intended for internal-only or low-stakes external apps. Not SOC2/PCI/HIPAA-ready out of the box.
- **High availability.** Single AZ. AZ failure = brief downtime. Acceptable for the POC tier.
- **Hyperscale.** Topple over above ~5 concurrent users. The migration paths to scale (RDS, multi-task, etc.) are documented but out of scope here.
- **Multi-region.** Single region. DR via "redeploy from `terraform apply`" + recoverable state in S3.

---

## 3. Reference architecture

```
                                ┌──────────────────┐
                                │   Route 53       │
                                │  yourapp.com     │
                                └────────┬─────────┘
                                         │ ALIAS
                                         ▼
               ┌────────────────────────────────────────┐
               │  Application Load Balancer (HTTPS)     │
               │  - ACM cert (DNS-validated)            │
               │  - Cognito authenticate-cognito action │
               │  - SG: 0.0.0.0/0 :443                  │
               └────────────────┬───────────────────────┘
                                │
                                ▼
               ┌────────────────────────────────────────┐
               │   ECS Fargate task                      │
               │   ┌──────────┐  ┌──────────┐            │
               │   │   web    │  │ postgres │            │
               │   │  :3000   │  │  :5432   │            │
               │   └──────────┘  └──────────┘            │
               │   Public subnet, public IP              │
               │   SG: ingress :3000 from ALB-SG only    │
               │   EFS volume mounted on postgres        │
               └────────────────────────────────────────┘
                                 │
                                 ▼
               ┌────────────────────────────────────────┐
               │   EFS file system + access point        │
               │   /var/lib/postgresql/data              │
               └────────────────────────────────────────┘

   Cognito user pool ←── ALB authenticate-cognito action
   Secrets Manager   ──→ ECS task secrets[]
   ECR (private)     ──→ ECS task image
   CloudWatch Logs   ←── awslogs driver

   GitHub Actions ── OIDC ──→ IAM role → (image build + push) OR (terraform apply)
```

### Component-by-component rationale

| Component                       | Why this                                                                                                 | Why not the alternative                                                                                        |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **ECS Fargate**                 | Per-second billing. Runs anywhere. Native multi-container task. No host management.                      | Lambda: 15-min limit, no streaming, no in-process state. App Runner: less Terraform-friendly.                  |
| **Single multi-container task** | Web + DB share a task ENI; talk over `localhost`. Zero networking complexity. Cheaper than two tasks.    | Two tasks: cleaner boundaries but ~2x base cost and more Terraform.                                            |
| **Postgres in container**       | Engineers already know Postgres. Drizzle/Prisma/Knex first-class. JSONB removes most schema-design pain. | DynamoDB: scales further but worse DX for relational ad-hoc queries. SQLite-on-EFS: not concurrent-write-safe. |
| **EFS for DB volume**           | Fargate's only native persistent volume option. Cheap (~$0.30/GB/mo). Survives task restarts.            | EBS: not available to Fargate. RDS: ~$13/mo, considered later.                                                 |
| **Public subnet, no NAT**       | Saves ~$32/mo. Task SG locks ingress to ALB only. Outbound traffic goes through IGW (free).              | Private subnet + NAT: standard pattern, but doubles the bill.                                                  |
| **ALB + Cognito**               | Network-level auth gate. Engineers don't have to roll their own login. AWS-native, free for low MAU.     | App-level auth only: works, but every app rolls its own. Cloudflare Access: cheaper but adds a dep.            |
| **Route 53 + ACM**              | TLS for free; managed DNS at $0.50/mo per zone.                                                          | Self-managed certs: free but operationally awful.                                                              |
| **Secrets Manager**             | Native ECS integration via task definition `secrets[]`. Each secret rotates independently.               | SSM Parameter Store: cheaper but no native rotation; less enforcement.                                         |
| **GitHub OIDC**                 | No long-lived AWS keys. Trust policy scopes to repo + branch.                                            | Static keys: rotation burden, blast radius if leaked.                                                          |
| **Terraform**                   | Declarative, dry-runnable, drift-detectable. Industry standard.                                          | CDK / Pulumi: more code-y, fewer engineers fluent.                                                             |
| **CloudWatch Logs**             | Native ECS integration. 7-day retention is cheap.                                                        | Self-hosted ELK: hilariously not worth it for one app.                                                         |

---

## 4. Cost model

Per-app monthly cost in `us-east-1` with no traffic (idle baseline). Real apps with users add a few % of egress and Cognito MAU once you cross 50,000 MAU.

| Item                                   | Cost           | Note                                            |
| -------------------------------------- | -------------- | ----------------------------------------------- |
| ALB                                    | **~$18.00/mo** | Fixed. Single biggest line item.                |
| Fargate (0.5 vCPU + 1 GB, 24/7)        | **~$15.00/mo** | Two-container task uses one set of vCPU/memory. |
| EFS (1 GB)                             | **~$0.30/mo**  |                                                 |
| Route 53 hosted zone                   | **~$0.50/mo**  |                                                 |
| Secrets Manager (5 secrets)            | **~$2.00/mo**  |                                                 |
| ECR                                    | **~$0.15/mo**  | Lifecycle policy keeps 10 images.               |
| CloudWatch Logs                        | **~$0.00**     | Under free tier at this volume.                 |
| Cognito                                | **$0.00**      | First 50,000 MAU free.                          |
| ACM cert                               | **$0.00**      |                                                 |
| Egress (GitHub clones + Anthropic API) | **~$1-3/mo**   |                                                 |
| Domain registration                    | **~$1.00/mo**  | Amortized.                                      |
| **TOTAL**                              | **~$37/mo**    |                                                 |

### Cost-cutting levers (in order of impact)

1. **Drop Cognito + ALB**, replace with Cloudflare Tunnel sidecar → **-$18/mo** (~$19/mo total). Adds Cloudflare account dependency. Documented as the cheap-tier variant.
2. **Scale to zero when not in use** (ECS service desired count = 0) → **-$15/mo** while paused. Resume in ~5 min. Documented in [09](./09-cost-and-operations.md).
3. **Switch from public-subnet to private-subnet + NAT** → **+$32/mo**. Listed for completeness; we recommend public-subnet for the POC tier.
4. **Switch Postgres from sidecar to RDS db.t4g.micro** → **+$13/mo** (~$50/mo total). Trade-off: backups, patching, monitoring all become managed. Recommended once data exceeds ~5 GB or backups become essential.

---

## 5. Security posture

### What's protected

| Concern                               | Mitigation                                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Unauthorized access to the app        | ALB authenticate-cognito action; only authenticated users see anything beyond `/oauth2/idpresponse`.           |
| Direct access to the Fargate task     | Task SG ingress restricted to `[ALB SG]:3000`. Public IP exists for egress only; no ports listen externally.   |
| Direct access to Postgres             | Postgres listens on `127.0.0.1:5432` inside the task netns. Sidecar; never exposed.                            |
| Secrets in code or env                | Secrets Manager + task definition `secrets[]`. Task execution role has scoped `secretsmanager:GetSecretValue`. |
| Long-lived AWS credentials in CI      | GitHub OIDC federation; no AWS access keys stored in GitHub.                                                   |
| Encryption in transit (browser ↔ ALB) | TLS 1.3 via ACM cert.                                                                                          |
| Encryption in transit (task ↔ EFS)    | EFS transit encryption enabled.                                                                                |
| Encryption at rest (EFS, ECR, S3)     | All AWS-default-encrypted.                                                                                     |
| Container image vulnerabilities       | ECR `scan_on_push = true`. Findings visible in ECR console; alerts via EventBridge if needed.                  |
| TF state secrets exposure             | State bucket has `BlockPublicAccess` + versioning. Lock table prevents concurrent modification.                |

### What's NOT protected (out of scope for this pattern)

- **WAF / Shield.** No protection against application-layer DDoS or OWASP-class probes. Fine for internal-only or trusted-audience apps. Add WAF at the ALB level if exposing to the open internet.
- **Secret rotation automation.** Rotation requires `force-new-deployment`; works, but isn't on a schedule. Add Secrets Manager rotation Lambdas if your org's policy requires.
- **Vulnerability scanning beyond ECR-built-in.** No Snyk, no Trivy in CI. The `npm audit` gate in CI is the only library-level check. Add scanning as needed.
- **Audit logging.** CloudWatch logs every request to the app, but ECS task lifecycle and IAM events go to CloudTrail (which we don't enable separately). If your org requires CloudTrail, enable at the account level (free for management events).
- **Network segmentation.** Single VPC, single SG-pair. Fine for a single-app POC; if you stamp out the pattern, consider per-app VPCs or Transit Gateway if cross-app communication is a concern.

### IAM blast radius

Three roles per app:

- **Task execution role** — pulls images, fetches secrets, writes logs. Read-only on AWS APIs except for the specific ECR + Secrets Manager ARNs. Compromise = reads task secrets only.
- **Task role** — AWS APIs the app itself uses. **For this reference impl: empty.** If your app uses S3 / SQS / etc., expand here. Compromise = whatever you granted.
- **GitHub OIDC deploy role** — creates AWS resources via Terraform OR pushes images. Trust policy restricts to `repo:org/app:ref:refs/heads/main` (or `pull_request`). Compromise requires also compromising your GitHub repo. Recommend separate roles for image deploy vs Terraform.

---

## 6. Operational model

### Who owns what

| Concern                          | Owner                                                      |
| -------------------------------- | ---------------------------------------------------------- |
| App code, Dockerfile             | App team                                                   |
| `terraform/` for the app         | App team                                                   |
| GitHub Actions workflows         | App team                                                   |
| AWS account / billing            | Central platform / SRE                                     |
| Account-level IAM policies / SCP | Central platform / SRE                                     |
| Pattern itself (this doc)        | Central platform / SRE — owns the reference implementation |
| App-level secrets                | App team (via Secrets Manager)                             |
| Domain                           | App team (per-app subdomain) or central (delegated zone)   |

### Runbook items (per-app)

Detailed in [09](./09-cost-and-operations.md). Highlights:

- Rotate secrets via `aws secretsmanager put-secret-value` + `force-new-deployment`.
- Pause: `aws ecs update-service --desired-count 0` (drops to ~$22/mo).
- Restore: `--desired-count 1` (~5 min cold).
- Tail logs: `aws logs tail /ecs/<app> --follow`.
- Exec into containers: `aws ecs execute-command ... --interactive --command "/bin/sh"` (or `psql` for Postgres).
- Manual backup: `pg_dump` via ECS Exec → S3.

### Alarms (recommended baseline)

- ALB `UnHealthyHostCount > 0` for 5 min → SNS email.
- CloudWatch metric filter on `ERROR` / `FATAL` log lines → SNS.
- Cost alarm at the account level: budget $50/mo per app, alert at 80%.

### Per-app onboarding (proposed standard)

A new app teaming up with this pattern should:

1. Fork or copy the reference repo's `terraform/` directory + GitHub Actions workflows.
2. Replace `enhanced-review` with the app name throughout (resource names, log groups, ECR repo, Cognito user pool).
3. Have central platform create the GitHub OIDC trust policy in the AWS account (one-time manual; the app team can't do it themselves because it requires account-root or a privileged role).
4. Run `terraform/bootstrap.sh` to create state backend.
5. `terraform apply`.
6. Configure GitHub OAuth App + put credentials in Secrets Manager.
7. Add the maintainer to the Cognito user pool.

Total time: an afternoon if everything's smooth, a day if it's the first time.

---

## 7. Alternatives evaluated

### Hosting

| Option                   | Pros                                                     | Cons                                                               | When to pick                                     |
| ------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------ |
| **ECS Fargate** (chosen) | No host mgmt; per-second billing; native multi-container | ~$15/mo idle minimum                                               | Default                                          |
| ECS on EC2               | ~$3/mo with t4g.nano spot; full host control             | Capacity planning; OS patching; agent management                   | When you've got >3 apps and want to share an EC2 |
| Lambda + API Gateway     | Pennies at idle; zero ops                                | 15-min timeout; cold start; no SSE / WebSockets; limited streaming | Stateless small APIs                             |
| App Runner               | Cheaper than Fargate; managed                            | Less Terraform-friendly; less control over networking              | If you don't need ALB / VPC integration          |
| Self-host on EC2         | Most flexibility                                         | Build everything yourself                                          | Don't                                            |

### Database

| Option                        | Pros                                             | Cons                                                     | When to pick                                     |
| ----------------------------- | ------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------ |
| **Postgres in task** (chosen) | Cheap ($0); engineers know it; sidecar pattern   | Backups manual; limited IOPS via EFS; deploy restarts DB | POC, internal-only, ~5 users                     |
| RDS db.t4g.micro              | Managed backups, patching, snapshots             | ~$13/mo extra; cold-start during minor version upgrades  | Once data is valuable or backups become required |
| Aurora Serverless v2          | Auto-scaling                                     | ~$43/mo floor (0.5 ACU min)                              | High-variance workloads                          |
| DynamoDB                      | Serverless; unlimited scale; per-request billing | Different mental model; ad-hoc queries painful           | Heavy-write or denormalized-by-design workloads  |
| Sidecar SQLite on EFS         | Simplest possible                                | Not concurrent-write-safe; corrupted on multi-task       | Don't                                            |

### Auth / access

| Option                       | Pros                                         | Cons                                                             | When to pick                               |
| ---------------------------- | -------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------ |
| **ALB + Cognito** (chosen)   | AWS-native; free for low MAU; OIDC           | $18/mo for ALB; one user pool per app                            | Default                                    |
| Cloudflare Access            | Free; identity-aware; SSO with Google/GitHub | Cloudflare account dependency                                    | When you want absolute-cheapest            |
| Tailscale                    | Tightest network boundary; zero-trust        | Tailscale on every device; not for unauthenticated public access | Internal-only apps used from known devices |
| ALB + IP allowlist (no auth) | Cheapest                                     | Breaks when you travel; no audit; no UX                          | Don't, unless throwaway demo               |
| App-level auth only          | Familiar; flexible                           | Every app rolls its own; ALB is wide open                        | If you have a strong app-level auth system |

### Networking

| Option                             | Pros                         | Cons                                                                 | When to pick                        |
| ---------------------------------- | ---------------------------- | -------------------------------------------------------------------- | ----------------------------------- |
| **Public subnet, no NAT** (chosen) | Free; SG protects ingress    | Task has public IP (locked to no listener); not "production-correct" | POC tier                            |
| Private subnet + NAT GW            | Standard; clean egress story | $32/mo NAT                                                           | Production tier                     |
| Private subnet + VPC endpoints     | Free egress to AWS services  | GitHub & Anthropic still need NAT or proxy                           | If your traffic is 90% AWS-internal |

### Auth provider (orthogonal to "which auth pattern")

This is the lever that varies most across apps. See section 8 for the Google OAuth deep-dive.

---

## 8. Auth alternatives — Google OAuth for org SSO

The reference implementation uses GitHub OAuth because the app needs to clone the user's repos. Most internal apps don't — they just need "is this person someone in our org?" For those, **Google OAuth via Workspace** is simpler and more org-appropriate. This section explains how it slots into the pattern.

### Pattern compatibility

The infrastructure is **provider-agnostic.** Every component in the architecture diagram works identically:

- ALB + Cognito doesn't care which IdP your user pool federates to.
- The Fargate task / Postgres / EFS / Secrets Manager don't know auth even exists.
- Terraform module shape is unchanged.

The **only change** is in the app layer: which OAuth provider does Auth.js (or your auth library) talk to?

### Three integration shapes for Google OAuth

#### (a) Google as Cognito federated IdP

Cognito user pool with Google as a federated IdP. ALB authenticate-cognito flow → user redirected to Google sign-in → Google returns to Cognito → Cognito issues its own JWT → ALB forwards to app. The app sees only Cognito identity.

**When to choose:** the app doesn't need the user's Google access token. It just needs to know "this person signed in via SSO and Cognito has identified them." Most internal dashboards.

**Configuration:**

- Add a Google IdP to the Cognito user pool (`aws_cognito_identity_provider` Terraform resource).
- Set `attribute_mapping` to map Google's `email` and `name` to Cognito's standard attributes.
- Restrict the user pool client to the Google IdP (`supported_identity_providers = ["Google"]`).
- Optionally, restrict by domain in the Lambda pre-sign-up trigger: reject any `email` whose domain isn't `@yourcompany.com`.

#### (b) Google as Auth.js provider, no Cognito

Skip the Cognito layer entirely. ALB just forwards (no auth action). App handles all auth via Auth.js with the Google provider.

**When to choose:** Cognito's $0 floor is misleading once you want federated IdPs — adding Google federation requires the Cognito Plus tier ($0.0055/MAU after 50,000 free, but the _features_ are the gate not the price). Sometimes simpler to skip Cognito and let Auth.js handle Google directly. App has full control.

**Configuration:**

- Drop the `authenticate-cognito` action on the ALB listener (now `default_action: forward`).
- Drop the Cognito user pool resources.
- App's `auth.ts` config:
  ```typescript
  providers: [
    Google({ clientId, clientSecret, authorization: { params: { hd: 'yourcompany.com' } } }),
  ];
  ```
- The `hd` parameter restricts to a specific Google Workspace domain. Strong, simple, native.

**Note:** this _removes_ the network-level access gate. Anyone hitting the ALB sees the Google sign-in screen, but otherwise the route is open. For most internal apps this is fine — Google's `hd` is the gate.

#### (c) Both layers (Cognito + app-level Auth.js)

Cognito federates Google for the network-level gate; Auth.js _also_ does Google OAuth for app-level identity (e.g. to get a refresh token for Workspace API calls).

**When to choose:** rare. Apps that act on Google APIs on behalf of the user (Drive, Calendar, Gmail). The Cognito sign-in handles "is this person allowed to access the network endpoint"; Auth.js handles "give me a refresh token for their account."

**Trade-off:** two sign-ins, two refresh policies, two consent screens. Heavy.

### Provider matrix

For SREs deciding which integration to recommend per app:

| App pattern                                                  | Recommended                                  | Why                                                                        |
| ------------------------------------------------------------ | -------------------------------------------- | -------------------------------------------------------------------------- |
| Internal dashboard, no on-behalf API calls                   | (a) Google as Cognito federated IdP          | Single sign-in. Network-level gate. Org SSO native.                        |
| Internal dashboard, dev-tools-flavored (acts on user GitHub) | App-level Auth.js GitHub provider            | Cognito layer adds friction without value. Use the reference impl pattern. |
| Internal app calling Google Workspace APIs (Drive, Calendar) | (b) Google as Auth.js provider, with refresh | One sign-in. Direct token access.                                          |
| External-facing app, "log in with Google"                    | (b) Google as Auth.js provider               | Cognito only adds value for SaaS-style multi-tenancy.                      |
| Mixed: some users sign in with Google, some with GitHub      | App-level Auth.js with both providers        | Trivial: Auth.js supports many providers in one config.                    |

### Auth.js code-level swap (for reviewers familiar with the library)

GitHub → Google is a config diff, not a refactor. The `users` / `accounts` / `sessions` / `verification_tokens` schema is the same. The middleware allowlist gate becomes an email-domain check instead of a `github_login` lookup.

```typescript
// before (GitHub)
import GitHub from 'next-auth/providers/github';
providers: [
  GitHub({
    clientId: env.AUTH_GITHUB_ID,
    clientSecret: env.AUTH_GITHUB_SECRET,
    authorization: { params: { scope: 'repo' } },
  }),
];

// after (Google for org SSO)
import Google from 'next-auth/providers/google';
providers: [
  Google({
    clientId: env.AUTH_GOOGLE_ID,
    clientSecret: env.AUTH_GOOGLE_SECRET,
    authorization: { params: { hd: 'yourcompany.com' } },
  }),
];
```

That's literally the diff for an identity-only app.

### Operational implications

- **Refresh tokens.** Google access tokens expire in 1 hour. If the app calls Google APIs, Auth.js needs refresh-token rotation in the `jwt` callback. GitHub OAuth Apps don't expire access tokens (unless you opt into expiring tokens), so the reference impl skips refresh.
- **App verification.** Google requires "brand verification" + "app verification" if you want to leave testing mode (limited to ~100 testers). This is a Google-side process, can take 4-6 weeks. Plan ahead.
- **Workspace admin must allow third-party OAuth apps** for non-public clients. Talk to whoever runs your Workspace.
- **Cognito + Google federation requires advanced features tier** if you want the full attribute-mapping flexibility. The $0-floor pricing of Cognito assumes the basic tier, which has fewer federation knobs. Verify before recommending Cognito-federated Google to a team.

---

## 9. Out of scope / known limitations

- **HA / multi-AZ.** Single AZ. AZ failure = downtime until a new task starts in another AZ (EFS mount targets exist in both AZs, so this is just task-restart latency).
- **Database backups.** Manual `pg_dump` via ECS Exec. No PITR. No automated snapshots. **If your data is valuable, switch to RDS** (the +$13/mo upgrade path).
- **Concurrent-user scaling.** ~5 concurrent users is the design ceiling. Beyond that, split web from postgres into separate services, switch to RDS, consider task autoscaling.
- **Deploy-time downtime.** Single task means the postgres restarts on every web deploy. ~30s connection churn. If your app can't tolerate it, use the "split into two services" path.
- **No webhooks-in.** ALB + Cognito gates everything; webhook senders can't authenticate as a Cognito user. Solution: a path-based listener rule that bypasses Cognito for `/webhooks/*`, plus app-level signature verification. Reference impl doesn't need this; documented for adoption.
- **No file uploads to local disk** — fine since `/tmp` is ephemeral, but if your app needs persistent file storage beyond the DB, add S3.

---

## 10. Adoption checklist for a new app

Each new app following this pattern needs:

### Repo bootstrap

- [ ] `Dockerfile` (start from the reference impl's)
- [ ] `docker-compose.yml` (start from the reference impl's)
- [ ] `terraform/` directory (copy + replace app name)
- [ ] `.github/workflows/deploy-image.yml` and `deploy-infra.yml`
- [ ] Reference impl's `.env.example` template

### AWS prereqs (one-time per app, by central platform)

- [ ] GitHub OIDC trust policy in the account (if not already set up at account level)
- [ ] Domain registered in Route53 (or delegated subdomain)
- [ ] App team has access to `terraform/bootstrap.sh` execution

### App team

- [ ] Run `bootstrap.sh` once
- [ ] First `terraform apply`
- [ ] Create GitHub OAuth App (if using GitHub OAuth)
- [ ] Put values into Secrets Manager
- [ ] Add maintainer to Cognito user pool
- [ ] First deploy via image workflow
- [ ] Verify end-to-end: domain resolves, Cognito auth works, app loads, basic functionality works
- [ ] Set up cost alarm

### Per-app post-launch

- [ ] Set up CloudWatch alarms for ALB unhealthy hosts + error log filter
- [ ] Document allowlist management runbook for the app team
- [ ] Manual backup procedure tested and documented

---

## 11. FAQ

**Q: Is this multi-tenant?**

No. One stack per app per environment. If you need staging + production for a single app, that's two stacks (separate `terraform.tfvars`, separate domains, separate AWS resources).

**Q: How do you audit who deployed what?**

Every image is tagged with its commit SHA. ECS task definition revisions are immutable in the AWS console. CloudTrail captures every `UpdateService` call with the IAM principal. GitHub Actions logs show who triggered the workflow.

**Q: What about secret rotation?**

Manual today (`put-secret-value` + `force-new-deployment`). Secrets Manager supports automated rotation Lambdas if your org policy requires; the reference impl doesn't include them because the POC tier doesn't need them. The proposal recommends adding rotation Lambdas at the central platform level if rotating quarterly or more frequently is a requirement.

**Q: Can we use SSO?**

Yes — see section 8. Google as Cognito federated IdP is the cleanest path for "internal app via Workspace SSO." Or skip Cognito entirely and use Auth.js with the Google provider.

**Q: How do we log / alert?**

CloudWatch logs from the awslogs driver. Two streams (web + postgres) per task. Recommended baseline alarms: ALB unhealthy hosts, error log filter, account-level cost. SNS email + PagerDuty as needed.

**Q: What if the team grows out of it?**

Documented migration paths in [12](./12-proposal-software-stack.md#migration-paths) and [09](./09-cost-and-operations.md#concurrent-user--scaling-notes). The two biggest ones:

- **Postgres → RDS**: change the task definition + a Drizzle DSN, ~30 min of work.
- **Single task → split web + postgres**: rewire ECS services, add Service Connect or Cloud Map, ~half a day.

Neither is irreversible. The proposal explicitly tries to keep migration paths cheap.

**Q: Why not just use ECS Service Connect / App Mesh / Cloud Map for service-to-service?**

Because there's no service-to-service. Web and postgres are in the same task; they talk over `localhost`. As soon as you split them (the migration path above), you need one of these. Reference impl deliberately stays simple.

**Q: How do we handle compliance audits (SOC2, etc.)?**

This pattern as-is is **not compliance-ready.** Specific gaps: audit logging not enabled, no automated backups, no DR plan, single-AZ, no WAF. Add the missing pieces per your org's policy. The pattern is meant for internal-only / low-stakes external apps, not regulated workloads.

**Q: How do I update the pattern itself?**

Treat the reference impl as the canonical source. Apps that adopted the pattern can rebase against it; the SRE / platform team owns periodic refresh ("we now use Postgres 18", "switch to FargateSpot for non-prod", etc.). Document the rebase strategy when the second app adopts.

**Q: What about Spot / interruptible compute?**

Fargate Spot is ~70% cheaper but tasks can be terminated with 2 minutes notice. For a POC tier, the bigger problem isn't cost, it's that interrupting an in-flight 15-min review is bad UX. Stick with on-demand Fargate. Use Spot for non-interactive batch only.

**Q: Why not Kubernetes?**

If your org runs k8s already, this whole proposal is silly — use what you have. The pattern targets orgs without an established k8s footprint; ECS is the lower-ceremony default.
