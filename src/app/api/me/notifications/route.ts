import 'server-only';
import pg from 'pg';
import { auth } from '@/lib/auth/auth';
import { logger } from '@/lib/log';

/**
 * GET /api/me/notifications
 *
 * Per-user terminal-status SSE stream. The client subscribes once at app
 * mount and receives one event per job that finishes/errors/cancels for
 * the current viewer. Powers the cross-page toast in
 * `src/components/notifications/job-notifications.tsx`.
 *
 * No initial snapshot — only forward live terminal transitions, matching
 * the legacy PB-realtime semantics ("you only get notified for transitions
 * that happen while you're connected").
 */
export const dynamic = 'force-dynamic';

const HEARTBEAT_MS = 15_000;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  const userId = session.user.id;
  const channel = `user_${userId}:terminal`;

  const url = process.env.DATABASE_URL;
  if (!url) return new Response('Server misconfigured', { status: 500 });

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query(`LISTEN "${channel}"`);

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | null = null;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* ignore */
        }
      };

      const cleanup = async () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        try {
          await client.query(`UNLISTEN "${channel}"`);
        } catch {
          /* ignore */
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

      client.on('notification', (msg: pg.Notification) => {
        if (closed) return;
        let payload: unknown = null;
        try {
          payload = msg.payload ? JSON.parse(msg.payload) : null;
        } catch (err) {
          logger.warn({ err, payload: msg.payload }, '[notif] parse failed');
          return;
        }
        send('terminal', payload);
      });

      client.on('error', async (err) => {
        logger.error({ err, user_id: userId }, '[notif] pg client error');
        await cleanup();
      });

      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: hb\n\n`));
        } catch {
          /* ignore */
        }
      }, HEARTBEAT_MS);

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
