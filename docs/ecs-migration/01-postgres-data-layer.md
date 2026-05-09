# 01 — Postgres data layer

Replaces every PocketBase data operation with Drizzle ORM against Postgres. The schema, the migrations, the connection management, and a checklist of every PB call site to rewrite.

This doc is the foundation; doc [02](./02-auth-replacement.md) extends the schema with Auth.js's tables, doc [03](./03-realtime.md) builds on the connection pattern for LISTEN/NOTIFY, and doc [04](./04-job-runner-rewrite.md) rewires the job runner against this.

---

## Decisions feeding into this doc

- **D3** Drizzle ORM + drizzle-kit migrations
- **D6** Postgres in-container, EFS-backed
- **No data migration** — POC restart, drop existing PB data

---

## Schema

Drizzle schema lives at `src/lib/db/schema.ts`. One file, all tables. SQL emitted via `drizzle-kit generate` into `drizzle/`. We commit both schema source and generated SQL.

### Tables and their PB origins

| Postgres table        | PB origin                      | Notes                                                                                                     |
| --------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `users`               | PB `users` (built-in auth)     | Auth.js standard fields + custom `github_login`. See [02](./02-auth-replacement.md).                      |
| `accounts`            | (PB stored OAuth in `pb_auth`) | Auth.js standard. Holds the GitHub access/refresh tokens, replaces the `gh_access_token` HttpOnly cookie. |
| `sessions`            | (PB `pb_auth` cookie payload)  | Auth.js standard. We use database sessions, not JWT.                                                      |
| `verification_tokens` | (none)                         | Auth.js standard. Unused for OAuth-only flows but kept to satisfy the adapter contract.                   |
| `allowed_users`       | PB `allowed_users`             | Same shape: `github_login` (unique) + `created_at`.                                                       |
| `review_jobs`         | PB `review_jobs`               | All current fields; `target` and `error_message` as JSONB / text. `status` as Postgres enum.              |
| `reviews`             | PB `reviews`                   | `content` as JSONB (the `NarrativeReview` shape).                                                         |
| `review_chunks`       | PB `review_chunks`             | Same shape, unique on `(job_id, seq)`.                                                                    |

### Schema sketch (canonical version lives in `src/lib/db/schema.ts`)

```typescript
import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  jsonb,
  integer,
  boolean,
  primaryKey,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

// Auth.js standard tables — see https://authjs.dev/getting-started/adapters/drizzle
export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    name: text('name'),
    email: text('email').unique(),
    emailVerified: timestamp('email_verified', { mode: 'date' }),
    image: text('image'),
    // custom
    githubLogin: text('github_login'),
  },
  (t) => ({
    githubLoginUnique: uniqueIndex('users_github_login_unique').on(t.githubLogin),
  }),
);

export const accounts = pgTable(
  'accounts',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.provider, t.providerAccountId] }),
  }),
);

export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
});

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.identifier, t.token] }),
  }),
);

// App tables
export const allowedUsers = pgTable('allowed_users', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  githubLogin: text('github_login').notNull().unique(),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
});

export const jobStatus = pgEnum('job_status', ['pending', 'running', 'done', 'error', 'cancelled']);

export const reviewJobs = pgTable(
  'review_jobs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    githubLogin: text('github_login').notNull(),
    target: jsonb('target').notNull().$type<TargetSpec>(),
    status: jobStatus('status').notNull(),
    headSha: text('head_sha'),
    startedAt: timestamp('started_at', { mode: 'date', withTimezone: true }),
    completedAt: timestamp('completed_at', { mode: 'date', withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { mode: 'date', withTimezone: true }),
    errorMessage: text('error_message'),
    riskScore: integer('risk_score'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byStatus: index('review_jobs_status_idx').on(t.status),
    byUser: index('review_jobs_user_idx').on(t.userId),
    byCreated: index('review_jobs_created_idx').on(t.createdAt),
  }),
);

export const reviews = pgTable('reviews', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  jobId: text('job_id')
    .notNull()
    .unique()
    .references(() => reviewJobs.id, { onDelete: 'cascade' }),
  content: jsonb('content').notNull().$type<NarrativeReview>(),
  diffTruncated: boolean('diff_truncated').notNull().default(false),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
});

export const reviewChunks = pgTable(
  'review_chunks',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    jobId: text('job_id')
      .notNull()
      .references(() => reviewJobs.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byJobSeq: uniqueIndex('review_chunks_job_seq_unique').on(t.jobId, t.seq),
  }),
);
```

