/**
 * The host process environment, for the git, gh and Agent SDK subprocesses
 * `er` spawns, each of which inherits all of it. The one `process.env` reader
 * (guardrail env-access), so what `er` takes from the environment is decided
 * here.
 */
export type HostEnv = Record<string, string | undefined>;

/** A fresh copy of the whole process environment. */
export function hostEnv(): HostEnv {
  return { ...process.env };
}
