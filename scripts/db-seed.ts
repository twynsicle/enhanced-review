/**
 * Idempotent seed for local dev. Inserts the github_login from the
 * SEED_GITHUB_LOGIN env var into `allowed_users` if it is not already
 * present. No-op when SEED_GITHUB_LOGIN is unset.
 *
 * Run: `npm run db:seed`
 *
 * Production allowlist management lives in docs/OPERATIONS.md (post-A6).
 */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { allowedUsers } from '../src/lib/db/schema';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required to run the seed.');
  }
  const login = process.env.SEED_GITHUB_LOGIN?.trim();
  if (!login) {
    console.log('[seed] SEED_GITHUB_LOGIN not set — skipping.');
    return;
  }

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const db = drizzle(pool);
    const existing = await db
      .select({ id: allowedUsers.id })
      .from(allowedUsers)
      .where(eq(allowedUsers.githubLogin, login))
      .limit(1);
    if (existing.length > 0) {
      console.log(`[seed] allowlist already contains '${login}' — no-op.`);
      return;
    }
    await db.insert(allowedUsers).values({ githubLogin: login });
    console.log(`[seed] inserted '${login}' into allowed_users.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
