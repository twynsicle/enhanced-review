# 04 — Job runner rewrite

The runner is the heart of the app: it clones a repo, invokes the Claude Agent SDK, and streams chunks of a narrative review back through Postgres. This doc walks through what changes when the data layer moves from PB to Drizzle, and what stays the same.

Depends on [01](./01-postgres-data-layer.md) (schema), [02](./02-auth-replacement.md) (token storage), and [03](./03-realtime.md) (NOTIFY emissions).

---

## Decisions feeding into this doc

- **D1** Keep Next.js monolith, runner stays in-process
- **D5** Single ECS task, two containers — implies in-flight reviews die on deploy

---

## What stays the same

- **Fire-and-forget invocation pattern.** `POST /api/jobs` registers an `AbortController`, kicks off `runJob(...)`, returns 202 with the job ID. No await.
- **AbortController registry.** `src/lib/jobs/runner/registry.ts` is an in-memory `Map<jobId, AbortController>`. Cancel route signals; runner observes `signal.aborted`. No change.
- **Drain-before-done.** Before the final status flip, the runner awaits `Promise.allSettled(inFlight)` so a subscriber observing `status='done'` is guaranteed to see every chunk. No change.
- **Timeout setup.** `setTimeout(REVIEW_TIMEOUT_MIN * 60_000)` in the route handler writes an error status and aborts the controller. Logic unchanged; only the DB call swaps.
- **Clone temp dir.** `os.tmpdir()` resolves to `/tmp` inside the container; Fargate gives ~20GB of ephemeral storage by default. No change.
- **`MAX_JOBS_PER_USER` cap.** Default 1 (the current behavior). Enforced before insert in `POST /api/jobs`.
- **Executor backend choice.** `REVIEW_EXECUTOR` env var still selects `stub` or `claude`. Claude Agent SDK invocation unchanged.

---

## What changes

### 1. Token source

PB read the GitHub access token from the `gh_access_token` HttpOnly cookie. Auth.js stores it in the `accounts` table. The runner now takes the token as an explicit argument (it does today) but the call site in `POST /api/jobs` reads it via Drizzle, not via cookie.

Before:

```typescript
const token = await readGithubTokenCookie(); // src/lib/github/cookie.ts
runJob(jobId, token, headSha, target, signal);
```

After:

```typescript
import { getGithubTokenFor } from '@/lib/github/token';
const token = await getGithubTokenFor(session.user.id);
runJob(jobId, token, headSha, target, signal);
```

`src/lib/github/cookie.ts` is deleted. `src/lib/github/token.ts` (introduced in [02](./02-auth-replacement.md)) replaces it.

### 2. Database handle

Today the runner calls `pbAdmin()` once at the top of `runJob`, then reuses the client. New shape:

```typescript
import { db } from '@/lib/db/client';
// ...
export async function runJob(
  jobId: string,
  token: string,
  headSha: string,
  target: TargetSpec,
  signal: AbortSignal,
): Promise<void> {
  // ...write paths now use `db` directly...
}
```

