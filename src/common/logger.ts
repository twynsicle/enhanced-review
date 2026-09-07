import { pino, type Logger } from 'pino';
import { env } from '../config/env.ts';

/**
 * Shared server-side pino instance. JSON by default; `LOG_PRETTY=1` swaps in
 * the colourised pino-pretty transport for local development.
 *
 * Use `logger.child({ job_id })` (or any other tag) for request- or
 * job-scoped lines so an operator can grep a single job across the web
 * layer and the in-process runner.
 *
 * This is the only module allowed to touch `console` (guardrail:
 * no-console) — it doesn't, but the exemption lives here if pino ever needs
 * a fallback. Imported natively by `server/index.ts`, hence the relative
 * import with an explicit extension instead of the `@/` alias.
 */
function buildLogger(): Logger {
  if (env.LOG_PRETTY) {
    return pino({
      level: env.LOG_LEVEL,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss.l' },
      },
    });
  }
  return pino({ level: env.LOG_LEVEL });
}

export const logger: Logger = buildLogger();
