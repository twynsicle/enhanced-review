# Proposal: Software stack for lightweight web apps

> **Status:** draft. **Audience:** software engineers in the org evaluating libraries / patterns for a new internal app.
> **Reference implementation:** `enhanced-review` — a Next.js 16 + Postgres app deployed via the lightweight infra pattern in [11](./11-proposal-lightweight-infra.md).
> **TL;DR:** Next.js 16 App Router + TypeScript + Tailwind + shadcn/ui + Auth.js v5 + Drizzle + Postgres + pino. Default to this stack for any web app that's "small Next.js with auth + DB + a bit of streaming." This doc explains why, where it fits, and where to deviate.

---

## 1. What this stack is for

A small-to-medium web app with:

- **Server-rendered UI** (most pages render on the server, client interactivity sprinkled where needed).
- **A handful of routes** that talk to a relational DB.
- **OAuth-based auth** (GitHub, Google, etc.).
- **Long-running work** that needs to stream progress to the user (uploads, AI calls, builds, etc.).
- **One developer, one or two users** at the start; can grow to a few teams.

It is **not** for:

- High-traffic public sites (CDN + edge caching not configured here).
- Real-time multiplayer (no WebSockets, no CRDT story).
- Mobile apps (the BFF parts apply, but you'd want a separate frontend toolkit).
- Heavy ML / data pipelines (use Lambda + S3 / Step Functions instead).
- Microservices (single-process by design).

Pick a different stack for those. For everything in between, this stack hits the sweet spot of "you can ship in a week, you can maintain it for years, your future self isn't angry."

---

## 2. Stack at a glance

| Layer                     | Library / framework              | Role                                              |
| ------------------------- | -------------------------------- | ------------------------------------------------- |
| Runtime                   | Node 22                          | Standard JS runtime, ESM-native                   |
| Web framework             | **Next.js 16** (App Router)      | Server + client; routing; server actions; SSR/RSC |
| UI library                | React 19                         | Component model                                   |
| Styling                   | Tailwind CSS v4                  | Utility-first; v4 native CSS engine               |
| Component primitives      | shadcn/ui (on Radix)             | Accessible primitives, copied not depended-on     |
| Auth                      | **Auth.js v5** (NextAuth)        | OAuth, sessions, account storage                  |
| Auth adapter              | `@auth/drizzle-adapter`          | Sessions/users/accounts in Drizzle tables         |
| ORM                       | **Drizzle ORM**                  | Schema-as-code, typed queries, lightweight        |
| Migrations                | `drizzle-kit`                    | Generate + apply SQL migrations                   |
| DB driver                 | `pg` (node-postgres)             | Pool + per-stream `Client` for LISTEN             |
| Database                  | **Postgres 17**                  | Relational + JSONB + LISTEN/NOTIFY + full-text    |
| Logging                   | pino                             | Structured logs; child loggers per request/job    |
| Test runner               | Vitest                           | Vite-native; fast; good DX                        |
| Linting / formatting      | ESLint + Prettier                | Standard                                          |
| Container                 | Docker (multi-stage, Alpine)     | Reproducible deploys                              |
| Local stack               | docker-compose                   | Postgres + app for local dev                      |
| AI integration (optional) | `@anthropic-ai/claude-agent-sdk` | When the app needs an LLM agent                   |

The reference impl uses every line in this table. New apps should treat this as the default; deviate only if you have a specific reason.

---

## 3. Stack rationale (why each piece)

### Next.js 16 (App Router)

- **One framework for both server and client.** Server components for the default render path; client components for interactivity. No separate API service to deploy.
- **Server Actions and Route Handlers for backend.** No need for tRPC, Express, or Fastify for the kinds of apps this stack targets. Route handlers cover REST-style APIs; server actions cover form submissions.
- **Streaming is first-class.** Server-Sent Events via `ReadableStream` works inside route handlers; React's `<Suspense>` boundaries stream HTML. The reference impl uses both.
- **Turbopack is the default in 16.** Sub-second incremental builds; production builds in a fraction of the time of webpack-era Next.

When _not_ to choose Next.js:

- Pure static site → use Astro.
- Edge-runtime everywhere → Next has limits at the App Router level for some primitives; Hono on Cloudflare Workers may fit better.
- Backend-only API → use Hono or Fastify. Next.js carries frontend baggage you don't want.

### Auth.js v5 (with `@auth/drizzle-adapter`)

- **Standard for Next.js auth in 2026.** First-party support for App Router, route handlers, server actions, server components.
- **Many providers in one config block.** GitHub, Google, GitLab, Auth0, Cognito, custom OIDC, etc. Switching is a config diff, not a refactor.
- **Database sessions over JWT.** Lets you store provider tokens server-side (e.g. the user's GitHub access token) without exposing them to the client. JWT mode requires you to invent your own token store; database sessions plus the Drizzle adapter give you one out of the box.
- **Allowlist gate via the `signIn` callback.** Idiomatic place to enforce "only members of org X" or "only emails ending in @company.com." See [02](./02-auth-replacement.md) for the pattern.

When _not_ to choose Auth.js:

- B2B SaaS with org switching, SCIM, MFA, SSO certificates → use Clerk, WorkOS, or Stytch.
- Apps that don't need login → don't pull it in.
- Custom auth requirements (passwordless biometric flows, etc.) → may outgrow.

### Drizzle ORM (with drizzle-kit)

- **SQL-first.** Queries look like SQL. No "let's hide the database" magic.
- **Schema-as-code in TypeScript.** The schema _is_ the source of truth; types flow naturally. Generated migrations are plain SQL files you review.
- **Lightweight.** No engine binary, no codegen step that runs at boot. Adds ~1MB to the bundle.
- **First-class Auth.js integration.** `@auth/drizzle-adapter` reads/writes the four standard tables.
- **Postgres-rich.** JSONB, partial indexes, generated columns, custom enums, all expressible in the schema.

When _not_ to choose Drizzle:

- Strong preference for an active-record / "look mom, no SQL" style → Prisma.
- You hate writing schemas in TypeScript → Knex, Kysely, or raw SQL.
- You're allergic to TypeScript codegen of any kind → raw SQL via `pg`.

### Postgres 17

- **Relational + JSONB.** You get the schema rigor where you want it (`users.id`, `email`) and the flexibility where you don't (`review_jobs.target`, `reviews.content`). The reference impl leans hard on JSONB for evolving payloads.
- **LISTEN/NOTIFY.** Built-in pubsub. The reference impl uses it for SSE-backed real-time updates without adding Redis.
- **Full-text search.** `tsvector` + `tsquery` is good enough for most internal-app needs.
- **`gen_random_uuid()`.** No app-side UUID library needed.

When _not_ to choose Postgres:

- Heavy denormalized writes / huge time series → DynamoDB or ClickHouse.
- Truly key-value workloads → DynamoDB or Redis.
- You need vector search at scale → pgvector for small, dedicated stores for big.

### Tailwind v4 + shadcn/ui

- **Tailwind v4** uses a new native CSS engine; massive perf jump over v3. Same DX.
- **shadcn/ui** is a set of accessible Radix-based components you copy into your repo. You own them. No upgrade-the-library treadmill; if you need to customize a Dialog, edit the file. Has a CLI to add new components on demand.

When _not_ to choose:

- Design-system-heavy product where consistency >> velocity → Stitches, Vanilla Extract, or a custom token system.
- Utility CSS allergy → Mantine, Chakra, Mui.

### pino

- Structured JSON logs, child loggers, low overhead.
- Plays nicely with CloudWatch (the awslogs driver ingests stdout); no additional shipper needed.
- Pretty-prints in dev with `pino-pretty`.

### Vitest

- Vite-native, hot test reload, ESM-native, smart test parallelization.
- Mocking story is solid.
- `test/server-only.shim.ts` trick (already in this repo) lets us unit-test server-only modules.

---

## 4. Patterns demonstrated by the reference app

Code pointers for each. Drop into the codebase to see how it's done.

### Server components + targeted client components

`src/app/page.tsx` is a server component; the composer that launches a job is a client component (`use client` boundary). Default to server; lift to client only where you need state, refs, event handlers, or browser APIs.

### Route handlers vs server actions

- **Route handlers** for endpoints called from the browser (SSE, JSON APIs the SPA-style parts call): `src/app/api/jobs/route.ts`.
- **Server actions** for form submissions and mutations triggered by user interaction: not heavily used in the reference impl yet, but the pattern is "imported async function annotated with `'use server'`, called from a client component."

Rule of thumb: **server actions for human-triggered mutations, route handlers for background or programmatic calls.**

### In-process fire-and-forget job runner with AbortController registry

`src/app/api/jobs/route.ts` + `src/lib/jobs/runner/registry.ts`. The handler registers an AbortController, kicks off `runJob()` without awaiting, returns the job ID. Cancel route signals the controller; the runner observes `signal.aborted`.

**When this pattern fits:** jobs that take seconds-to-minutes, fire-and-forget, OK to lose on container restart with a recovery pass.

**When it doesn't:** longer jobs (>15 min), jobs that must be retried, jobs that span machines. Move to a queue (BullMQ + Redis, or AWS SQS + a worker task).

### SSE backed by Postgres LISTEN/NOTIFY

`src/app/api/jobs/[id]/stream/route.ts` (per the design in [03](./03-realtime.md)). The handler:

1. Snapshots current state (`SELECT`).
2. Acquires a dedicated `pg.Client` (not pooled) and calls `LISTEN job_<id>`.
3. Streams notifications as SSE events.
4. Cleans up on `req.signal.abort`.

The runner emits via `pg_notify` after each chunk insert.

This pattern replaces:

- Polling
- WebSockets
- Adding Redis or another pubsub

**When this pattern fits:** one-way server-to-client streaming where you want sub-second latency and don't want to run a message broker.

**When it doesn't:** bidirectional realtime (chat), high-fanout (many subscribers per channel — multiplex on the server). For high fanout, multiplex many SSE subscribers onto a single LISTEN connection with an in-memory broadcast.

### Drain-before-done write ordering for streaming work

In the reference impl, the runner inserts chunks via fire-and-forget DB writes, but **always** awaits all in-flight chunk writes before flipping `status = 'done'`. This guarantees: a subscriber that sees `status = 'done'` has already seen every chunk.

The pattern: keep a `Promise<unknown>[]` of in-flight writes; before terminal status, `await Promise.allSettled(inFlight)`. See `src/lib/jobs/runner/run.ts`.

### Single allowlist gate in `proxy.ts`

Next.js middleware (renamed `proxy.ts` in v16) is a single chokepoint for "is this request from someone allowed?" Auth.js wraps it; we layer in a Drizzle query to check the allowlist table. See [02](./02-auth-replacement.md).

### Drizzle JSONB columns for flexible payloads

`review_jobs.target` (different shapes for PR vs branch reviews) and `reviews.content` (the full narrative review structure) are JSONB. Strongly typed via Drizzle's `.$type<T>()`. Adding fields is a TypeScript change, not a migration.

When to use JSONB: payloads that are read together, written together, and rarely queried by inner fields. When to use real columns: things you query / index / aggregate on.

### Container-startup migrations

Web container's entrypoint runs `drizzle-kit migrate` before booting Next.js. Ensures every deploy lands in a known schema state. See [05](./05-local-docker.md).

When _not_ to do this: long migrations (multi-minute) — split into a one-off ECS task or init container.

### HttpOnly session cookies + DB-backed sessions

Auth.js sets `authjs.session-token` as HttpOnly, secure, sameSite=lax. The cookie is just a random ID; the actual session lives in the `sessions` table. Logout = delete the row.

This means you can revoke a session server-side (not possible with stateless JWT). Useful for "kick the user off all devices."

---

## 5. Patterns NOT demonstrated (and how to add)

Things the reference impl doesn't show, with hints about what to reach for:

### Background queues / multi-step workflows

Reach for **BullMQ + Redis** (run Redis as a sidecar in the same Fargate task, or as a separate ECS service, or hosted ElastiCache for HA). BullMQ gives you retries, backoff, scheduled jobs, job priorities. Adds operational weight (~$10-20/mo for Redis); only adopt when the in-process runner pattern stops fitting.

### File uploads / blob storage

S3 + presigned URLs. Generate the URL on the server, give it to the client, the client `PUT`s directly to S3. Don't proxy file bytes through your container.

### Full-text search beyond what Postgres `tsvector` does

Postgres FTS is fine for ~99% of internal-tool needs. Beyond that: Meilisearch (self-hosted, simple) or Algolia (hosted, expensive but excellent).

### Caching beyond Postgres

When you've measured a query that's actually slow:

- **In-process LRU** (`lru-cache` package). Survives only for the task lifetime; that's often enough.
- **Redis**: when in-process can't share state across instances. We don't run multiple instances yet, so this is rarely needed.

### WebSockets

For bidirectional realtime (chat, multi-cursor editing). Add a separate WS server or use a library like `socket.io` over a sticky-session-enabled ALB. Heavy. Avoid until you really need it.

### Webhooks-in

External services calling your app (GitHub webhooks, Stripe events, etc.). Add a path-based listener rule on the ALB that bypasses the Cognito auth action for `/webhooks/*`, and verify signatures app-side. Documented in [11](./11-proposal-lightweight-infra.md) section 9.

### Multi-tenant data isolation

Single-tenant by default. For multi-tenant: every query gets a `WHERE tenant_id = ?` clause, enforced via a Drizzle helper that wraps the DB handle. Or use Postgres Row-Level Security with a per-request session variable.

### Background scheduled tasks

ECS Scheduled Tasks (basically: ECS task triggered by EventBridge). One-shot tasks that run, do their thing, and exit. Cheap. Use this for nightly cleanups, weekly reports, etc.

---

## 6. Auth alternatives — Google OAuth for org SSO (engineer angle)

(See [11](./11-proposal-lightweight-infra.md) section 8 for the SRE-side framing. This section is for engineers wiring up code.)

The reference implementation uses GitHub OAuth because the app calls GitHub APIs on the user's behalf (cloning repos, fetching PRs). For most internal apps that just need "is this person signed into our org?", **Google OAuth is the better default.**

### What changes in code

**Schema:** nothing. The Auth.js Drizzle adapter writes the same `users`/`accounts`/`sessions`/`verification_tokens` tables for any provider. Adding Google later (or alongside) doesn't require a migration.

**`auth.ts` config:**

```typescript
// Just GitHub (reference impl)
import GitHub from 'next-auth/providers/github';
providers: [
  GitHub({
    clientId: process.env.AUTH_GITHUB_ID,
    clientSecret: process.env.AUTH_GITHUB_SECRET,
    authorization: { params: { scope: 'repo read:user user:email' } },
  }),
],

// Just Google (org SSO)
import Google from 'next-auth/providers/google';
providers: [
  Google({
    clientId: process.env.AUTH_GOOGLE_ID,
    clientSecret: process.env.AUTH_GOOGLE_SECRET,
    authorization: { params: { scope: 'openid email profile', hd: 'yourcompany.com' } },
  }),
],

// Both (let the user pick)
providers: [
  GitHub({ ... }),
  Google({ ..., authorization: { params: { hd: 'yourcompany.com' } } }),
],
```

**Allowlist semantics:** if you used a `github_login`-based allowlist for GitHub, you'd switch to an `email` or `email_domain` check for Google:

```typescript
// before
async signIn({ user }) { return await isAllowed((user as any).githubLogin); }

// after (Google domain-restricted)
async signIn({ user }) {
  return user.email?.endsWith('@yourcompany.com') ?? false;
}
```

The `hd` parameter on the Google authorize URL already restricts the consent screen to a domain, but server-side checking is defense in depth.

**Sign-in UX:** `signIn('github')` becomes `signIn('google')` (or `signIn()` with no args opens a provider chooser if you have multiple).

**Middleware:** unchanged. The proxy/middleware reads the session, doesn't care which provider authenticated it.

**Runner / data layer / SSE / everything else:** unchanged.

### Refresh tokens

GitHub OAuth Apps issue access tokens that don't expire (default behavior). Google access tokens expire in 1 hour. **If your Google-using app calls Google APIs on behalf of the user, you need refresh-token rotation.**

Auth.js v5 supports it via the `jwt` callback when using JWT sessions, or via the `accounts` table for database sessions. Documented at <https://authjs.dev/guides/refresh-token-rotation>.

If your app is identity-only (just SSO), refresh tokens don't matter — you only need the user's identity at login time.

### When to layer Cognito on top

Cognito + Auth.js Google is "two SSO layers." Useful when:

- You want network-level access control (Cognito) **and** in-app identity (Auth.js) for different reasons.
- You want the ALB to drop unauthenticated requests early (cheap, no app cycles burned on bots).

Skippable when:

- The app is identity-only and you trust Auth.js's gate to be sufficient.
- You don't want to pay the Cognito-tier upgrade for federated IdPs.

The reference impl uses both because GitHub OAuth doesn't naturally restrict to "people in our org" the way Google's `hd` does.

### Multi-provider apps

Auth.js supports multiple providers in one config. Common pattern: **Google for primary auth, GitHub for "link your dev account too."** The user's `accounts` table gets two rows (one per provider); the runner can pull the GitHub token if it exists, fall back to "no GitHub-side functionality" otherwise.

```typescript
// In a route handler that needs to call GitHub
const ghAccount = await db
  .select()
  .from(accounts)
  .where(and(eq(accounts.userId, session.user.id), eq(accounts.provider, 'github')))
  .limit(1);
if (!ghAccount[0]) return new Response('Link a GitHub account first', { status: 400 });
const token = ghAccount[0].access_token;
```

Clean separation between "who is this person" (primary provider) and "what tokens does this person have" (per-provider rows).

---

## 7. DX flow

### Local development (Flow 1: full stack in compose)

```bash
git clone ...
cp .env.example .env.local      # fill in OAuth + Anthropic
docker compose up --build       # boots postgres + web; runs migrations
# open http://localhost:3000
```

First boot: ~3 minutes (image build + migration run). Subsequent: ~10 seconds for compose, ~1s for incremental Next.js rebuilds.

### Local development (Flow 2: postgres in compose, Next on host)

For fast iteration with React fast-refresh:

```bash
docker compose up postgres
DATABASE_URL=postgres://app:localdevpw@127.0.0.1:5432/enhanced_review npm run dev
```

Hot reload via Turbopack; sub-second from save to refresh.

### Adding a new model

1. Edit `src/lib/db/schema.ts` — add a `pgTable` definition.
2. `npm run db:generate` — drizzle-kit produces `drizzle/NNNN_xxx.sql`.
3. Review the SQL. Commit both schema source and generated SQL.
4. `npm run db:migrate` — applies locally.
5. Use the new table in queries.

On deploy: container start runs migrations automatically.

### Adding a new OAuth provider

1. Get client credentials from the provider.
2. Add to Secrets Manager:
   ```
   aws secretsmanager put-secret-value --secret-id app/auth-NEWPROVIDER-id --secret-string "..."
   aws secretsmanager put-secret-value --secret-id app/auth-NEWPROVIDER-secret --secret-string "..."
   ```
3. Update `terraform/secrets.tf` to declare the secrets, `terraform/ecs.tf` task def `secrets[]` to inject them, `terraform/iam.tf` task execution role to allow reading them.
4. Edit `src/lib/auth/auth.ts` — add `provider` to the `providers` array.
5. Edit the sign-in UI — add a button calling `signIn('newprovider')`.
6. Update OAuth callback URL on the provider's side: `https://yourdomain.com/api/auth/callback/newprovider`.

### Debugging SSE locally

```bash
curl -N -H "Cookie: authjs.session-token=..." http://localhost:3000/api/jobs/abc/stream
```

`-N` disables curl buffering so events stream live. Verify the heartbeat (`: hb`) every 15s.

### Debugging Auth.js callbacks

Auth.js exposes a `debug: true` option (in non-prod). Spits per-step logs. Helpful when the OAuth dance is broken.

```typescript
NextAuth({ ..., debug: process.env.NODE_ENV !== 'production' });
```

### Database introspection

```bash
docker compose exec postgres psql -U app -d enhanced_review
# or
npm run db:studio    # drizzle-kit studio (GUI in browser)
```

---

## 8. Testing posture

The reference impl's testing is currently:

- **Vitest unit tests** for pure logic (the executor stub, narrative parsing, concurrency cap, etc.).
- **`server-only.shim.ts`** lets us unit-test server-only modules.
- **No integration tests yet.**
- **No e2e tests yet.**

Recommended additions for any app following this pattern:

- **Integration tests with a real Postgres** — `docker run --rm -d postgres:17-alpine`, point Drizzle at it, run a fixed migration, run tests, tear down. Vitest globalSetup hook handles this.
- **E2E tests with Playwright** — pointed at a docker-compose'd stack. CI matrix: spin up compose, run Playwright, tear down. Slow but high-signal.
- **Snapshot tests for SSR HTML** — using Vitest + `@testing-library/react` + Vitest's built-in snapshot.

---

## 9. Migration paths

When you outgrow this stack — explicit signposts:

### Outgrowing the in-process runner

**Symptom:** jobs are >15min, OR you need retries with backoff, OR you have multiple instances and need shared state, OR you need cross-task scheduling.

**Migration:** introduce BullMQ + Redis (or AWS SQS + a worker Fargate task). The runner becomes a worker that pulls from the queue; the API only enqueues. ~1 day of work.

### Outgrowing Postgres-in-task

**Symptom:** data is valuable enough to need backups, OR DB grows past ~5 GB, OR EFS latency hurts user experience.

**Migration:** Switch to RDS db.t4g.micro. Change `DATABASE_URL` to point at the RDS endpoint; remove the `postgres` container and `pgdata` volume from the task definition. Run `pg_dump` from the old → restore to RDS. ~1 hour of work for the swap; backup/restore depends on data size.

### Outgrowing the single Fargate task

**Symptom:** web deploys cause too much DB-restart pain, OR you want to scale web horizontally without scaling DB, OR you want HA across AZs.

**Migration:** split into two ECS services (web + postgres). Use ECS Service Connect for service discovery. Web service goes to `desired_count = 2+`; postgres stays at 1 with EFS. ~half a day of Terraform work.

### Outgrowing Auth.js DB sessions

**Symptom:** you need shared sessions across multiple deployments, OR you want SAML / SCIM / advanced enterprise SSO, OR Auth.js's customization is fighting you.

**Migration:** Move auth to Cognito / Clerk / WorkOS as the source of truth. Auth.js becomes a thin OIDC client to that. Or drop Auth.js and rely entirely on the ALB-Cognito gate. Half-day to a day of work.

### Outgrowing Next.js

**Symptom:** rare; usually the app outgrows in a specific dimension (need a separate native mobile app, need an API consumed by partners, etc.).

**Migration:** Split Next.js into a frontend (Next or Astro or React) + a backend (Hono, Fastify, NestJS). Most of the data-layer code is portable as-is.

---

## 10. FAQ

**Q: Why not Prisma?**

Drizzle's SQL-first style is a better fit for "I want to know what query just ran." Prisma's engine binary adds ~50 MB to the container and adds a startup step. Drizzle is genuinely lighter. Both work; this stack picks Drizzle.

**Q: Why not tRPC?**

Server actions in Next.js 16 cover tRPC's biggest use case (typed RPC from client to server). Using tRPC alongside Next.js is a reasonable choice; it's just more dependencies. The reference impl skips it; if you have a complex API surface, tRPC is solid.

**Q: When should I use server actions vs route handlers?**

- **Server actions** for human-triggered mutations (form submissions, button clicks). They handle CSRF protection automatically and integrate with React's `useTransition`.
- **Route handlers** for programmatic / streaming endpoints (SSE, machine-to-machine, JSON APIs called by client-side fetch).

If both feel fine, prefer server actions — they're more idiomatic Next.js 16.

**Q: Why not Auth.js v4?**

v4 is fine but has been superseded. v5 is the active line, with App Router support being far better.

**Q: Why not Lucia?**

The Lucia author has put the library in maintenance mode and recommends rolling your own using their patterns. Reasonable for some projects; for a default stack, Auth.js's "broad ecosystem support" wins.

**Q: Why not Better-Auth?**

Newer (2024). Excellent. If you want a leaner alternative to Auth.js, it's the closest competitor. The reference impl picks Auth.js for ecosystem maturity, but Better-Auth would be a defensible choice. Don't switch back and forth between projects, though — pick one per app and stick with it.

**Q: Why Postgres 17 specifically?**

Latest stable. JSONB improvements, MERGE statements, better LISTEN/NOTIFY perf. 16 also works.

**Q: How do I add a new model?**

See section 7 ("Adding a new model"). 5 steps; 5 minutes if the schema's simple.

**Q: How do I add a new OAuth provider?**

See section 7 ("Adding a new OAuth provider"). The hard part is provider-side setup; code-side is a config-block addition.

**Q: Can I use this stack without ECS?**

Yes. The whole software stack runs anywhere a Docker container does — Render, Fly.io, Railway, ECS, Kubernetes, a friend's Raspberry Pi. The infra proposal in [11](./11-proposal-lightweight-infra.md) is independent of this software stack.

**Q: How do I write integration tests against a real Postgres?**

Vitest `globalSetup` that boots a docker container, runs migrations, sets `DATABASE_URL` for the test process, tears down on completion. Pattern is documented in [Vitest's docs](https://vitest.dev/config/#globalsetup); reference impl will add this in a follow-up.

**Q: How do I handle file uploads?**

S3 presigned URLs. The reference impl doesn't have this yet; if you add it: generate URLs in a server action / route handler, return to the client, the client `PUT`s directly to S3. Don't proxy file bytes through your container — that's slow and burns CPU.

**Q: How do I add observability beyond logs?**

OpenTelemetry SDK + a backend (Honeycomb, Datadog, AWS X-Ray, Jaeger). Auto-instrumentation for Next.js exists. Recommended once you've got users; out of scope for the reference impl.

**Q: Where are my types?**

Drizzle infers from the schema; Auth.js infers from the providers config; Next.js infers from the route handler signatures. If TypeScript can't figure something out, that's a sign the abstraction's wrong — push back, don't paper over with `as any`.