No more `pbAdmin()` import, no more `withAdminRetry` retry helper (Drizzle's pool handles connection failures; we surface real errors).

> **Preserve the `signal.reason === 'timeout'` branching in the `finally`.** The legacy code distinguishes a timeout-triggered abort from a user-cancel abort: only the user-cancel path writes `status='cancelled'`. Without this check, the runner would overwrite the `status='error'` the timeout writer just set, lying to the user about why the job ended. Eyeball the diff after rewriting `run.ts` and consider a unit test covering both branches.

### 3. Write paths (`src/lib/jobs/runner/writes.ts`)

Five functions in this file (after a small mechanical extraction). Each becomes a Drizzle `update`/`insert` followed by a `pg_notify` for the realtime layer.

> **Prerequisite — extract `insertChunk`.** Today the chunk insert lives **inline** in `run.ts`'s `onChunk` callback (around lines 201–211). Pull it into `writes.ts:insertChunk(jobId, seq, content)` as a separate, mechanical commit _before_ swapping to Drizzle so the Drizzle-rewrite diff stays focused on the call shape, not on file moves.

> **`markCancelled` is new.** The legacy code applied the cancel transition inline in `run.ts`'s `finally` block. The Drizzle rewrite breaks it out into a dedicated `markCancelled(jobId, userId)` so the cancel route and the runner's `finally` share one idempotent path. Keep the same guard: `WHERE status IN ('pending','running')`, NOTIFY only when a row actually flipped.

**Before** (PB):

```typescript
export async function markRunning(pb: PocketBase, jobId: string) {
  await pb.collection('review_jobs').update(jobId, {
    status: 'running',
    started_at: new Date().toISOString(),
  });
}

export async function insertChunk(pb: PocketBase, jobId: string, seq: number, content: string) {
  await pb.collection('review_chunks').create({ job: jobId, seq, content });
}

// ... finalizeAsDone, markErrored, markCancelled — same shape
```

**After** (Drizzle + NOTIFY):

```typescript
import { db, pool } from '@/lib/db/client';
import { reviewJobs, reviewChunks, reviews } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function markRunning(jobId: string) {
  await db
    .update(reviewJobs)
    .set({ status: 'running', startedAt: new Date(), updatedAt: new Date() })
    .where(eq(reviewJobs.id, jobId));
  await pool.query(`SELECT pg_notify($1, $2)`, [
    `job_${jobId}`,
    JSON.stringify({ type: 'status', status: 'running' }),
  ]);
}

export async function insertChunk(jobId: string, seq: number, content: string) {
  await db.insert(reviewChunks).values({ jobId, seq, content }).onConflictDoNothing();
  await pool.query(`SELECT pg_notify($1, $2)`, [
    `job_${jobId}`,
    JSON.stringify({ type: 'chunk', seq }),
  ]);
}

export async function finalizeAsDone(
  jobId: string,
  userId: string,
  content: NarrativeReview,
  riskScore: number | null,
  diffTruncated: boolean,
) {
  await db.transaction(async (tx) => {
    await tx.insert(reviews).values({ jobId, content, diffTruncated });
    await tx
      .update(reviewJobs)
      .set({ status: 'done', completedAt: new Date(), riskScore, updatedAt: new Date() })
      .where(eq(reviewJobs.id, jobId));
  });
  // Notify after commit, so subscribers SELECTing `reviews` see the row.
  const payload = JSON.stringify({ type: 'status', status: 'done', riskScore });
  await pool.query(`SELECT pg_notify($1, $2)`, [`job_${jobId}`, payload]);
  await pool.query(`SELECT pg_notify($1, $2)`, [
    `user_${userId}:terminal`,
    JSON.stringify({ jobId, status: 'done', riskScore }),
  ]);
}

export async function markErrored(jobId: string, userId: string, errorMessage: string) {
  await db
    .update(reviewJobs)
    .set({
      status: 'error',
      completedAt: new Date(),
      errorMessage: errorMessage.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(eq(reviewJobs.id, jobId));
  await pool.query(`SELECT pg_notify($1, $2)`, [
    `job_${jobId}`,
    JSON.stringify({ type: 'status', status: 'error', errorMessage }),
  ]);
  await pool.query(`SELECT pg_notify($1, $2)`, [
    `user_${userId}:terminal`,
    JSON.stringify({ jobId, status: 'error' }),
  ]);
}

export async function markCancelled(jobId: string, userId: string) {
  // Used by the runner's finally block on abort. Idempotent: only writes if still pending/running.
  const result = await db
    .update(reviewJobs)
    .set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
    .where(and(eq(reviewJobs.id, jobId), inArray(reviewJobs.status, ['pending', 'running'])))
    .returning({ id: reviewJobs.id });
  if (result.length > 0) {
    await pool.query(`SELECT pg_notify($1, $2)`, [
      `job_${jobId}`,
      JSON.stringify({ type: 'status', status: 'cancelled' }),
    ]);
    await pool.query(`SELECT pg_notify($1, $2)`, [
      `user_${userId}:terminal`,
      JSON.stringify({ jobId, status: 'cancelled' }),
    ]);
  }
}
```

Highlights:

- **`onConflictDoNothing()` on chunks** — same idempotency PB gave us via the unique `(job, seq)` index. Re-running a chunk insert is harmless.
- **`finalizeAsDone` is a transaction.** PB had no transactions, so the current code inserts the review row first, then updates the status. The transaction tightens the invariant: a subscriber observing `status='done'` is guaranteed to find a `reviews` row. (PB's loose ordering was already correct in practice; we're just formalizing it.)
- **NOTIFY is after commit.** Drizzle commits per query (or at end of `db.transaction()` block); `pg_notify` fires after, so subscribers can read consistent state.
- **User-wide terminal notify.** Required by the per-user notifications stream in [03](./03-realtime.md).

### 4. Cancel route — push state-check into the WHERE clause

PB's cancel rule (`@request.auth.id = user.id && status in ('pending','running')`) moves into the SQL.

`src/app/api/jobs/[id]/cancel/route.ts`:

```typescript
const session = await auth();
if (!session?.user) return new Response('Unauthorized', { status: 401 });

const result = await db
  .update(reviewJobs)
  .set({ status: 'cancelled', cancelledAt: new Date() })
  .where(
    and(
      eq(reviewJobs.id, params.id),
      eq(reviewJobs.userId, session.user.id),
      inArray(reviewJobs.status, ['pending', 'running']),
    ),
  )
  .returning({ id: reviewJobs.id });

if (result.length === 0) return new Response('Conflict', { status: 409 });

registry.signal(params.id); // abort the in-process AbortController
await pool.query(`SELECT pg_notify($1, $2)`, [
  `job_${params.id}`,
  JSON.stringify({ type: 'status', status: 'cancelled' }),
]);
return new Response(null, { status: 204 });
```

Notes:

- The cancel route is the **only** place the runner's invariant of "drain-before-done" can be violated under heavy concurrency, because the runner's `finally` block also writes `cancelled` if it sees an aborted signal. Both writes are idempotent (only succeed if status is still pending/running), so racing them is safe.
- `registry.signal()` is a thin wrapper over `controller.abort('cancel')`. The runner observes the abort and stops mid-stream.

### 5. Concurrency check moves into a transaction

`POST /api/jobs` does a transactional concurrency check + insert:

```typescript
const newJob = await db.transaction(async (tx) => {
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(reviewJobs)
    .where(
      and(
        eq(reviewJobs.userId, session.user.id),
        inArray(reviewJobs.status, ['pending', 'running']),
      ),
    );
  if (n >= maxJobsPerUser()) {
    throw new ConcurrencyError(`Limit reached: ${n}/${maxJobsPerUser()}`);
  }
  const [row] = await tx
    .insert(reviewJobs)
    .values({
      userId: session.user.id,
      githubLogin: session.user.githubLogin,
      target,
      status: 'pending',
      headSha,
    })
    .returning();
  return row;
});
```

PB had no transactions; two simultaneous POSTs could both pass the `getList` check before either inserted. Drizzle on Postgres closes that race naturally (the transaction holds row-level locks via the underlying SELECT in modern Postgres if we add `for update` — for a one-user POC, the default isolation level is plenty).

### 6. Timeout writer (in `POST /api/jobs`)

Today:

```typescript
const timeoutId = setTimeout(() => {
  admin
    .collection('review_jobs')
    .update(jobId, { status: 'error', error_message: 'Timeout' })
    .finally(() => controller.abort('timeout'));
}, timeoutMin * 60_000);
```

Becomes:

```typescript
const timeoutId = setTimeout(async () => {
  await db
    .update(reviewJobs)
    .set({ status: 'error', errorMessage: 'Timeout', completedAt: new Date() })
    .where(eq(reviewJobs.id, jobId));
  await pool.query(`SELECT pg_notify($1, $2)`, [
    `job_${jobId}`,
    JSON.stringify({ type: 'status', status: 'error', errorMessage: 'Timeout' }),
  ]);
  controller.abort('timeout');
}, timeoutMin * 60_000);
```

Same logic, two extra ms.

### 7. `src/lib/jobs/concurrency.ts`

```typescript
import { db } from '@/lib/db/client';
import { reviewJobs } from '@/lib/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';

export const DEFAULT_MAX_JOBS_PER_USER = 1;

export function maxJobsPerUser(): number {
  const raw = process.env.MAX_JOBS_PER_USER;
  if (!raw) return DEFAULT_MAX_JOBS_PER_USER;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_JOBS_PER_USER;
}

export async function countActiveForUser(userId: string): Promise<number> {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reviewJobs)
    .where(and(eq(reviewJobs.userId, userId), inArray(reviewJobs.status, ['pending', 'running'])));
  return n;
}
```

The function is now usable both inside and outside a transaction (the transactional check above inlines the SELECT for atomicity; this is the loose check used by other paths if needed).

---

## Graceful shutdown

ECS task stop sends `SIGTERM` and waits up to `stopTimeout` seconds (default 30) before `SIGKILL`. A 15-min review job can't drain in 30s, so:

- **Default behavior:** in-flight jobs die. The next time the new container boots and someone visits the job page, the row is still `running` but no runner exists. We need a recovery story.
- **Recovery story:** runner adds a startup pass that marks all `running` jobs older than the heartbeat threshold as `error` with `errorMessage: 'Container restarted; in-flight job lost'`. Cheap, deterministic, restores invariant.
- **Best-effort drain:** add a SIGTERM handler that calls `controller.abort('shutdown')` for every registered job. Doesn't drain (jobs don't shut down quickly enough), but ensures partial work doesn't corrupt state.

