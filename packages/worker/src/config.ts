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
  /** Which executor to run jobs through. Default: `opencode`. */
  executor: ReviewExecutorKind;
  /** Model id for opencode runs (`<provider>/<model>`). */
  reviewModel: string;
  /**
   * Maximum wall-clock time a single job may spend in `running` before the
   * worker aborts it and marks the row errored. Sourced from
   * `REVIEW_TIMEOUT_MIN` (minutes, default 15). Doubles as the threshold
   * the periodic sweeper uses to catch jobs the in-process timer missed.
   */
  timeoutMs: number;
  /** Cadence of the stuck-job sweeper (default 60s). */
  sweepIntervalMs: number;
}

export function readConfigFromEnv(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const executorRaw = env.REVIEW_EXECUTOR ?? 'opencode';
  if (executorRaw !== 'opencode' && executorRaw !== 'stub') {
    throw new Error(`worker: REVIEW_EXECUTOR must be 'opencode' or 'stub', got '${executorRaw}'`);
  }
  const timeoutMin = positiveNumber(env, 'REVIEW_TIMEOUT_MIN', 15);
  const sweepIntervalSec = positiveNumber(env, 'WORKER_SWEEP_INTERVAL_SEC', 60);
  return {
    databaseUrl: required(env, 'DATABASE_URL'),
    supabaseUrl: required(env, 'SUPABASE_URL'),
    serviceRoleKey: required(env, 'SUPABASE_SERVICE_ROLE_KEY'),
    reconnectMinMs: Number(env.WORKER_RECONNECT_MIN_MS ?? 1000),
    reconnectMaxMs: Number(env.WORKER_RECONNECT_MAX_MS ?? 30_000),
    executor: executorRaw,
    reviewModel: env.REVIEW_MODEL ?? 'opencode-zen/glm-4.7',
    timeoutMs: Math.round(timeoutMin * 60_000),
    sweepIntervalMs: Math.round(sweepIntervalSec * 1_000),
  };
}

function positiveNumber(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`worker: ${key} must be a positive number, got '${raw}'`);
  }
  return value;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value || value.length === 0) {
    throw new Error(`worker: ${key} is required in the environment`);
  }
  return value;
}
