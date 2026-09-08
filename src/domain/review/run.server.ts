import { logger } from '../../common/logger.ts';
import { env } from '../../config/env.ts';
import * as reviewChunks from '../../db/review-chunks.ts';
import * as reviewJobs from '../../db/review-jobs.ts';
import { createOctokit } from '../github/client.server.ts';
import {
  getPullMetadata as fetchPullMetadata,
  type PullRef,
} from '../github/pull-metadata.server.ts';
import type { GithubError, GithubResult, PullMetadata } from '../github/types.ts';
import {
  cleanupWorkDir,
  cloneAndDiff,
  githubCloneUrl,
  headRefFor,
  HeadShaMismatchError,
} from './clone/clone-runner.server.ts';
import { listChangedFiles } from './clone/diff-files.server.ts';
import {
  GitCommandError,
  runGit,
  runGitOrThrow,
  type GitRunner,
} from './clone/git-runner.server.ts';
import { ClaudeExecutor } from './executor/claude-executor.server.ts';
import { StubExecutor } from './executor/stub-executor.server.ts';
import { ExecutorParseError, ExecutorProcessError, type ReviewExecutor } from './executor/types.ts';
import type { NarrativeReview } from './narrative.ts';
import type { PrData } from './prompt/types.ts';
import type { ReviewTarget } from './target.ts';

/**
 * Runs one review job in-process, from `pending` to a terminal status:
 * markRunning → (PR) metadata → clone + diff → changed files → executor
 * (streaming chunks) → finalizeDone. The caller (`domain/jobs`) owns the
 * AbortController, the timeout and the registry entry; the reason on the
 * signal says who aborted and therefore who already wrote the terminal
 * status:
 *
 *   'cancel'   the cancel action wrote `cancelled` before signalling
 *   'timeout'  the timeout wrote `error` before signalling
 *   'shutdown' nobody has; the runner writes `error` best-effort
 *
 * Everything with a side effect is injected so the stub review runs end to
 * end against a local git repository from an integration test.
 */
export interface RunJobInput {
  jobId: string;
  token: string;
  target: ReviewTarget;
  headSha: string;
  model: string;
  signal: AbortSignal;
}

export type GetPullMetadata = (
  token: string,
  ref: PullRef,
  signal: AbortSignal,
) => Promise<GithubResult<PullMetadata>>;

/** The subset of the repositories the runner writes through; tests fake it. */
export interface RunJobStore {
  markRunning: (jobId: string) => Promise<boolean>;
  insertChunk: (jobId: string, seq: number, content: string) => Promise<void>;
  finalizeDone: (jobId: string, input: reviewJobs.FinalizeDoneInput) => Promise<boolean>;
  markErrored: (jobId: string, message: string) => Promise<boolean>;
}

export interface RunJobDeps {
  executor: ReviewExecutor;
  git: GitRunner;
  cloneUrlFor: (target: ReviewTarget) => string;
  getPullMetadata: GetPullMetadata;
  makeWorkDir?: (jobId: string) => Promise<string>;
  store?: RunJobStore;
}

export type RunJobOutcome = 'done' | 'skipped' | 'aborted' | 'errored';

export class PullMetadataError extends Error {
  readonly error: GithubError;
  constructor(error: GithubError) {
    super(
      error.kind === 'unknown' && error.message
        ? error.message
        : `pull request metadata: ${error.kind}${error.status ? ` (${String(error.status)})` : ''}`,
    );
    this.name = 'PullMetadataError';
    this.error = error;
  }
}

export const SHUTDOWN_ERROR_MESSAGE = 'interrupted: server shutting down';

export function createExecutor(kind: 'stub' | 'claude'): ReviewExecutor {
  return kind === 'stub' ? new StubExecutor() : new ClaudeExecutor();
}

/** Production wiring: real git, GitHub over HTTPS, the configured executor. */
export function defaultRunJobDeps(): RunJobDeps {
  return {
    executor: createExecutor(env.REVIEW_EXECUTOR),
    git: runGit,
    cloneUrlFor: githubCloneUrl,
    getPullMetadata: (token, ref, signal) => fetchPullMetadata(createOctokit(token), ref, signal),
  };
}

const defaultStore: RunJobStore = {
  markRunning: (jobId) => reviewJobs.markRunning(jobId),
  insertChunk: reviewChunks.insertChunk,
  finalizeDone: (jobId, input) => reviewJobs.finalizeDone(jobId, input),
  markErrored: (jobId, message) => reviewJobs.markErrored(jobId, message),
};

async function readBranchMetadata(
  git: GitRunner,
  cwd: string,
  signal: AbortSignal,
): Promise<{ author: string; body: string }> {
  const result = await runGitOrThrow(git, 'log -1 --format', {
    args: ['log', '-1', '--format=%an%n--BODY--%n%B'],
    cwd,
    signal,
  });
  const [author, ...rest] = result.stdout.split('\n--BODY--\n');
  return { author: (author ?? '').trim() || 'unknown', body: rest.join('\n--BODY--\n').trim() };
}

