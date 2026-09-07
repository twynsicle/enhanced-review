import { z } from 'zod';

/**
 * The only module allowed to read `process.env` (guardrail: env-access).
 * Parsed once at import; an invalid environment throws before anything else
 * loads, with one line per offending key.
 *
 * Imported natively by `server/index.ts` (Node runs TypeScript directly), so
 * this file and everything it imports must use bare package specifiers or
 * relative paths with explicit extensions — no `@/` alias.
 *
 * Later phases append keys here and to `.env.example` in the same commit.
 */

const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_VERSION: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  LOG_PRETTY: z
    .enum(['0', '1'])
    .default('0')
    .transform((v) => v === '1'),
});

export type Env = z.infer<typeof schema>;

/**
 * Parse an environment-shaped record. Empty strings count as unset so a
 * `KEY=` line in `.env` falls back to the default instead of failing
 * coercion.
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value !== '') cleaned[key] = value;
  }
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  return result.data;
}

export const env: Env = parseEnv(process.env);
