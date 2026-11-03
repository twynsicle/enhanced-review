export const VERSION = '2.4.0';

export interface Config {
  port: number;
  apiKey: string;
  gatewayUrl: string;
  gatewayKey: string;
  gatewayWebhookSecret: string;
  gatewayTimeoutMs: number;
  carrierUrl: string;
  carrierTimeoutMs: number;
  mailerUrl: string;
  mailerTimeoutMs: number;
  mailFrom: string;
  abandonedSweepMs: number;
  stuckSweepMs: number;
  captureRetrySweepMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  return {
    port: integer(env.PORT, 8080),
    apiKey: required(env, 'API_KEY'),
    gatewayUrl: required(env, 'CARDFLOW_URL'),
    gatewayKey: required(env, 'CARDFLOW_KEY'),
    gatewayWebhookSecret: required(env, 'CARDFLOW_WEBHOOK_SECRET'),
    gatewayTimeoutMs: integer(env.CARDFLOW_TIMEOUT_MS, 8000),
    carrierUrl: required(env, 'PARCELNET_URL'),
    carrierTimeoutMs: integer(env.PARCELNET_TIMEOUT_MS, 10_000),
    mailerUrl: required(env, 'MAILER_URL'),
    mailerTimeoutMs: integer(env.MAILER_TIMEOUT_MS, 5000),
    mailFrom: env.MAIL_FROM ?? 'orders@shop.example',
    abandonedSweepMs: integer(env.ABANDONED_SWEEP_MS, 10 * 60 * 1000),
    stuckSweepMs: integer(env.STUCK_SWEEP_MS, 5 * 60 * 1000),
    captureRetrySweepMs: integer(env.CAPTURE_RETRY_SWEEP_MS, 60 * 1000),
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function integer(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`expected a positive integer, got ${value}`);
  }
  return parsed;
}
