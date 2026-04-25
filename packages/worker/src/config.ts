/**
 * Worker process configuration. Read once at startup; missing values throw
 * so a misconfigured deploy fails loudly instead of silently looping.
 */

export type ReviewExecutorKind = 'opencode' | 'stub';

export interface WorkerConfig {
  databaseUrl: string;
  supabaseUrl: string;
  serviceRoleKey: string;
  /** Initial reconnect delay; doubles up to {@link reconnectMaxMs}. */
  reconnectMinMs: number;
  reconnectMaxMs: number;
  /** Stub-mode pause between fake chunks. */
  stubChunkDelayMs: number;
  /** Which executor to run jobs through. Default: `opencode`. */
  executor: ReviewExecutorKind;
  /** Model id for opencode runs (`<provider>/<model>`). */
  reviewModel: string;
}

export function readConfigFromEnv(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const executorRaw = env.REVIEW_EXECUTOR ?? 'opencode';
  if (executorRaw !== 'opencode' && executorRaw !== 'stub') {
    throw new Error(`worker: REVIEW_EXECUTOR must be 'opencode' or 'stub', got '${executorRaw}'`);
  }
  return {
    databaseUrl: required(env, 'DATABASE_URL'),
    supabaseUrl: required(env, 'SUPABASE_URL'),
    serviceRoleKey: required(env, 'SUPABASE_SERVICE_ROLE_KEY'),
    reconnectMinMs: Number(env.WORKER_RECONNECT_MIN_MS ?? 1000),
    reconnectMaxMs: Number(env.WORKER_RECONNECT_MAX_MS ?? 30_000),
    stubChunkDelayMs: Number(env.WORKER_STUB_CHUNK_DELAY_MS ?? 1000),
    executor: executorRaw,
    reviewModel: env.REVIEW_MODEL ?? 'opencode-zen/glm-4.7',
  };
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value || value.length === 0) {
    throw new Error(`worker: ${key} is required in the environment`);
  }
  return value;
}
