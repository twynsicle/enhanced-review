import '../config/load-env.ts';
import { logger } from '../common/logger.ts';
import { disconnectDb } from '../db/client.ts';
import { UsageError } from './errors.ts';
import { recoverJobs } from './recover-jobs.ts';
import { seedAllowlist } from './seed-allowlist.ts';

/**
 * One-shot job runner: `npm run job -- <name> [args...]`.
 *
 * Runs natively under Node (type stripping), like `server/index.ts` — the
 * generated Prisma client is erasable TypeScript, so no bundle step is needed
 * (phase-2-plan Deviations). Exit codes: 0 ok, 1 job failed, 2 bad usage.
 */
type JobHandler = (args: string[]) => Promise<unknown>;

const JOBS: Record<string, JobHandler> = {
  'seed-allowlist': seedAllowlist,
  'recover-jobs': recoverJobs,
};

async function main(argv: string[]): Promise<number> {
  const [name, ...args] = argv;
  const job = name ? JOBS[name] : undefined;
  if (!job) {
    logger.error(
      { given: name ?? null, jobs: Object.keys(JOBS) },
      'usage: npm run job -- <name> [args...]',
    );
    return 2;
  }
  try {
    await job(args);
    return 0;
  } catch (err) {
    if (err instanceof UsageError) {
      logger.error({ job: name }, err.message);
      return 2;
    }
    logger.error({ err, job: name }, 'job failed');
    return 1;
  } finally {
    await disconnectDb();
  }
}

process.exitCode = await main(process.argv.slice(2));
