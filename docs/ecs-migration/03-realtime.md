# 03 — Realtime: SSE backed by Postgres LISTEN/NOTIFY

Replaces PocketBase's realtime SSE (which the live job view and notification component subscribe to) with an app-owned SSE handler backed by Postgres LISTEN/NOTIFY.

This doc assumes the data layer in [01](./01-postgres-data-layer.md) is in place. The runner write paths in [04](./04-job-runner-rewrite.md) emit the NOTIFY events this doc consumes.

---

## Decisions feeding into this doc

- **D4** SSE from Next.js route handler, backed by Postgres LISTEN/NOTIFY
- Polling fallback noted as an escape hatch if LISTEN/NOTIFY proves operationally flaky on Fargate

---

## What we're replacing

Today the client-side does three PB realtime subscriptions:

| Subscription                                         | Delivers                                       | Lives in                                             |
| ---------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------- |
| `pb.collection('review_jobs').subscribe(jobId, ...)` | Status transitions for a single job            | `src/app/jobs/[id]/job-live-view.tsx`                |
| `pb.collection('review_chunks').subscribe('*', f)`   | Each chunk insert for that job                 | `src/app/jobs/[id]/job-live-view.tsx`                |
| `pb.collection('review_jobs').subscribe('*', f)`     | Terminal status transitions across all my jobs | `src/components/notifications/job-notifications.tsx` |

Plus `pb.realtime.subscribe('PB_CONNECT', ...)` re-fetches snapshot on reconnect — a workaround we'll preserve in our own design.

After migration, two SSE endpoints replace all of the above:

- **`GET /api/jobs/[id]/stream`** — per-job stream: snapshot of current state, then live updates (status changes + chunk inserts).
- **`GET /api/me/notifications`** — per-user stream: terminal status transitions for _my_ jobs.

Both are server-sent-events (`text/event-stream`), consumed by the browser via `EventSource`.

---

## Why SSE + LISTEN/NOTIFY (not polling, not WebSockets)

- **SSE** is the right tool for one-way server-to-client streaming. It's a plain HTTP request that hangs; the browser auto-reconnects on drop. No new protocol on the ALB. ALB has no per-route stickiness needs because there's only one task anyway.
- **LISTEN/NOTIFY** is Postgres's built-in pub/sub. The runner calls `NOTIFY 'job_<id>', '<payload>'` after each write; the SSE handler holds a Postgres connection doing `LISTEN 'job_<id>'` and gets the payload pushed without polling. Sub-millisecond latency from the DB's perspective; total perceived latency is dominated by SSE network round-trip (~10-50ms typically).
- **No new infrastructure.** No Redis, no message broker, no SQS, no AppSync. The DB we already have does the job.
- **Fits the drain-before-done invariant.** Because the runner controls the order of `INSERT chunk` → `NOTIFY` → `UPDATE status='done'` → `NOTIFY`, a subscriber who sees `status=done` is guaranteed to have already seen every chunk's NOTIFY. Same guarantee PB provided.

Polling would work and is dead-simple, but the lag (500ms-2s) is visible in the live view. We're keeping it as a fallback escape hatch (last section).

WebSockets would work but: ALB sticky sessions, Fargate task lifecycle interactions, and the client-side library bloat aren't worth it for one-way streaming.

---

## Channel naming and payload shape

Postgres NOTIFY channels are flat strings (no hierarchy). We use a simple naming scheme:

| Channel                  | Emitted by                                                | Purpose                                                                                 |
| ------------------------ | --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `job_<id>`               | Runner: chunk inserts and status transitions for job `id` | Per-job stream. SSE handler `LISTEN`s on this channel.                                  |
| `user_<userId>:terminal` | Runner: when a job reaches `done`/`error`/`cancelled`     | Cross-page notification stream. One per user. `:` works in channel names (just a char). |

