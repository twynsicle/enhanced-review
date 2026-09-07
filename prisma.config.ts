import { existsSync } from 'node:fs';
import { defineConfig, env } from 'prisma/config';

// Prisma CLI entry point (migrate / generate / studio). The datasource URL
// lives here rather than in schema.prisma (Prisma 7). `.env` is loaded the
// same way server/load-env.ts does it, so the CLI and the app agree on
// DATABASE_URL without a dotenv dependency.
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
