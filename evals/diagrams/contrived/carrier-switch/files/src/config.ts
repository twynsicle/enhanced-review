export const VERSION = '2.4.0';

export interface Config {
  port: number;
  apiKey: string;
  gatewayUrl: string;
  gatewayKey: string;
  gatewayWebhookSecret: string;
  gatewayTimeoutMs: number;
  parcelnetUrl: string;
  parcelnetTimeoutMs: number;
  northpostUrl: string;
  northpostTimeoutMs: number;
  homeCountry: string;
  mailerUrl: string;
  mailerTimeoutMs: number;
  mailFrom: string;
  abandonedSweepMs: number;
  stuckSweepMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  return {
    port: integer(env.PORT, 8080),
    apiKey: required(env, 'API_KEY'),
    gatewayUrl: required(env, 'CARDFLOW_URL'),
    gatewayKey: required(env, 'CARDFLOW_KEY'),
    gatewayWebhookSecret: required(env, 'CARDFLOW_WEBHOOK_SECRET'),
    gatewayTimeoutMs: integer(env.CARDFLOW_TIMEOUT_MS, 8000),
    parcelnetUrl: required(env, 'PARCELNET_URL'),
    parcelnetTimeoutMs: integer(env.PARCELNET_TIMEOUT_MS, 10_000),
    northpostUrl: required(env, 'NORTHPOST_URL'),
    northpostTimeoutMs: integer(env.NORTHPOST_TIMEOUT_MS, 10_000),
    homeCountry: country(env.HOME_COUNTRY, 'GB'),
    mailerUrl: required(env, 'MAILER_URL'),
    mailerTimeoutMs: integer(env.MAILER_TIMEOUT_MS, 5000),
    mailFrom: env.MAIL_FROM ?? 'orders@shop.example',
    abandonedSweepMs: integer(env.ABANDONED_SWEEP_MS, 10 * 60 * 1000),
    stuckSweepMs: integer(env.STUCK_SWEEP_MS, 5 * 60 * 1000),
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

// Addresses are upper-cased on the way in, so a lower-case home country would
// match no order and quietly send every parcel abroad.
function country(value: string | undefined, fallback: string): string {
  if (value === undefined) return fallback;
  if (!/^[A-Z]{2}$/.test(value)) {
    throw new Error(`expected a two-letter country code, got ${value}`);
  }
  return value;
}
