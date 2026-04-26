import type { SupabaseClient } from '@supabase/supabase-js';

import {
  cleanupWorkDir,
  cloneAndDiff,
  HeadShaMismatchError,
  type CloneTarget,
} from './clone/clone-runner';
import { listChangedFiles } from './clone/diff-files';
import { GitCommandError, runGit, runGitOrThrow } from './clone/git-runner';
import {
  TokenMissingError,
  claimGithubToken,
  clearGithubToken,
} from './clone/token-store';
import { OpencodeExecutor } from './executor/opencode-executor';
import {
  ExecutorParseError,
  ExecutorProcessError,
  type ReviewExecutor,
} from './executor/types';
import { GithubFetchError, fetchPullMetadata } from './github';
import type { PrData } from './prompt/types';
import {
  StreamCapExceededError,
  createChunkBatcher,
  type ChunkBatcher,
} from './streaming/chunk-batcher';
import type { ClaimedJob } from './types';
import { finalizeAsDone, markErrored } from './writes';

/**
 * Glue layer between the session's claim → runJob loop and the actual
 * clone-and-execute pipeline. Replaces Phase 3's `runStubJob` for real
 * jobs (the stub stays around for tests / `REVIEW_EXECUTOR=stub`).
 *
 * The signal passed in by the session fires when the user cancels the
 * job (or the connection drops). We propagate it into clone + executor
 * so subprocesses are torn down promptly.
 */

export interface RunOpencodeJobDeps {
  supabase: SupabaseClient;
  /** Test seam: substitute a fake executor. */
  executor?: ReviewExecutor;
  /** Defaults to env REVIEW_MODEL or `opencode-zen/glm-4.7`. */
  model?: string;
  /** Test seam: bypass the real `child_process.spawn`-backed git. */
  gitRunner?: typeof runGit;
  /** Test seam: substitute the chunk batcher (e.g. to inject fake timers). */
  createBatcher?: (jobId: string) => ChunkBatcher;
}

export type OpencodeJobOutcome = 'done' | 'cancelled' | 'errored';

interface ParsedTarget {
  clone: CloneTarget;
  /** PR-only fields used to enrich PrData. */
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
    // For PRs the picker stores the head ref name in the URL only — we
    // re-derive a fetchable ref from the PR number using GitHub's
    // refs/pull/{n}/head, but for clone we need a normal branch ref.
    // Fall back to head SHA detached fetch if no headRef. The clone
    // runner uses --branch, which accepts both branches and tags.
    // We persist headRef separately when we have it.
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
  runner: typeof runGit,
  cwd: string,
  signal?: AbortSignal,
): Promise<{ author: string; body: string }> {
  // %an = author name, %B = body (subject + body). Trim trailing newline.
  const result = await runGitOrThrow(runner, 'log -1 --format', {
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

export async function runOpencodeJob(
  deps: RunOpencodeJobDeps,
  job: ClaimedJob,
  signal: AbortSignal,
): Promise<OpencodeJobOutcome> {
  const model = deps.model ?? process.env.REVIEW_MODEL ?? 'opencode-zen/glm-4.7';
  const executor = deps.executor ?? new OpencodeExecutor();
  const gitRunner = deps.gitRunner ?? runGit;
  const createBatcher =
    deps.createBatcher ??
    ((jobId: string) => createChunkBatcher({ supabase: deps.supabase, jobId }));

  let cloneDir: string | null = null;
  let token: string | null = null;
  let batcher: ChunkBatcher | null = null;

  try {
    const target = parseTarget(job.target);

    token = await claimGithubToken(deps.supabase, job.id);

    // For PRs, fetch body+author from GitHub before the clone (we still
    // have the token). Branch metadata comes from `git log` post-clone.
    let prMeta: { title: string; body: string; author: string } | null = null;
    if (target.clone.kind === 'pr' && target.pr) {
      const meta = await fetchPullMetadata({
        token,
        owner: target.clone.owner,
        repo: target.clone.repo,
        number: target.pr.number,
        signal,
      });
      prMeta = {
        title: meta.title || target.pr.title,
        body: meta.body,
        author: meta.authorLogin,
      };
    }

    const cloneResult = await cloneAndDiff(
      {
        jobId: job.id,
        token,
        target: target.clone,
        expectedHeadSha: job.head_sha,
        signal,
      },
      { gitRunner },
    );
    cloneDir = cloneResult.cloneDir;

    // Token has done its job. Null it eagerly — even if the rest of the
    // pipeline fails, the encrypted column is gone.
    await clearGithubToken(deps.supabase, job.id);
    token = null;

    if (signal.aborted) {
      return 'cancelled';
    }

    const files = await listChangedFiles(
      gitRunner,
      cloneDir,
      target.clone.baseSha,
      job.head_sha,
      signal,
    );

    const prData: PrData = await (async () => {
      if (target.clone.kind === 'pr' && prMeta) {
        return {
          title: prMeta.title,
          body: prMeta.body,
          author: prMeta.author,
          baseRefName: 'base',
          headRefName: target.clone.headRef,
          files,
          diff: cloneResult.diff,
        };
      }
      const branchMeta = await readBranchMetadata(gitRunner, cloneDir!, signal);
      const branch = target.clone as Extract<CloneTarget, { kind: 'branch' }>;
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

    batcher = createBatcher(job.id);

    const result = await executor.run({
      cloneDir,
      prData,
      filteredDiff: cloneResult.diff,
      target: target.clone,
      signal,
      model,
      onChunk: batcher.onChunk,
    });

    if (signal.aborted) {
      return 'cancelled';
    }

    // Drain any in-flight / buffered chunks before flipping status to
    // `done` so a subscriber that observes `done` already sees the full
    // chunk stream rebuilt on reload.
    await batcher.flush();

    await finalizeAsDone(deps.supabase, job.id, result.review, {
      diffTruncated: result.wasTruncated,
    });
    return 'done';
  } catch (err) {
    if (signal.aborted) {
      return 'cancelled';
    }
    await markErrored(deps.supabase, job.id, formatJobError(err));
    return 'errored';
  } finally {
    // Best-effort tail flush so partial chunks survive cancel / error.
    // No reviews row will exist in those paths; the chunks are the only
    // record of what was streamed.
    if (batcher !== null) {
      try {
        await batcher.flush();
      } catch {
        /* swallowed: tail flush after error/cancel is best-effort */
      }
    }
    // Token is normally cleared mid-flight; this catches the failure path.
    if (token !== null) {
      await clearGithubToken(deps.supabase, job.id);
    }
    if (cloneDir !== null) {
      await cleanupWorkDir(cloneDir);
    }
  }
}

function formatJobError(err: unknown): string {
  if (err instanceof TokenMissingError) {
    return `token: ${err.message}`;
  }
  if (err instanceof HeadShaMismatchError) {
    return `clone: ${err.message}. Submit a fresh review.`;
  }
  if (err instanceof GitCommandError) {
    return `clone: ${err.message}: ${err.stderr.split('\n')[0] ?? ''}`.trim();
  }
  if (err instanceof GithubFetchError) {
    return `github: ${err.message}`;
  }
  if (err instanceof StreamCapExceededError) {
    return 'stream cap exceeded';
  }
  if (err instanceof ExecutorParseError) {
    return `parse: ${err.message}`;
  }
  if (err instanceof ExecutorProcessError) {
    return `executor: ${err.message}: ${err.stderr.split('\n')[0] ?? ''}`.trim();
  }
  return err instanceof Error ? err.message : String(err);
}
