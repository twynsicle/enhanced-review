import 'server-only';
import { logger } from '@/lib/log';
import * as registry from './registry';

/**
 * SIGTERM handler. ECS task stop sends SIGTERM and waits up to
 * `stopTimeout` (default 30s) before SIGKILL. A 15-min review job can't
 * drain in 30s — best-effort: signal every registered controller to
 * abort. The runner's `finally` writes status='cancelled' for the ones
 * that have time to react; the rest get fixed by `recoverInterruptedJobs`
 * on the next boot.
 */
let installed = false;

export function installShutdownHandler(): void {
  if (installed) return;
  installed = true;
  process.on('SIGTERM', () => {
    const ids: string[] = [];
    for (const [jobId, controller] of registry.entries()) {
      ids.push(jobId);
      try {
        controller.abort('shutdown');
      } catch (err) {
        logger.warn({ err, job_id: jobId }, '[shutdown] abort failed');
      }
    }
    logger.info({ aborted: ids }, '[shutdown] SIGTERM — signalled in-flight jobs');
  });
}