```typescript
// src/lib/jobs/runner/shutdown.ts
import { registry } from './registry';

export function installShutdownHandler() {
  process.on('SIGTERM', () => {
    for (const [jobId, controller] of registry.entries()) {
      controller.abort('shutdown');
    }
  });
}
```

Called once from the Next.js custom server entrypoint, or from a top-level module-load hook.

```typescript
// src/lib/jobs/runner/recover-on-startup.ts
export async function recoverInterruptedJobs() {
  const result = await db
    .update(reviewJobs)
    .set({
      status: 'error',
      completedAt: new Date(),
      errorMessage: 'Container restarted; in-flight job lost',
    })
    .where(eq(reviewJobs.status, 'running'))
    .returning({ id: reviewJobs.id, userId: reviewJobs.userId });
  for (const row of result) {
    await pool.query(`SELECT pg_notify($1, $2)`, [
      `job_${row.id}`,
      JSON.stringify({
        type: 'status',
        status: 'error',
        errorMessage: 'Container restarted; in-flight job lost',
      }),
    ]);
    await pool.query(`SELECT pg_notify($1, $2)`, [
      `user_${row.userId}:terminal`,
      JSON.stringify({ jobId: row.id, status: 'error' }),
    ]);
  }
}
```

Called once from the entrypoint script before Next.js boots. (Do it after migrations.)

