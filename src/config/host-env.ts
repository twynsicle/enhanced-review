/**
 * The host process environment for code that spawns subprocesses: the git
 * runner inherits all of it, the Claude executor forwards an allowlist of keys
 * to the SDK. Living here keeps `process.env` reads inside `src/config`
 * (guardrail env-access) without turning every subprocess variable into a
 * validated setting in `env.ts`.
 */
export type HostEnv = Record<string, string | undefined>;

/** A fresh copy of the whole process environment. */
export function hostEnv(): HostEnv {
  return { ...process.env };
}

/** Only the named keys, and only those that are set. */
export function pickHostEnv(keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}
