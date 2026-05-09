import 'server-only';
import { and, asc, eq } from 'drizzle-orm';
import pg from 'pg';
import { auth } from '@/lib/auth/auth';
import { db } from '@/lib/db/client';
import { reviewChunks, reviewJobs } from '@/lib/db/schema';
import { toChunkRow, toJobRow } from '@/lib/jobs/types';
import { logger } from '@/lib/log';

/**
 * GET /api/jobs/[id]/stream
 *
 * Per-job Server-Sent Events stream. Sends an initial snapshot, then
 * forwards `chunk` / `status` events from Postgres LISTEN/NOTIFY on
 * channel `job_<id>`. Closes when the job hits a terminal status.
 *
 * Workspace-wide visibility: any authenticated user can subscribe to any
 * job's stream. Matches the read-only PB rule the legacy realtime layer
 * enforced (`listRule: @request.auth.id != ""`).
 *
 * Each subscriber holds a dedicated `pg.Client` because LISTEN binds to
 * a connection — pooled connections rotate.
 */
export const dynamic = 'force-dynamic';

const HEARTBEAT_MS = 15_000;

export async function GET(req: Request, ctx: RouteContext<'/api/jobs/[id]/stream'>) {
  const { id } = await ctx.params;

  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });

  const jobRows = await db.select().from(reviewJobs).where(eq(reviewJobs.id, id)).limit(1);
  if (jobRows.length === 0) return new Response('Not found', { status: 404 });

  const initialJob = toJobRow(jobRows[0]);

  const url = process.env.DATABASE_URL;
  if (!url) return new Response('Server misconfigured', { status: 500 });

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query(`LISTEN "job_${id}"`);

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | null = null;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* controller may already be closed */
        }
      };

      const cleanup = async () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        try {
          await client.query(`UNLISTEN "job_${id}"`);
        } catch {
          /* ignore — client may already be ended */
        }
        try {
          await client.end();
        } catch {
          /* ignore */
        }
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      };

      // Initial snapshot.
      try {
        const chunks = await db
          .select()
          .from(reviewChunks)
          .where(eq(reviewChunks.jobId, id))
          .orderBy(asc(reviewChunks.seq));
        send('snapshot', { job: initialJob, chunks: chunks.map(toChunkRow) });
      } catch (err) {
        logger.error({ err, job_id: id }, '[sse] snapshot failed');
        send('error', { message: 'snapshot failed' });
        await cleanup();
        return;
      }

      // If the job is already terminal, send the terminal event and close —
      // no NOTIFY is coming.
      if (
        initialJob.status === 'done' ||
        initialJob.status === 'error' ||
        initialJob.status === 'cancelled'
      ) {
        send('terminal', { status: initialJob.status });
        await cleanup();
        return;
      }

      client.on('notification', async (msg: pg.Notification) => {
        if (closed) return;
        let payload: { type?: string; status?: string; seq?: number } = {};
        try {
          payload = msg.payload ? JSON.parse(msg.payload) : {};
        } catch (err) {
          logger.warn({ err, payload: msg.payload }, '[sse] notification parse failed');
          return;
        }
        if (payload.type === 'chunk' && typeof payload.seq === 'number') {
          try {
            const rows = await db
              .select()
              .from(reviewChunks)
              .where(and(eq(reviewChunks.jobId, id), eq(reviewChunks.seq, payload.seq)))
              .limit(1);
            if (rows[0]) send('chunk', toChunkRow(rows[0]));
          } catch (err) {
            logger.warn({ err, job_id: id, seq: payload.seq }, '[sse] chunk fetch failed');
          }
        } else if (payload.type === 'status') {
          send('status', payload);
          if (
            payload.status === 'done' ||
            payload.status === 'error' ||
            payload.status === 'cancelled'
          ) {
            send('terminal', { status: payload.status });
            await cleanup();
          }
        }
      });

      client.on('error', async (err) => {
        logger.error({ err, job_id: id }, '[sse] pg client error');
        await cleanup();
      });

      // ALB idle default is 60s; comment-frame heartbeat keeps it alive.
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: hb\n\n`));
        } catch {
          /* ignore */
        }
      }, HEARTBEAT_MS);

      // Browser closed the EventSource → release the LISTEN client.
      req.signal.addEventListener('abort', () => {
        void cleanup();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