Payloads are JSON, kept under 8KB (Postgres's `NOTIFY` payload limit). For chunks, we send only `{type: 'chunk', seq, jobId}` — the SSE handler then SELECTs the chunk content and re-emits to clients. This avoids round-tripping the chunk text through Postgres twice and keeps payloads small.

For status transitions we send the new status + minimal metadata: `{type: 'status', status, riskScore?, errorMessage?}`.

> **Why include `seq` in the chunk notify payload?** So the SSE handler can detect gaps (if any) and re-fetch missing chunks instead of waiting. In practice the runner inserts in order on a single connection, so gaps shouldn't happen. Defense in depth.

---

## SSE route handler — `/api/jobs/[id]/stream`

Lives at `src/app/api/jobs/[id]/stream/route.ts`. App Router gives us streaming responses via `ReadableStream`.

### Lifecycle

```
GET /api/jobs/123/stream
  ├─ auth() check + ownership check (Drizzle: job.userId === session.user.id)
  ├─ acquire dedicated pg.Client (NOT from the pool)
  ├─ client.query("LISTEN \"job_123\"")
  ├─ SELECT current job row + all current chunks (snapshot)
  ├─ emit `event: snapshot\ndata: {...}\n\n`
  ├─ on client.notification(payload):
  │     if chunk: SELECT chunk row by (jobId, seq), emit `event: chunk`
  │     if status: emit `event: status`
  │     if status in (done|error|cancelled): emit `event: terminal` and close
  ├─ on req.signal.abort (browser disconnected):
  │     client.query("UNLISTEN \"job_123\"")
  │     client.release()  // returns to a "freelist", or just .end() since it's not pooled
  └─ done
```

### Sketch

```typescript
import { auth } from '@/lib/auth/auth';
import { db, pool } from '@/lib/db/client';
import { reviewJobs, reviewChunks } from '@/lib/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import pg from 'pg';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });

  const job = await db.query.reviewJobs.findFirst({
    where: and(eq(reviewJobs.id, params.id), eq(reviewJobs.userId, session.user.id)),
  });
  if (!job) return new Response('Not found', { status: 404 });

  // Dedicated, non-pooled client for LISTEN.
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(`LISTEN "job_${params.id}"`);

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      // Initial snapshot.
      const chunks = await db
        .select()
        .from(reviewChunks)
        .where(eq(reviewChunks.jobId, params.id))
        .orderBy(asc(reviewChunks.seq));
      send('snapshot', { job, chunks });

      // Live updates.
      client.on('notification', async (msg) => {
        try {
          const payload = JSON.parse(msg.payload ?? '{}');
          if (payload.type === 'chunk') {
            const rows = await db
              .select()
              .from(reviewChunks)
              .where(and(eq(reviewChunks.jobId, params.id), eq(reviewChunks.seq, payload.seq)))
              .limit(1);
            if (rows[0]) send('chunk', rows[0]);
          } else if (payload.type === 'status') {
            send('status', payload);
            if (['done', 'error', 'cancelled'].includes(payload.status)) {
              send('terminal', payload);
              controller.close();
            }
          }
        } catch (err) {
          // Swallow + log; don't break the stream on a single bad notification.
          console.error('[sse] notification parse failed', err);
        }
      });

      client.on('error', (err) => {
        console.error('[sse] pg client error', err);
        controller.error(err);
      });

      // Heartbeat — comment frame keeps proxies / ALB from closing the connection.
      const heartbeat = setInterval(() => controller.enqueue(': hb\n\n'), 15_000);

      // Cleanup on client disconnect.
      req.signal.addEventListener('abort', async () => {
        clearInterval(heartbeat);
        try {
          await client.query(`UNLISTEN "job_${params.id}"`);
        } catch {}
        await client.end();
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // ALB ignores; harmless. Helps if a proxy is added later.
    },
  });
}
```

### Notes on the sketch

- **Dedicated `pg.Client`, not pooled.** `LISTEN` binds to a session; pooled connections rotate, breaking the listener. New `Client` per SSE connection.
- **`controller.close()` on terminal** — the runner has already drained chunks before emitting `status: done` (see [04](./04-job-runner-rewrite.md)), so closing the stream after the terminal event drops zero data.
- **Heartbeat every 15s.** ALB idle timeout defaults to 60s; a comment frame keeps the connection alive. If we ever switch to API Gateway, the equivalent is a 30s heartbeat.
- **`req.signal.addEventListener('abort', ...)`** fires when the browser closes the EventSource. We unlisten and end the pg client. Without this, every reconnect leaks a Postgres connection until the pool tightens its belt.

---

## Snapshot-on-connect

Two reasons we always snapshot before listening:

1. **First load** — the client opens the SSE stream after the page renders; without a snapshot it'd see no chunks until the next NOTIFY.
2. **Reconnect** — `EventSource` auto-reconnects on drop; on reconnect we send a fresh snapshot, which fills any gaps that occurred during disconnection. This is the same pattern PB used (`PB_CONNECT` re-fetch).

The client treats the snapshot as truth and overlays live events on top:

```typescript
// in src/app/jobs/[id]/job-live-view.tsx
const es = new EventSource(`/api/jobs/${jobId}/stream`);
es.addEventListener('snapshot', (e) => {
  const { job, chunks } = JSON.parse(e.data);
  setJob(job);
  setChunks(chunks);
});
es.addEventListener('chunk', (e) => {
  const chunk = JSON.parse(e.data);
  setChunks((prev) => upsertBySeq(prev, chunk)); // dedupe by seq
});
es.addEventListener('status', (e) => {
  const { status, ...rest } = JSON.parse(e.data);
  setJob((prev) => ({ ...prev, status, ...rest }));
});
es.addEventListener('terminal', () => es.close());
```

`upsertBySeq` already exists in spirit in the current code (PB chunks were dedup'd by `id`); we just key on `seq` instead.

---

## User-wide notifications stream — `/api/me/notifications`

Same pattern, different channel. Lives at `src/app/api/me/notifications/route.ts`.

```
GET /api/me/notifications
  ├─ auth() check
  ├─ acquire dedicated pg.Client
  ├─ client.query("LISTEN \"user_<userId>:terminal\"")
  ├─ on notification: emit `event: terminal\ndata: {jobId, status, ...}`
  └─ on disconnect: cleanup
```

The runner emits to `user_<userId>:terminal` only on the terminal status transition — so this stream sees one event per finished job, not per-chunk. Consumed by `src/components/notifications/job-notifications.tsx` to fire toasts and browser Notifications, same UX as today.

No initial snapshot for this stream — it only emits "what just happened", same as PB's behavior. (Past terminal jobs don't fire notifications.)

---

## Connection budget

A `pg.Client` per SSE connection means each open browser tab on the live view consumes one Postgres connection. For our scale (one user, maybe 2-3 tabs open), this is trivial — Postgres defaults to `max_connections = 100`.

If we ever scaled out:

- Multiplex many SSE subscribers onto a single LISTEN connection per channel via an in-process broadcast (one client.on('notification') → many response controllers). Easy refactor; out of scope here.
- Or move to a pubsub-as-a-service like Redis or NATS. Bigger lift.

For the POC: one client per stream is fine. Document the limit in [09](./09-cost-and-operations.md).

---

## Trade-offs and known footguns

- **NOTIFY payload size cap is 8000 bytes** (default Postgres setting). We never come close because we send only metadata, but if you ever inline chunk content in the payload, this will bite you.
- **NOTIFY is fire-and-forget within Postgres.** If the LISTENER isn't connected, the notification is gone. That's why we always snapshot on connect — to recover anything missed during disconnection.
- **NOTIFY is delivered after transaction commit.** The runner must `commit` the chunk insert _before_ `pg_notify`. We use Drizzle's auto-commit per query, so this is automatic — but documented here in case someone later wraps the runner in a transaction.
- **Two writes per chunk** (the insert + the notify) — both very cheap. ~1ms for the insert, sub-ms for NOTIFY. Acceptable.
- **`asyncDispose` on client cleanup.** Using `req.signal.abort` works but requires care. Test that closing a tab during a streaming review actually releases the connection (use `pg_stat_activity` to verify).

---

## Polling fallback (escape hatch)

If LISTEN/NOTIFY proves operationally flaky on Fargate (e.g. some weird intermittent NOTIFY drop we can't diagnose), the polling fallback is a one-line change inside the SSE handler:

Replace the `client.on('notification', ...)` block with:

```typescript
const interval = setInterval(async () => {
  // Re-fetch state and chunks since last seen seq; emit only deltas.
}, 1000);
req.signal.addEventListener('abort', () => clearInterval(interval));
```

Same SSE wire format, same client. Worse perceived latency (~1s per chunk). The escape hatch is documented for the proposal docs ([12](./12-proposal-software-stack.md)) so engineers know how to fall back.

---

## Verification

Phase A success for the realtime slice:

1. Open `/jobs/<id>` for a running job. Network tab shows one `text/event-stream` request that doesn't close.
2. Watch chunks appear in the live view as the runner emits them. No visible polling lag.
3. Job reaches `done`; the SSE stream closes (network tab marks it as cancelled / completed).
4. Refresh the page — fresh snapshot, all chunks already there, stream re-establishes.
5. From a second tab on the same job, observe identical streaming. Both close on terminal.
6. Open `/history` while a job is running on another tab; when it finishes, the in-app toast fires (notification stream).
7. `pg_stat_activity` query inside the postgres container shows zero leaked LISTEN connections after the live view tab is closed for >30 seconds.

After deploy (Phase C):

8. Streaming works through ALB without the connection being killed by the 60s idle timeout (heartbeat does its job).
9. CloudWatch logs from the web container show no spurious `pg client error` entries during normal operation.
