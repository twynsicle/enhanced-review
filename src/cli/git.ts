import { spawn } from 'node:child_process';
import { hostEnv } from './host-env.ts';
import { runGit, type GitRunner, type GitRunResult } from './git-runner.ts';

/**
 * git and gh for the CLI, bound to one working directory. git goes through
 * the server's non-interactive runner; gh gets the same treatment here. Both
 * runners are injectable so tests can hand gh canned JSON.
 */
export type CommandRunner = GitRunner;

export interface Runners {
  git: CommandRunner;
  gh: CommandRunner;
}

/** A command that exited non-zero, or could not be started at all. */
export class CommandError extends Error {
  readonly stderr: string;
  readonly exitCode: number | null;
  constructor(command: string, stderr: string, exitCode: number | null) {
    const detail = stderr.trim();
    super(
      detail ? `${command} failed: ${detail}` : `${command} failed with exit ${String(exitCode)}`,
    );
    this.name = 'CommandError';
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

export const runGh: CommandRunner = (opts) =>
  new Promise<GitRunResult>((resolve, reject) => {
    const child = spawn('gh', [...opts.args], {
      cwd: opts.cwd,
      env: { ...hostEnv(), GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', ...opts.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      resolve({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        exitCode: code,
      });
    });
  });

/**
 * git as the engineer running it. `runGit` ignores the system and global
 * configuration unless asked, so a test is not at the mercy of whoever runs
 * it; here those files are what makes git work at all — the credential helper, proxy and `url.insteadOf`
 * that reach origin, and the `safe.directory` entries without which git
 * refuses to touch the repository. Nothing the catalog needs rides on them:
 * each patch is numbered under a `diff --git` header this CLI writes itself,
 * and every diff it reads passes `--no-ext-diff --no-textconv`.
 */
const runLocalGit: CommandRunner = (opts) => runGit({ ...opts, hostConfig: true });

export const HOST_RUNNERS: Runners = { git: runLocalGit, gh: runGh };

export class Shell {
  readonly cwd: string;
  readonly runners: Runners;

  constructor(cwd: string, runners: Runners = HOST_RUNNERS) {
    this.cwd = cwd;
    this.runners = runners;
  }

  /** The same runners in another directory. */
  at(cwd: string): Shell {
    return new Shell(cwd, this.runners);
  }

  /** Runs git and returns its stdout; a non-zero exit throws. */
  async git(args: readonly string[], env?: Record<string, string>): Promise<string> {
    const result = await this.tryGit(args, env);
    if (result.exitCode !== 0) {
      throw new CommandError(`git ${subcommand(args)}`, result.stderr, result.exitCode);
    }
    return result.stdout;
  }

  tryGit(args: readonly string[], env?: Record<string, string>): Promise<GitRunResult> {
    return this.runners.git({ args, cwd: this.cwd, env });
  }

  /** Runs gh and returns its stdout; a non-zero exit, or no gh on PATH, throws. */
  async gh(args: readonly string[]): Promise<string> {
    const result = await this.tryGh(args);
    if (result.exitCode !== 0) {
      throw new CommandError(`gh ${args.slice(0, 2).join(' ')}`, result.stderr, result.exitCode);
    }
    return result.stdout;
  }

  /** Like `gh`, but reports failure in the result; a missing gh is exit `null`. */
  async tryGh(args: readonly string[]): Promise<GitRunResult> {
    try {
      return await this.runners.gh({ args, cwd: this.cwd });
    } catch (error) {
      const message =
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'gh is not installed or not on PATH (https://cli.github.com)'
          : (error as Error).message;
      return { stdout: '', stderr: message, exitCode: null };
    }
  }
}

/** The git subcommand, past any global options (`-c key=value`, `--literal-pathspecs`). */
function subcommand(args: readonly string[]): string {
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '-c') i += 1;
    else if (!args[i]!.startsWith('-')) return args[i]!;
  }
  return args[0] ?? '';
}
