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

/**
 * The environment for the Agent SDK subprocess, and so for every command its
 * Bash tool runs: the host's, with git told to use a bare repository only when
 * one is named explicitly. A reviewed tree can commit a directory laid out as
 * a bare repository, config and all; a `cd` into it followed by an allowed
 * `git diff` would otherwise run whatever diff driver that config names.
 * Added as one more `GIT_CONFIG_*` entry so the engineer's own are kept.
 */
export function agentEnv(): HostEnv {
  const env = hostEnv();
  const count = Number.parseInt(env.GIT_CONFIG_COUNT ?? '', 10);
  const index = Number.isInteger(count) && count > 0 ? count : 0;
  env[`GIT_CONFIG_KEY_${String(index)}`] = 'safe.bareRepository';
  env[`GIT_CONFIG_VALUE_${String(index)}`] = 'explicit';
  env.GIT_CONFIG_COUNT = String(index + 1);
  return env;
}
