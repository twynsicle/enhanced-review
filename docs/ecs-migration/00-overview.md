# 00 — ECS migration overview

**Status:** planning. **Audience:** the maintainer (Steven) and any future contributor walking into this work cold.

This is the index document for the migration of `enhanced-review` off PocketBase onto a Postgres + Next.js + AWS ECS stack. It captures the _why_, the _target architecture_, the _decisions made_, and the _order of work_. Every other doc in this folder is a sub-plan that elaborates one slice; this doc is the map.

If you only have time to read one file in this folder, read this one.

---

## Why this migration

Today, `enhanced-review` is a Next.js 16 monolith backed by PocketBase. PB does a lot — auth (GitHub OAuth), data store (SQLite), realtime SSE, and file uploads — all from a single binary. That's been great for local-only POC work but has three problems for the next phase:

1. **No deployable target.** PB's "single binary + filesystem" model doesn't fit cleanly into the AWS deployment patterns the user wants to demonstrate to their organization (see [11-proposal-lightweight-infra.md](./11-proposal-lightweight-infra.md)). Most of the org runs Postgres-shaped systems on ECS / Fargate, so the reference implementation should match.
2. **Auth + data are too coupled.** Swapping providers (e.g. Google for org SSO) or schema changes require touching PB-specific JSVM migrations and admin UI configuration that don't translate to other apps.
3. **No CD story.** There's no Dockerfile, no Terraform, no GitHub Actions deploy pipeline. The deployment piece is the most valuable artifact for the proposal docs, so we have to build it.

This is a personal POC; **no data migration is required** (the existing PB data can be dropped). That removes a huge class of complexity from the migration plan.

---

## Target architecture

```
                 ┌─────────────────────────┐
   Browser ──▶  │  ALB (HTTPS via ACM)    │  ──▶  Cognito hosted UI (only-me)
                 └────────────┬────────────┘
                              │ forwards w/ identity headers
                              ▼
                  ┌──────────────────────────┐
                  │   ECS Fargate task       │
                  │  ┌─────────┐ ┌─────────┐ │
                  │  │ Next.js │ │Postgres │ │
                  │  │  (web)  │ │(sidecar)│ │
                  │  └────┬────┘ └────┬────┘ │
                  │       │           │       │
                  │       └─localhost─┘       │
                  └───────────────┬──────────┘
                                  │
                                  ▼
                          ┌──────────────┐
                          │  EFS volume  │ Postgres data
                          └──────────────┘

   Outbound  → GitHub API + git clone + Anthropic API (public-subnet egress, no NAT)
   Secrets   → AWS Secrets Manager (injected into task env)
   CI/CD     → GitHub Actions → OIDC → IAM role → ECR push + ECS update OR Terraform apply
```

**One AWS region, one AZ, one task, one of every thing.** This is deliberate. A POC for one user has no need for multi-AZ, autoscaling, or HA. Every "what about X?" answer in this folder will lean on that constraint.

---

## Decisions log

These were made by the user during planning. Marked as **DECIDED** so future-you doesn't re-litigate them.

| #   | Question                 | Decision                                                    | Why / where to find more                                                |
| --- | ------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| D1  | Backend shape            | Keep Next.js monolith                                       | Smallest diff. Single web container.                                    |
| D2  | Auth library             | Auth.js v5 (NextAuth) + Drizzle adapter, keep GitHub OAuth  | Standard for Next.js 16 App Router. See [02](./02-auth-replacement.md). |
| D3  | DB toolkit               | Drizzle ORM + drizzle-kit migrations                        | Lightweight, SQL-first, typed. See [01](./01-postgres-data-layer.md).   |
| D4  | Realtime                 | SSE route handler backed by Postgres LISTEN/NOTIFY          | Lowest-latency replacement for PB realtime. See [03](./03-realtime.md). |
| D5  | Hosting                  | ECS Fargate, single task, two containers (web + postgres)   | Mid-cost, mid-complexity. Platform: [06a](./06a-platform.md) (cluster). App: [06b](./06b-application.md) (task def). |
| D6  | DB storage               | Postgres in container, EFS-backed volume                    | Acceptable I/O for POC traffic. See [06b](./06b-application.md).        |
| D7  | Access control           | Public ALB + Cognito user pool                              | Managed, AWS-native. Platform: [06a](./06a-platform.md). App: [06b](./06b-application.md) (per-app client + listener rule). |
| D8  | Domain / TLS             | Register a domain in Route53 (~$12/yr) + ACM cert           | Cleanest TLS path. Required by Cognito ALB integration.                 |
| D9  | Secrets                  | AWS Secrets Manager                                         | See [06b](./06b-application.md).                                        |
| D10 | GH Actions ↔ AWS         | OIDC federation                                             | No long-lived keys. See [07](./07-cd-image.md), [08](./08-cd-infra.md). |
| D11 | Subnet topology          | Public subnet for the Fargate task (no NAT Gateway)         | NAT is ~$32/mo and would dominate cost. ALB + SG handle exposure.       |
| D12 | Org-facing proposal docs | Write 11 (SRE) and 12 (engineer) after implementation lands | Claims need to be grounded in the working system. See plan Phase F.     |

