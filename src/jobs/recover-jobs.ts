import { recoverOrphanedJobs } from '../domain/jobs/recover-jobs.server.ts';
import { UsageError } from './errors.ts';

/**
 * `npm run job -- recover-jobs`
 *
 * Marks every `pending` / `running` job as errored ("interrupted: server
 * restarted"). The server does the same at boot; this is for an operator
 * who needs to clear the queue while the server is down or before a
 * restart (00-overview D7, phase-3-plan P3-D6).
 */
export async function recoverJobs(args: string[]): Promise<{ recovered: number }> {
  if (args.length > 0) throw new UsageError('recover-jobs takes no arguments');
  return { recovered: await recoverOrphanedJobs() };
}
