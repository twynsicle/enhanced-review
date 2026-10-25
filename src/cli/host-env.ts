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
 * How long one of the model's responses may run, in tokens, thinking included.
 * Claude Code's own default for a model it has no figure for is 32,000, and a
 * review's answer arrives as one response that grows with the hunk count and
 * with every overview style asked for: a large change, or a small one in all
 * seven styles, crossed it and the run failed or stalled until `--timeout`.
 * Claude Code caps the variable at the model's own limit, so asking for the
 * most any current model allows is safe whatever `--model` names.
 */
export const MAX_OUTPUT_TOKENS = 128_000;

/**
 * The environment for the Agent SDK subprocess, and so for every command its
 * Bash tool runs: the host's, with room for the whole answer in one response
 * unless the engineer set a cap of their own, and git told to use a bare
 * repository only when one is named explicitly. A reviewed tree can commit a directory laid out as
 * a bare repository, config and all; a `cd` into it followed by an allowed
 * `git diff` would otherwise run whatever diff driver that config names.
 * Added as one more `GIT_CONFIG_*` entry so the engineer's own are kept.
 */
export function agentEnv(): HostEnv {
  const env = hostEnv();
  env.CLAUDE_CODE_MAX_OUTPUT_TOKENS ||= String(MAX_OUTPUT_TOKENS);
  const count = Number.parseInt(env.GIT_CONFIG_COUNT ?? '', 10);
  const index = Number.isInteger(count) && count > 0 ? count : 0;
  env[`GIT_CONFIG_KEY_${String(index)}`] = 'safe.bareRepository';
  env[`GIT_CONFIG_VALUE_${String(index)}`] = 'explicit';
  env.GIT_CONFIG_COUNT = String(index + 1);
  return env;
}
