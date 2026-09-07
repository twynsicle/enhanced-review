import { existsSync } from 'node:fs';
import { defineConfig, env } from 'prisma/config';

// Prisma CLI entry point (migrate / generate / studio). The datasource URL
// lives here rather than in schema.prisma (Prisma 7). `.env` is loaded the
// same way src/config/load-env.ts does it, so the CLI and the app agree on
// DATABASE_URL without a dotenv dependency.
if (existsSync('.env')) process.loadEnvFile('.env');

// `prisma generate` never connects, but the config must still resolve a URL
// and `env()` throws when the variable is unset. Generate runs where no
// DATABASE_URL exists (postinstall on a fresh clone, the Docker build stage),
// so it gets a placeholder; every other command fails loudly via `env()`.
const isGenerate = process.argv.includes('generate');
const url =
  isGenerate && !process.env.DATABASE_URL
    ? 'postgresql://unused:unused@localhost:5432/unused'
    : env('DATABASE_URL');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: { url },
});
