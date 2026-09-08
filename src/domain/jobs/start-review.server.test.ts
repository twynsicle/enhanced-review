import { describe, expect, it, vi } from 'vitest';
import type { ReviewJobRecord } from '../../db/review-jobs.ts';
import { GithubAuthError } from '../github/client.server.ts';
import type { RunJobOutcome } from '../review/run.server.ts';
import type { ReviewTarget } from '../review/target.ts';
import { HeadShaResolutionError, JobInFlightError, JobNotFoundError } from './errors.ts';
import { createRegistry } from './registry.server.ts';
import {
  launchJob,
  rerunJob,
  startReview,
  type LaunchDeps,
  type StartReviewDeps,
} from './start-review.server.ts';

const TARGET: ReviewTarget = {
  kind: 'pr',
  owner: 'acme',
  repo: 'widgets',
  number: 12,
  headSha: 'oldSha',
  baseSha: 'oldBase',
  title: 'old title',
};

const FRESH = { ...TARGET, title: 'fresh title', headSha: 'newSha', baseSha: 'newBase' };

function record(overrides: Partial<ReviewJobRecord> = {}): ReviewJobRecord {
  return {
    id: 'source-1',
    userId: 'user-1',
    githubLogin: 'alice',
    target: TARGET,
    status: 'done',
    headSha: 'oldSha',
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    errorMessage: null,
    riskScore: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function deps(overrides: Partial<StartReviewDeps> = {}): StartReviewDeps {
  return {
    findInFlightJob: vi.fn().mockResolvedValue(null),
    createJob: vi.fn().mockResolvedValue(record({ id: 'new-job', status: 'pending' })),
    findJobById: vi.fn().mockResolvedValue(record()),
    octokitFor: vi.fn().mockReturnValue({ request: vi.fn(), graphql: vi.fn() }),
    resolveTarget: vi.fn().mockResolvedValue({ target: FRESH, headSha: 'newSha' }),
    launch: vi.fn(),
    maxJobsPerUser: 1,
    ...overrides,
  };
}

describe('startReview', () => {
  it('re-pins the target, inserts a pending job for the user and launches it', async () => {
    const d = deps();
    await expect(
      startReview({ userId: 'user-2', token: 'gh-token', target: TARGET }, d),
    ).resolves.toEqual({ id: 'new-job' });

    expect(d.findInFlightJob).toHaveBeenCalledWith('user-2', 1);
    expect(d.octokitFor).toHaveBeenCalledWith('gh-token');
    expect(d.createJob).toHaveBeenCalledWith({
      userId: 'user-2',
      target: FRESH,
      headSha: 'newSha',
    });
    expect(d.launch).toHaveBeenCalledWith({
      jobId: 'new-job',
      token: 'gh-token',
      target: FRESH,
      headSha: 'newSha',
    });
  });

  it('refuses while the user has a job in flight, naming it', async () => {
    const d = deps({
      findInFlightJob: vi.fn().mockResolvedValue({ id: 'busy-job', status: 'running' }),
    });
    const err = await startReview({ userId: 'u', token: 't', target: TARGET }, d).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(JobInFlightError);
    expect((err as JobInFlightError).activeJobId).toBe('busy-job');
    expect(d.resolveTarget).not.toHaveBeenCalled();
    expect(d.createJob).not.toHaveBeenCalled();
  });

  it('lets a GitHub auth failure through unchanged (the caller redirects to /relink)', async () => {
    const auth = new GithubAuthError();
    const d = deps({ resolveTarget: vi.fn().mockRejectedValue(auth) });
    await expect(startReview({ userId: 'u', token: 't', target: TARGET }, d)).rejects.toBe(auth);
    expect(d.createJob).not.toHaveBeenCalled();
  });

  it('wraps other GitHub failures in HeadShaResolutionError', async () => {
    const network = new Error('network');
    const d = deps({ resolveTarget: vi.fn().mockRejectedValue(network) });
    const err = await startReview({ userId: 'u', token: 't', target: TARGET }, d).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(HeadShaResolutionError);
    expect((err as Error).cause).toBe(network);
    expect(d.createJob).not.toHaveBeenCalled();
  });
});

describe('rerunJob', () => {
  it('copies the source target, owned by the viewer, pinned to the current head', async () => {
    const d = deps();
    await expect(
      rerunJob({ userId: 'viewer', token: 'viewer-token', sourceJobId: 'source-1' }, d),
    ).resolves.toEqual({ id: 'new-job' });
    expect(d.findJobById).toHaveBeenCalledWith('source-1');
    expect(d.resolveTarget).toHaveBeenCalledWith(expect.anything(), TARGET);
    expect(d.createJob).toHaveBeenCalledWith({
      userId: 'viewer',
      target: FRESH,
      headSha: 'newSha',
    });
    expect(d.launch).toHaveBeenCalledWith(expect.objectContaining({ token: 'viewer-token' }));
  });

  it('reports a missing source job before checking the in-flight cap', async () => {
    const d = deps({ findJobById: vi.fn().mockResolvedValue(null) });
    await expect(
      rerunJob({ userId: 'u', token: 't', sourceJobId: 'ghost' }, d),
    ).rejects.toBeInstanceOf(JobNotFoundError);
    expect(d.findInFlightJob).not.toHaveBeenCalled();
  });

  it('rejects a source job whose stored target does not parse', async () => {
    const d = deps({ findJobById: vi.fn().mockResolvedValue(record({ target: { kind: 'x' } })) });
    await expect(rerunJob({ userId: 'u', token: 't', sourceJobId: 'source-1' }, d)).rejects.toThrow(
      /kind/,
    );
  });
});

function launchDeps(overrides: Partial<LaunchDeps> = {}) {
  const registry = createRegistry();
  const disarm = vi.fn();
  const base: LaunchDeps = {
    registry,
    runJob: vi.fn().mockResolvedValue('done' as RunJobOutcome),
    runDeps: vi.fn().mockReturnValue({ fake: true }),
    armTimeout: vi.fn().mockReturnValue(disarm),
    markErrored: vi.fn().mockResolvedValue(true),
    timeoutMinutes: 15,
    model: 'claude-haiku-4-5',
    ...overrides,
  };
  return { d: base, registry, disarm };
}

const LAUNCH_INPUT = { jobId: 'j1', token: 't', target: TARGET, headSha: 'newSha' };

describe('launchJob', () => {
  const input = LAUNCH_INPUT;

  it('registers, arms the timeout, runs with the controller signal, then cleans up', async () => {
    const { d, registry, disarm } = launchDeps();
    let seenSignal: AbortSignal | undefined;
    vi.mocked(d.runJob).mockImplementation(async (runInput) => {
      seenSignal = runInput.signal;
      expect(registry.size()).toBe(1);
      expect(registry.signal('j1', 'cancel')).toBe(true);
      return 'aborted';
    });

    await expect(launchJob(input, d)).resolves.toBe('aborted');

    expect(d.armTimeout).toHaveBeenCalledWith('j1', expect.any(AbortController), { minutes: 15 });
    expect(d.runJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'j1',
        token: 't',
        target: TARGET,
        headSha: 'newSha',
        model: 'claude-haiku-4-5',
      }),
      { fake: true },
    );
    expect(seenSignal?.reason).toBe('cancel');
    expect(disarm).toHaveBeenCalledTimes(1);
    expect(registry.size()).toBe(0);
  });

  it('marks the job errored and resolves when the runner itself crashes', async () => {
    const { d, registry, disarm } = launchDeps({
      runJob: vi.fn().mockRejectedValue(new Error('kaboom')),
    });
    await expect(launchJob(input, d)).resolves.toBe('errored');
    expect(d.markErrored).toHaveBeenCalledWith('j1', 'runner crashed: kaboom');
    expect(disarm).toHaveBeenCalled();
    expect(registry.size()).toBe(0);
  });
});