Trade-offs flagged in the master plan but worth re-reading at execution time:

- **Deploys cause Postgres restarts.** Single-task layout couples them. Acceptable for POC; doc 06 spells out the upgrade path.
- **In-flight reviews are lost on deploy.** Default 30s SIGTERM grace can't drain a 15-min review. Document a manual "no jobs running → deploy" workflow. See [04](./04-job-runner-rewrite.md).
- **EFS is slower than EBS.** Workable for POC, would need RDS for serious traffic.
- **ALB cost is the biggest fixed line item** (~$18/mo). See [09](./09-cost-and-operations.md) for the kill-switch procedure when not in use.
- **Cognito + GitHub OAuth = two login layers.** Cognito gates the ALB; Auth.js handles GitHub identity inside the app. See [02](./02-auth-replacement.md).

---

## Doc index

### Implementation planning (00–10)

What to build for _this_ migration, scoped to this repo.

| Doc                                                              | What it covers                                                            |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **[00-overview.md](./00-overview.md)**                           | This file. Index, decisions, phase order.                                 |
| **[01-postgres-data-layer.md](./01-postgres-data-layer.md)**     | Drizzle schema, migrations, write-path migration checklist.               |
| **[02-auth-replacement.md](./02-auth-replacement.md)**           | Auth.js v5 setup, allowlist gate rewrite, Cognito layering.               |
| **[03-realtime.md](./03-realtime.md)**                           | SSE + LISTEN/NOTIFY pattern.                                              |
| **[04-job-runner-rewrite.md](./04-job-runner-rewrite.md)**       | Runner write paths, graceful shutdown, abort registry.                    |
| **[05-local-docker.md](./05-local-docker.md)**                   | Dockerfile, docker-compose, local dev flow.                               |
| **[06a-platform.md](./06a-platform.md)**                         | Shared Terraform module: VPC, cluster, ALB, Cognito pool, Route 53, ACM, ECR, OIDC. |
| **[06b-application.md](./06b-application.md)**                   | Per-app Terraform module: task, service, EFS, listener rule, scoped IAM, secrets. |
| **[07-cd-image.md](./07-cd-image.md)**                           | GitHub Actions image deploy pipeline.                                     |
| **[08-cd-infra.md](./08-cd-infra.md)**                           | GitHub Actions Terraform apply pipeline.                                  |
| **[09-cost-and-operations.md](./09-cost-and-operations.md)**     | Monthly cost, kill-switch, day-2 ops runbook.                             |
| **[10-existing-docs-updates.md](./10-existing-docs-updates.md)** | Edits to README, RUNNING, OPERATIONS, AGENTS.                             |
| **[phase-b-plan.md](./phase-b-plan.md)**                         | Phase B execution playbook: ordered commits, decisions log, verification. |
| **[phase-c-plan.md](./phase-c-plan.md)**                         | Phase C execution playbook: ordered commits, decisions log, verification. |
| **[phase-d-plan.md](./phase-d-plan.md)**                         | Phase D execution playbook: CD pipelines + first real image cutover.      |

### Org-facing proposals (11–12)

For pitching the pattern as a reusable template.

| Doc                                                                        | Audience                 | Purpose                                                          |
| -------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------- |
| **[11-proposal-lightweight-infra.md](./11-proposal-lightweight-infra.md)** | SREs, platform engineers | Pitch the AWS pattern; defend cost, security, ops decisions.     |
| **[12-proposal-software-stack.md](./12-proposal-software-stack.md)**       | Application engineers    | Pitch the libraries / patterns; show what fits and what doesn't. |

