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

/**
 * Spawns `opencode run` inside the cloned working tree. The system
 * prompt rides in via AGENTS.md (written into the clone dir alongside
 * an opencode.json that locks tools to read-only); the user prompt
 * (diff + metadata + hunk catalog) is delivered on stdin.
 *
 * Output handling: the model is instructed to emit a JSON payload
 * wrapped in `<narrative_review>` tags. Any framing opencode adds
 * around it is sliced off by `parseNarrativeReview`'s indexOf-based
 * extractor, so we deliberately do **not** rely on opencode's
 * `--format json` envelope.
 */

const SIGTERM_GRACE_MS = 2_000;

export interface OpencodeSpawn {
  spawn: (
    command: string,
    args: readonly string[],
    options: { cwd: string; env: NodeJS.ProcessEnv; stdio: ['pipe', 'pipe', 'pipe'] },
  ) => ChildProcess;
}

export interface OpencodeExecutorDeps {
  /** Test seam. Defaults to node:child_process.spawn. */
  spawner?: OpencodeSpawn['spawn'];
  /** Test seam: bypass writing real files when unit-testing the spawn flow. */
  writeConfig?: typeof writeOpencodeConfig;
  /** Process env to forward (so OPENCODE_ZEN_API_KEY etc. reach the child). */
  env?: NodeJS.ProcessEnv;
}

export class OpencodeExecutor implements ReviewExecutor {
  readonly name = 'opencode';

  constructor(private readonly deps: OpencodeExecutorDeps = {}) {}

  async run(input: ReviewExecutorInput): Promise<ReviewExecutorOutput> {
    if (input.signal.aborted) {
      throw new Error('opencode run aborted before start');
    }

    // 1. Build the prompt pair from the (already-filtered) PR data.
    //    The diff truncation logic lives inside buildNarrativePrompt;
    //    `wasTruncated` is the boolean we persist on `reviews`.
    const { system, user, wasTruncated, hunkIndex } = buildNarrativePrompt(input.prData);

    // 2. Stage opencode.json + AGENTS.md inside the clone dir. Both are
    //    discovered automatically by opencode when cwd = cloneDir.
    const writeConfig = this.deps.writeConfig ?? writeOpencodeConfig;
    await writeConfig(input.cloneDir, {
      model: input.model,
      systemPrompt: system,
    });

    // 3. Spawn the agent. The user prompt streams in via stdin.
    const spawner = this.deps.spawner ?? spawn;
    const env = { ...(this.deps.env ?? process.env) };

    const child = spawner('opencode', ['run', '--model', input.model], {
      cwd: input.cloneDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const result = await collectChildOutput(child, user, input.signal);

    // 4. Parse the narrative review. Tags + JSON shape do the heavy lifting.
    const parsed = parseNarrativeReview(result.stdout, hunkIndex);
    if (!parsed.ok) {
      // If the process exited non-zero, surface that as the primary error;
      // a parse failure on a clean exit is its own error class.
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
      // Rare: the process emitted a parseable review then exited non-zero.
      // Treat this as a process error so an operator notices, but include
      // the parsed review so debugging is easier (via raw stderr).
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
): Promise<CollectedOutput> {
  return new Promise<CollectedOutput>((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let killTimer: NodeJS.Timeout | null = null;
    let aborted = false;

    child.stdout?.on('data', (c: Buffer) => stdoutChunks.push(c));
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
