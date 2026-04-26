import 'server-only';
import { pino, type Logger } from 'pino';

/**
 * Shared Next.js (server) pino instance. JSON by default; set
 * `LOG_PRETTY=1` in dev for the colourised transport. Import this in
 * route handlers, server actions, and middleware — anything running on
 * the server.
 *
 * Use `logger.child({ job_id })` (or any other tag) for request-scoped
 * lines so the operator can grep for a single job across the API route
 * and the in-process runner.
 */
function buildLogger(): Logger {
  const level = process.env.LOG_LEVEL ?? 'info';
  if (process.env.LOG_PRETTY === '1') {
    return pino({
      level,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss.l' },
      },
    });
  }
  return pino({ level });
}

export const logger: Logger = buildLogger();
