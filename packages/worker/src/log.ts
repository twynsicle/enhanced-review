import { pino, type Logger } from 'pino';

/**
 * Worker pino instance. Defaults to single-line JSON suitable for
 * `docker logs`. Set `LOG_PRETTY=1` (typically only in `npm run dev`)
 * to swap in a human-friendly transport.
 *
 * Job-scoped log lines should use `logger.child({ job_id })` so every
 * line carries the id without callers having to remember to pass it.
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

export type WorkerLogger = Logger;
