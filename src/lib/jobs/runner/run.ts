import 'server-only';
import { logger } from '@/lib/log';
import {
  cloneAndDiff,
  cleanupWorkDir,
  HeadShaMismatchError,
  type CloneTarget,
} from './clone/clone-runner';
import { listChangedFiles } from './clone/diff-files';
import { runGit, runGitOrThrow } from './clone/git-runner';
import { GitCommandError } from './clone/git-runner';
import { ClaudeExecutor } from './executor/claude-executor';
import { StubExecutor } from './executor/stub-executor';
import { ExecutorParseError, ExecutorProcessError } from './executor/types';
import { fetchPullMetadata, GithubFetchError } from './github';
import {
  finalizeAsDone,
  insertChunk,
  markCancelled,
  markErrored,
  markRunning,
} from './writes';
import type { PrData } from './prompt/types';

interface ParsedTarget {
  clone: CloneTarget;
  pr?: { number: number; title: string };
}

function parseTarget(raw: unknown): ParsedTarget {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('review_jobs.target is not an object');
  }
  const t = raw as Record<string, unknown>;
  const owner = t.owner;
  const repo = t.repo;
  if (typeof owner !== 'string' || typeof repo !== 'string') {
    throw new Error('review_jobs.target missing owner/repo');
  }
  const baseSha = t.baseSha;
  if (typeof baseSha !== 'string') {
    throw new Error('review_jobs.target missing baseSha');
  }
  if (t.kind === 'pr') {
    const number = t.number;
    const title = typeof t.title === 'string' ? t.title : '';
    if (typeof number !== 'number') {
      throw new Error('review_jobs.target (pr) missing number');
    }
    const headSha = t.headSha;
    if (typeof headSha !== 'string') {
      throw new Error('review_jobs.target (pr) missing headSha');
    }
    const headRef = typeof t.headRef === 'string' ? t.headRef : `pull/${String(number)}/head`;
    return {
      clone: { kind: 'pr', owner, repo, headRef, baseSha },
      pr: { number, title },
    };
  }
  if (t.kind === 'branch') {
    const ref = t.ref;
    const baseRef = t.baseRef;
    if (typeof ref !== 'string' || typeof baseRef !== 'string') {
      throw new Error('review_jobs.target (branch) missing ref/baseRef');
    }
    return {
      clone: { kind: 'branch', owner, repo, ref, baseRef, baseSha },
    };
  }
  throw new Error(`Unknown review target kind: ${String(t.kind)}`);
}

async function readBranchMetadata(
  cwd: string,
  signal?: AbortSignal,
): Promise<{ author: string; body: string }> {
  const result = await runGitOrThrow(runGit, 'log -1 --format', {
    args: ['log', '-1', '--format=%an%n--BODY--%n%B'],
    cwd,
    signal,
  });
  const [author, ...rest] = result.stdout.split('\n--BODY--\n');
  return {
    author: (author ?? '').trim() || 'unknown',
    body: rest.join('\n--BODY--\n').trim(),
  };
}

function formatJobError(err: unknown): string {
  if (err instanceof HeadShaMismatchError) {
    return `clone: ${err.message}. Submit a fresh review.`;
  }
  if (err instanceof GitCommandError) {
    return `clone: ${err.message}: ${err.stderr.split('\n')[0] ?? ''}`.trim();
  }
  if (err instanceof GithubFetchError) {
    return `github: ${err.message}`;
  }
  if (err instanceof ExecutorParseError) {
    return `parse: ${err.message}`;
  }
  if (err instanceof ExecutorProcessError) {
    const trailer = err.stderr ? `: ${err.stderr.split('\n')[0] ?? ''}` : '';
    return `executor: ${err.message}${trailer}`.trim();
  }
  return err instanceof Error ? err.message : String(err);
}

function isTimeoutAbort(signal: AbortSignal): boolean {
  return signal.aborted && signal.reason === 'timeout';
}

/**
 * Run a review job in-process. Called fire-and-forget from POST /api/jobs
 * and POST /api/jobs/[id]/rerun. The caller registers the AbortController
 * in the registry before calling this so the cancel route can signal it.
 *
 * Chunk inserts are fire-and-forget per chunk (no batcher); the in-flight
 * promise array is drained before finalizing and in the finally block so
 * partial output survives cancel/error.
 */
