import { spawn, type ChildProcess } from 'node:child_process';

import { buildNarrativePrompt } from '../prompt/narrative-prompt';
import { parseNarrativeReview } from '../prompt/parse-narrative';
import { writeOpencodeConfig } from './opencode-config';
import {
  ExecutorParseError,
  ExecutorProcessError,
  type ReviewExecutor,
  type ReviewExecutorInput,
  type ReviewExecutorOutput,
} from './types';

const SIGTERM_GRACE_MS = 2_000;

export interface OpencodeSpawn {
  spawn: (
    command: string,
    args: readonly string[],
    options: { cwd: string; env: NodeJS.ProcessEnv; stdio: ['pipe', 'pipe', 'pipe'] },
  ) => ChildProcess;
}

export interface OpencodeExecutorDeps {
  spawner?: OpencodeSpawn['spawn'];
  writeConfig?: typeof writeOpencodeConfig;
  env?: NodeJS.ProcessEnv;
}

export class OpencodeExecutor implements ReviewExecutor {
  readonly name = 'opencode';

  constructor(private readonly deps: OpencodeExecutorDeps = {}) {}

  async run(input: ReviewExecutorInput): Promise<ReviewExecutorOutput> {
    if (input.signal.aborted) {
      throw new Error('opencode run aborted before start');
    }

    const { system, user, wasTruncated, hunkIndex } = buildNarrativePrompt(input.prData);

    const writeConfig = this.deps.writeConfig ?? writeOpencodeConfig;
    await writeConfig(input.cloneDir, {
      model: input.model,
      systemPrompt: system,
    });

    const spawner = this.deps.spawner ?? spawn;
    const env = { ...(this.deps.env ?? process.env) };

    const child = spawner('opencode', ['run', '--model', input.model], {
      cwd: input.cloneDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const result = await collectChildOutput(child, user, input.signal, input.onChunk);

    const parsed = parseNarrativeReview(result.stdout, hunkIndex);
    if (!parsed.ok) {
      if (result.exitCode !== 0) {
        throw new ExecutorProcessError(
          `opencode exited with code ${String(result.exitCode)}`,
          result.stderr,
          result.exitCode,
          result.stdout,
        );
      }
      throw new ExecutorParseError(parsed.error, result.stdout);
    }

    if (result.exitCode !== 0) {
      throw new ExecutorProcessError(
        `opencode emitted a review then exited ${String(result.exitCode)}`,
        result.stderr,
        result.exitCode,
        result.stdout,
      );
    }

    return { review: parsed.data, wasTruncated, rawText: result.stdout };
  }
}

interface CollectedOutput {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

function collectChildOutput(
  child: ChildProcess,
  stdinPayload: string,
  signal: AbortSignal,
  onChunk: ((text: string) => void) | undefined,
): Promise<CollectedOutput> {
  return new Promise<CollectedOutput>((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let killTimer: NodeJS.Timeout | null = null;
    let aborted = false;
    let streamError: Error | null = null;

    child.stdout?.on('data', (c: Buffer) => {
      stdoutChunks.push(c);
      if (!onChunk || streamError) return;
      try {
        onChunk(c.toString('utf-8'));
      } catch (err) {
        streamError = err instanceof Error ? err : new Error(String(err));
        try {
          child.kill('SIGTERM');
        } catch {
          /* child may already be gone */
        }
      }
    });
    child.stderr?.on('data', (c: Buffer) => stderrChunks.push(c));

    const onAbort = () => {
      if (aborted) return;
      aborted = true;
      try {
        child.kill('SIGTERM');
      } catch {
        /* child may already be gone */
      }
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* nothing to kill */
        }
      }, SIGTERM_GRACE_MS);
    };

    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    child.once('error', (err) => {
      signal.removeEventListener('abort', onAbort);
      if (killTimer) clearTimeout(killTimer);
      reject(err);
    });

    child.once('close', (code) => {
      signal.removeEventListener('abort', onAbort);
      if (killTimer) clearTimeout(killTimer);
      if (streamError) {
        reject(streamError);
        return;
      }
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        exitCode: code,
      });
    });

    if (child.stdin) {
      child.stdin.write(stdinPayload, () => {
        child.stdin?.end();
      });
    }
  });
}
