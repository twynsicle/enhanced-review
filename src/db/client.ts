import { PrismaPg } from '@prisma/adapter-pg';
import { logger } from '../common/logger.ts';
import { env } from '../config/env.ts';
import { PrismaClient } from './generated/client.ts';

/**
 * Process-wide Prisma client over the `pg` driver adapter (engine-free).
 *
 * Only `src/db/**` may import the generated client (guardrail: prisma-access);
 * everything else goes through the repository modules next to this file.
 *
 * Lifecycle is owned here (phase-2-plan P2-D8): the module is only ever
 * loaded through Vite (web server build, jobs bundle), never natively by
 * `server/index.ts`, and it disconnects itself on SIGTERM/SIGINT. In dev,
 * Vite re-evaluates SSR modules on change, so the instance and the signal
 * hook are parked on `globalThis` to avoid leaking pools per reload.
 */
type PrismaGlobal = typeof globalThis & { enhancedReviewPrisma?: PrismaClient };
const globalRef = globalThis as PrismaGlobal;

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  const client = new PrismaClient({
    adapter,
    log: [
      { level: 'warn', emit: 'event' },
      { level: 'error', emit: 'event' },
    ],
  });
  client.$on('warn', (e) => logger.warn({ prisma: e }, 'prisma warning'));
  client.$on('error', (e) => logger.error({ prisma: e }, 'prisma error'));

  const disconnect = () => {
    void client.$disconnect();
  };
  process.once('SIGTERM', disconnect);
  process.once('SIGINT', disconnect);
  return client;
}

export const prisma: PrismaClient = globalRef.enhancedReviewPrisma ?? createClient();
if (env.NODE_ENV !== 'production') globalRef.enhancedReviewPrisma = prisma;

/** `SELECT 1` bounded by `timeoutMs`; false on any failure. Used by /api/health. */
export async function pingDb(timeoutMs = 2000): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([prisma.$queryRaw`SELECT 1`.then(() => true), timeout]);
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}