> `TargetSpec` and `NarrativeReview` come from `packages/review-types/`. Kept separate from the schema file so the type lives with the contract.

### Constraints worth re-stating

- `review_jobs.id`: kept as a string-typed UUID for parity with PB's 15-char IDs. Any URL-mounted ID is opaque to the client, so swapping format is fine.
- `reviews.job_id`: **unique** — enforces one review per job (matches PB's unique index `idx_reviews_job`).
- `review_chunks.(job_id, seq)`: **unique** — enables idempotent chunk inserts (the runner relies on this to make duplicate writes harmless).
- `users.github_login`: unique. Matches the existing partial-unique index pattern.
- `allowed_users.github_login`: unique. Same as today.

### Status updates: who can write?

PB used collection rules to enforce `update only if status in ('pending', 'running')` for the cancel route. We move that into the route handler, not the schema. Postgres has no native "row rules" equivalent that's worth using here; a `WHERE status IN ('pending', 'running')` clause on the cancel UPDATE is the simplest form.

```sql
UPDATE review_jobs
SET status = 'cancelled', cancelled_at = now()
WHERE id = $1
  AND user_id = $2
  AND status IN ('pending', 'running')
RETURNING id;
```

If `RETURNING` produces zero rows, the cancel handler returns 409. Same effective behavior as the PB rule, no extra layer.

---

## Migration tooling

`drizzle-kit` produces SQL migration files under `drizzle/`. We commit them. They run on container start.

### Local dev workflow

```bash
# After editing src/lib/db/schema.ts:
npx drizzle-kit generate     # creates drizzle/NNNN_xxx.sql
git add drizzle/             # commit the generated SQL alongside the schema change

# To apply against a running DB:
npx drizzle-kit migrate      # applies pending migrations
```

### Container start

The web container's entrypoint runs migrations before booting Next.js:

```sh
#!/bin/sh
set -e
node -e "require('./drizzle/migrate.js')"  # wraps drizzle-orm/node-postgres/migrator
exec node server.js
```

Failure mode: if migrations fail, the web container exits and ECS retries (deployment circuit breaker eventually rolls back). The Postgres sidecar is unaffected — it stays up with the previous schema.

> **Trade-off:** running migrations in the web container means a long-running migration blocks the deploy. For this POC's scale (tiny tables, no data) that's fine. If migrations get expensive, switch to an ECS one-off task or an init container.

### Handling destructive migrations

Drizzle generates DROPs for removed columns/tables. For a POC, we'll allow them. For org-wide adoption ([11](./11-proposal-lightweight-infra.md)), the proposal calls out that destructive migrations should be reviewed in PR.

---

## Connection management

`src/lib/db/client.ts` — singleton pool + a Drizzle handle.

```typescript
import 'server-only';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // POC traffic; ALB → 1 task → 1 user
  idleTimeoutMillis: 30_000,
});

export const db = drizzle(pool, { schema });
export { pool };
```

`DATABASE_URL` format: `postgres://app:<password>@127.0.0.1:5432/enhanced_review` (sidecar Postgres on the same task; password from Secrets Manager).

### LISTEN/NOTIFY connections (preview)

`pg.Pool` is not safe for `LISTEN` because connections rotate. The SSE handler uses a dedicated `pg.Client` per subscription — see [03-realtime.md](./03-realtime.md). The pool above is for normal queries only.

### Transactions

We rarely need them. The runner write paths (chunk inserts) are idempotent thanks to the unique constraint, so retries are safe. The one place we do want a transaction is the job-create + concurrency-check sequence in `POST /api/jobs`:

```typescript
await db.transaction(async (tx) => {
  const count = await tx
    .select({ n: sql`count(*)::int` })
    .from(reviewJobs)
    .where(and(eq(reviewJobs.userId, userId), inArray(reviewJobs.status, ['pending', 'running'])))
    .then(rows => rows[0]?.n ?? 0);
  if (count >= maxJobsPerUser()) throw new ConcurrencyError();
  return tx.insert(reviewJobs).values({ ... }).returning();
});
```

PB didn't have transactions, so the current code has a benign race: two simultaneous `POST /api/jobs` could both pass the concurrency check. The Drizzle-on-Postgres version closes that, with no real cost.

---

## Write-path migration checklist

Every PB call site, what it does, what it becomes. Use this as the line-by-line task list when executing Phase A. File:line refs are from the audit report at the time of planning; verify before editing.

### Server-only modules being deleted

| File                    | Action                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| `src/lib/pb/admin.ts`   | Delete. Replaced by `src/lib/db/client.ts` (no auth-token concept; all queries are full-priv). |
| `src/lib/pb/client.ts`  | Delete. Replaced by Auth.js `auth()` for session + Drizzle for data.                           |
| `src/lib/pb/browser.ts` | Delete. Replaced by `useSession()` hook + `EventSource` for streaming.                         |
| `src/lib/pb/session.ts` | Delete. `getCurrentUser()` becomes `auth()` from `src/lib/auth/auth.ts`.                       |

### Server-side rewrites

| Site                                                | Was (PB)                                                                                               | Becomes (Drizzle)                                                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `src/app/api/jobs/route.ts:66,98,117`               | `pbAdmin().create / getList / update`                                                                  | Concurrency-check transaction + insert; timeout-error update via `db.update(reviewJobs)...`                                            |
| `src/app/api/jobs/[id]/cancel/route.ts:44,46`       | `pbServer().update` with rule-enforced state check                                                     | `db.update(reviewJobs).set({ status: 'cancelled', cancelledAt: now }).where(... AND status IN ('pending','running')) RETURNING id`     |
| `src/app/api/jobs/[id]/rerun/route.ts:44,69,84,118` | `pbServer` for session, `pbAdmin().getOne` (source job), `pbAdmin` in-flight check, `pbAdmin().create` | Mirror POST `/api/jobs`: `auth()` for session, Drizzle SELECT for source target, transactional concurrency check + insert.             |
| `src/app/api/health/route.ts:64,72,86`              | `pbAdmin().getList` × 3 (count by status, oldest pending, errors last 24h)                             | Three Drizzle queries returning the same response shape: `count(*)::int` for the counts, `ORDER BY created_at LIMIT 1` for the oldest. |
| `src/app/api/auth/post-signin/route.ts:67,127`      | Verify PB session, write `users.github_login` via admin                                                | Deleted. Auth.js handles backfill via the GitHub provider's `profile` callback (see [02](./02-auth-replacement.md)).                   |
| `src/app/api/auth/sign-out/route.ts`                | Delete cookies                                                                                         | Deleted. Replaced by `signOut()` from `next-auth/react` + Auth.js `/api/auth/signout` route.                                           |
| `src/lib/auth/allowlist.ts:32`                      | `pbAdmin().getFirstListItem('github_login = "..."')`                                                   | `db.select().from(allowedUsers).where(eq(allowedUsers.githubLogin, login)).limit(1)` — fail-closed on empty result.                    |
| `src/lib/jobs/concurrency.ts:43`                    | `pbAdmin().getList(... status filter)`                                                                 | `db.select({ n: count() }).from(reviewJobs).where(... user + status in pending                                                         | running)`. |
| `src/lib/jobs/runner/run.ts:140,205,231,250,257`    | `pbAdmin()` calls                                                                                      | All become `db.update / db.insert` calls. Drain-before-done preserved (see [04](./04-job-runner-rewrite.md)).                          |
| `src/lib/jobs/runner/writes.ts:7,19,29,34,43`       | `pb.collection().create/update`                                                                        | Drizzle equivalents. Add `pg_notify('job_<id>', ...)` after each (see [03](./03-realtime.md)).                                         |
| `src/proxy.ts:110,146`                              | New PB instance + `getFirstListItem`                                                                   | Auth.js `auth()` to resolve session + Drizzle allowlist query (see [02](./02-auth-replacement.md)).                                    |
| `src/app/page.tsx:17,18,23`                         | `pbServer()` + avatar URL via PB                                                                       | `auth()` for session; image comes from `users.image` (set by Auth.js GitHub provider).                                                 |
| `src/app/history/page.tsx:47`                       | PB getList review_jobs                                                                                 | Drizzle paginated query.                                                                                                               |
| `src/app/reviews/[id]/page.tsx:54,67,148`           | PB getOne / getFirstListItem / file URL                                                                | Drizzle queries; no file URL (we drop PB-served avatars).                                                                              |
| `src/app/jobs/[id]/page.tsx`                        | PB getOne + getFullList                                                                                | Drizzle queries; passes initial state to client component.                                                                             |
| `src/components/home/recent-reviews.tsx:23,39,42`   | PB getList + avatar URL                                                                                | Drizzle queries; avatar from `users.image`.                                                                                            |

### Client-side rewrites

These shift to SSE + `useSession()`. See [02](./02-auth-replacement.md) and [03](./03-realtime.md).

| Site                                                       | Action                                                                                                                                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/jobs/[id]/job-live-view.tsx:47-113`               | Replace `pbBrowser().subscribe / getOne / getFullList` with `EventSource('/api/jobs/[id]/stream')`. See [03].                                                                   |
| `src/components/notifications/job-notifications.tsx:47-69` | Replace per-user `pb.collection('review_jobs').subscribe` with `EventSource('/api/me/notifications')`.                                                                          |
| `src/app/login/sign-in-button.tsx:25`                      | Replace `pb.collection('users').authWithOAuth2(...)` with `signIn('github')` from `next-auth/react`.                                                                            |
| `src/app/relink/relink-button.tsx:20`                      | Same — `signIn('github')` triggers a re-auth with the same provider.                                                                                                            |
| `src/components/topbar/user-menu.tsx:46`                   | Replace the `pbBrowser().authStore.clear()` "belt" + `/api/auth/sign-out` POST with a single `signOut({ callbackUrl: '/login' })`. Auth.js handles cookie + DB session cleanup. |

---

## Removal checklist

When Phase A is done, these can be deleted in a single cleanup commit. Preserve them until the new path is fully working — no half-states.

- `src/lib/pb/` (entire directory)
- `pb_migrations/` (entire directory)
- `scripts/pb.mjs`, `scripts/pb-install.mjs`
- `tools/pocketbase/` (entire directory)
- `pb_data/` (entire directory; gitignored anyway, but remove from local `.gitignore` afterwards)
- `pocketbase` npm dependency (`package.json` line 34 at time of planning)
- Env vars: `NEXT_PUBLIC_POCKETBASE_URL`, `POCKETBASE_URL`, `POCKETBASE_ADMIN_EMAIL`, `POCKETBASE_ADMIN_PASSWORD`
- npm scripts: `pb`, `pb:install` (in `package.json`)
- Any imports referencing `pocketbase` or `@/lib/pb/*`

A pre-merge sanity check: `grep -r "pocketbase\|pbServer\|pbAdmin\|pbBrowser" src/` should return zero matches.

---

## Verification

Phase A is done when:

1. `docker compose up postgres` works and produces a Postgres container with the schema applied.
2. `npm run dev` works against that DB; sign-in completes; a stub review can be kicked off and viewed live.
3. The grep above is empty.
4. `npm run typecheck`, `npm run lint`, `npm test` all pass.
5. The history page lists past jobs correctly; clicking one shows the final review.

Verification details for the runner side live in [04](./04-job-runner-rewrite.md). Verification for auth lives in [02](./02-auth-replacement.md).

---

## Open questions to resolve during execution

- **Avatar URL.** Today it's served by PB. Options: (a) store the GitHub avatar URL in `users.image` (Auth.js does this automatically) and let `next/image` fetch it directly; (b) proxy through `/api/avatars/[id]` if we want to control caching. (a) is simpler — recommended unless GitHub rate-limits become an issue.
- **JSONB query patterns.** If we ever need to filter on fields inside `target` or `content`, Postgres has `->` and `@>` operators. Drizzle exposes these via `sql` template. Out of scope for the migration; flagging for the proposal docs.
- **Default sort order.** Today PB defaults to `-created`. Drizzle queries are explicit. Audit each list query during execution to ensure no default-order regressions.