export function formatJobError(err: unknown): string {
  if (err instanceof HeadShaMismatchError) return `clone: ${err.message}. Submit a fresh review.`;
  if (err instanceof GitCommandError) {
    return `clone: ${err.message}: ${err.stderr.split('\n')[0] ?? ''}`.trim();
  }
  if (err instanceof PullMetadataError) return `github: ${err.message}`;
  if (err instanceof ExecutorParseError) return `parse: ${err.message}`;
  if (err instanceof ExecutorProcessError) {
    const trailer = err.stderr ? `: ${err.stderr.split('\n')[0] ?? ''}` : '';
    return `executor: ${err.message}${trailer}`.trim();
  }
  return err instanceof Error ? err.message : String(err);
}

export async function runJob(input: RunJobInput, deps: RunJobDeps): Promise<RunJobOutcome> {
  const { jobId, token, target, headSha, signal } = input;
  const store = deps.store ?? defaultStore;
  const log = logger.child({ job_id: jobId, executor: deps.executor.name });

  let cloneDir: string | null = null;
  let seq = 0;
  const inFlight: Promise<void>[] = [];
  let outcome: RunJobOutcome = 'aborted';

  try {
    if (signal.aborted) return 'aborted';
    if (!(await store.markRunning(jobId))) {
      log.info('job no longer pending; not running');
      return (outcome = 'skipped');
    }
    log.info({ target: target.kind }, 'job running');

    let prMeta: { title: string; body: string; author: string } | null = null;
    if (target.kind === 'pr') {
      const result = await deps.getPullMetadata(
        token,
        { owner: target.owner, repo: target.repo, number: target.number },
        signal,
      );
      if (!result.ok) throw new PullMetadataError(result.error);
      prMeta = {
        title: result.data.title || target.title,
        body: result.data.body ?? '',
        author: result.data.authorLogin ?? 'unknown',
      };
    }

    const clone = await cloneAndDiff(
      {
        jobId,
        token,
        cloneUrl: deps.cloneUrlFor(target),
        headRef: headRefFor(target),
        baseSha: target.baseSha,
        expectedHeadSha: headSha,
        signal,
      },
      { git: deps.git, makeWorkDir: deps.makeWorkDir },
    );
    cloneDir = clone.cloneDir;
    if (signal.aborted) return 'aborted';

    const files = await listChangedFiles(deps.git, cloneDir, target.baseSha, headSha, signal);

    let prData: PrData;
    if (target.kind === 'pr' && prMeta) {
      prData = {
        ...prMeta,
        baseRefName: 'base',
        headRefName: headRefFor(target),
        files,
        diff: clone.diff,
      };
    } else if (target.kind === 'branch') {
      const meta = await readBranchMetadata(deps.git, cloneDir, signal);
      prData = {
        title: `Branch ${target.ref}`,
        body: meta.body,
        author: meta.author,
        baseRefName: target.baseRef,
        headRefName: target.ref,
        files,
        diff: clone.diff,
      };
    } else {
      throw new Error('pull request metadata missing');
    }

    const onChunk = (text: string): void => {
      const currentSeq = seq++;
      inFlight.push(
        store.insertChunk(jobId, currentSeq, text).catch((err: unknown) => {
          log.error({ err, seq: currentSeq }, 'insertChunk failed');
        }),
      );
    };

    const result = await deps.executor.run({
      jobId,
      cloneDir,
      prData,
      model: input.model,
      signal,
      onChunk,
    });
    if (signal.aborted) return 'aborted';

    // Drain chunk inserts before flipping to `done` so a poller that sees
    // `done` has already seen the full stream.
    await Promise.allSettled(inFlight);

    const content: NarrativeReview = { ...result.review, files };
    const finalized = await store.finalizeDone(jobId, {
      content,
      diffTruncated: result.wasTruncated,
      riskScore: content.riskAssessment?.score ?? null,
    });
    if (!finalized) {
      log.warn('job was no longer running at finalize; review discarded');
      return (outcome = 'skipped');
    }
    log.info({ files: files.length, chunks: seq }, 'job done');
    return (outcome = 'done');
  } catch (err) {
    if (signal.aborted) return 'aborted';
    const message = formatJobError(err);
    log.error({ err }, `job errored: ${message}`);
    await store.markErrored(jobId, message);
    return (outcome = 'errored');
  } finally {
    // Tail flush so partial output survives cancel and error.
    await Promise.allSettled(inFlight);
    if (outcome === 'aborted' && signal.aborted) {
      log.info({ reason: String(signal.reason) }, 'job aborted');
      if (signal.reason === 'shutdown') {
        await store.markErrored(jobId, SHUTDOWN_ERROR_MESSAGE).catch((err: unknown) => {
          log.warn({ err }, 'failed to mark job interrupted');
        });
      }
    }
    if (cloneDir) await cleanupWorkDir(cloneDir);
  }
}