---

## Implementation phases

The 13 docs map onto six execution phases. Each phase ends in a working, demo-able state. The user can pause indefinitely between any two; phase F is "any time after E".

| Phase | Outcome                                                                                                                              | Docs covered   | Verify                                                         |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------- | -------------------------------------------------------------- |
| **A** | Local migration off PocketBase (Postgres + Drizzle + Auth.js + SSE) — `npm run dev` against docker-compose Postgres works end to end | 01, 02, 03, 04 | Sign in via GitHub, run a stub review, watch live view stream. |
| **B** | Containerize the app — `docker compose up` from a clean clone works                                                                  | 05             | Same end-to-end smoke test, but from the container.            |
| **C** | AWS infra via Terraform — manual `terraform apply` produces a working deploy                                                         | 06             | Visit the domain, log into Cognito, run a real review.         |
| **D** | CD pipelines — push-to-deploy works for image and infra                                                                              | 07, 08         | Push a benign change; new task running with new image SHA.     |
| **E** | Operations + docs — existing docs updated, cost runbook documented                                                                   | 09, 10         | Fresh-clone walkthrough of `RUNNING.md` succeeds.              |
| **F** | Proposal docs — SRE and engineer targets                                                                                             | 11, 12         | Self-review with a fresh eye; fact-check against system.       |

---

## Glossary — PocketBase concept ↔ Postgres + Auth.js equivalent

When reading PB-era code or docs, this is the cheat sheet.

| PocketBase                                              | Replacement                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `users` collection (built-in auth)                      | `users` table (Auth.js standard schema) + custom `github_login` column                |
| `_superusers` (admin auth)                              | None — server uses the same DB connection at full privilege; no separate admin        |
| `allowed_users` collection                              | `allowed_users` table                                                                 |
| `review_jobs`, `reviews`, `review_chunks` collections   | Same names as Postgres tables, JSONB for `target` / `content`                         |
| `pbServer()` (per-request, session-bound client)        | Auth.js `auth()` for session + Drizzle handle for queries                             |
| `pbAdmin()` (rule-bypassing admin client)               | Plain Drizzle handle (no rule layer; access control lives in route handlers)          |
| `pbBrowser()` (browser singleton, realtime SSE)         | `EventSource` against `/api/jobs/[id]/stream` + `useSession()` from `next-auth/react` |
| `pb.collection().subscribe(filter, cb)`                 | SSE handler holding a `pg.Client` doing `LISTEN job_<id>`                             |
| `pb.collection().authWithOAuth2()`                      | `signIn('github')` from `next-auth/react`                                             |
| `pb.authStore.loadFromCookie/exportToCookie`            | Auth.js manages `authjs.session-token` cookie automatically                           |
| `pb_data/settings.json` (OAuth client config)           | `AUTH_GITHUB_ID` + `AUTH_GITHUB_SECRET` env vars (from Secrets Manager)               |
| Collection access rules (`@request.auth.id != ""` etc.) | Per-route checks in handlers + middleware in `src/proxy.ts`                           |
| `pb_migrations/*.js` (JSVM)                             | `drizzle/*.sql` (drizzle-kit generated)                                               |
| `npm run pb` (start binary)                             | `docker compose up postgres` (or full stack)                                          |
| PB realtime SSE (`/api/realtime`)                       | App-owned SSE route at `/api/jobs/[id]/stream`                                        |

---

## Out of scope (for the migration)

These are deliberately not in this migration. They are noted so we can shut down the conversation if asked.

- Migration of existing PB data (POC restart; no data preservation)
- Multi-user support (still one allowlisted user; Cognito only "is this me?")
- Database backups beyond manual `pg_dump` ([09](./09-cost-and-operations.md) documents the manual procedure)
- Custom domain on Cognito hosted UI (uses Cognito-managed subdomain)
- Multi-region, multi-AZ, autoscaling
- WAF, Shield, advanced security beyond Cognito + SG allowlist
- Webhooks-in or write-back to GitHub PRs (intentional cuts vs. the diffy POC, preserved post-migration)
- Workspace mode (also intentional cut, preserved post-migration)

If you find yourself adding any of these, that's a separate plan.