export async function runJob(
  jobId: string,
  userId: string,
  token: string,
  headSha: string,
  target: unknown,
  signal: AbortSignal,
): Promise<void> {
  const model = process.env.REVIEW_MODEL ?? 'claude-haiku-4-5';
  const executorType = process.env.REVIEW_EXECUTOR ?? 'claude';
  const executor = executorType === 'stub' ? new StubExecutor() : new ClaudeExecutor();

  const log = logger.child({ job_id: jobId, executor: executor.name });
  let cloneDir: string | null = null;
  let seq = 0;
  const inFlight: Promise<void>[] = [];

  try {
    if (signal.aborted) return;

    await markRunning(jobId);
    log.info('job running');

    if (signal.aborted) return;

    const parsed = parseTarget(target);

    let prMeta: { title: string; body: string; author: string } | null = null;
    if (parsed.clone.kind === 'pr' && parsed.pr) {
      const meta = await fetchPullMetadata({
        token,
        owner: parsed.clone.owner,
        repo: parsed.clone.repo,
        number: parsed.pr.number,
        signal,
      });
      prMeta = {
        title: meta.title || parsed.pr.title,
        body: meta.body,
        author: meta.authorLogin,
      };
    }

    const cloneResult = await cloneAndDiff({
      jobId,
      token,
      target: parsed.clone,
      expectedHeadSha: headSha,
      signal,
    });
    cloneDir = cloneResult.cloneDir;

    if (signal.aborted) return;

    const files = await listChangedFiles(runGit, cloneDir, parsed.clone.baseSha, headSha, signal);

    const prData: PrData = await (async () => {
      if (parsed.clone.kind === 'pr' && prMeta) {
        return {
          title: prMeta.title,
          body: prMeta.body,
          author: prMeta.author,
          baseRefName: 'base',
          headRefName: parsed.clone.headRef,
          files,
          diff: cloneResult.diff,
        };
      }
      const branchMeta = await readBranchMetadata(cloneDir!, signal);
      const branch = parsed.clone as Extract<CloneTarget, { kind: 'branch' }>;
      return {
        title: `Branch ${branch.ref}`,
        body: branchMeta.body,
        author: branchMeta.author,
        baseRefName: branch.baseRef,
        headRefName: branch.ref,
        files,
        diff: cloneResult.diff,
      };
    })();

    const onChunk = (text: string): void => {
      const currentSeq = seq++;
      inFlight.push(
        insertChunk(jobId, currentSeq, text).catch((err: unknown) => {
          log.error({ err, seq: currentSeq }, 'insertChunk failed');
        }),
      );
    };

    const result = await executor.run({
      cloneDir,
      prData,
      filteredDiff: cloneResult.diff,
      target: parsed.clone,
      signal,
      model,
      jobId,
      onChunk,
    });

    if (signal.aborted) return;

    // Drain in-flight chunk inserts before flipping status to 'done' so a
    // subscriber observing status='done' already sees the full chunk stream.
    await Promise.allSettled(inFlight);

    await finalizeAsDone(
      jobId,
      userId,
      {
        ...result.review,
        files: prData.files.map((file) => ({
          filename: file.filename,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
        })),
      },
      { diffTruncated: result.wasTruncated },
    );
    log.info('job done');
  } catch (err) {
    if (signal.aborted) return;
    const message = formatJobError(err);
    log.error({ err }, `job errored: ${message}`);
    await markErrored(jobId, userId, message);
  } finally {
    // Tail flush — partial chunks survive cancel/error paths.
    await Promise.allSettled(inFlight);
    // Ensure 'cancelled' status is written if aborted (handles the narrow
    // race where markRunning overwrote a cancel the route set just before us).
    // Skip when the abort reason is 'timeout' — the timeout writer already
    // set status='error' and overwriting it with 'cancelled' would lie.
    if (signal.aborted && !isTimeoutAbort(signal)) {
      await markCancelled(jobId, userId).catch((err: unknown) => {
        log.warn({ err }, 'failed to mark job cancelled');
      });
    }
    if (cloneDir) await cleanupWorkDir(cloneDir);
  }
}