> **Manual deploy hygiene:** [09](./09-cost-and-operations.md) documents the "no jobs running → safe to deploy" checklist. The recovery pass is the safety net for when that's ignored.

---

## Removal checklist

- `withAdminRetry` (in `src/lib/pb/admin.ts`) — gone with the rest of `src/lib/pb/`.
- `readGithubTokenCookie` (in `src/lib/github/cookie.ts`) — replaced by `getGithubTokenFor`.
- `pbAdmin()` calls inside `run.ts` and `writes.ts` — every one swapped.
- The "first-write retry" logic in `withAdminRetry` was a workaround for PB admin token expiry; Drizzle's pool reconnects automatically, no equivalent needed.

---

## Verification

Phase A success for the runner slice:

1. Kick off a stub review (`REVIEW_EXECUTOR=stub`). Watch chunks stream. End in `done`.
2. Kick off a Claude review. Same end-to-end.
3. Hit cancel mid-review; row goes to `cancelled`, runner exits, no zombie state in `pg_stat_activity`.
4. Hit timeout (set `REVIEW_TIMEOUT_MIN=1`, kick off a long review). Row goes to `error`, runner exits.
5. Concurrency cap: try to POST a second job while one is running; get a 409.
6. Idempotency: simulate a duplicate chunk insert (same `(jobId, seq)`); no error, no duplicate row.
7. Shutdown: kill the dev server mid-review; restart; the next visit to the job page shows it as `error: container restarted`, **and** no `running` row remains.
8. Notifications: while a review is running on tab A, observe the toast on tab B when the job finishes.
