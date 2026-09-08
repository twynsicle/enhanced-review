import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { listChunksAfter } from '../../db/review-chunks.ts';
import { cancelJob, createJob, findJobById } from '../../db/review-jobs.ts';
import { findReviewByJobId } from '../../db/reviews.ts';
import { upsertUserFromGithub } from '../../db/users.ts';
import { describeDb, resetDb } from '../../test/db.ts';
import { runGit, runGitOrThrow } from './clone/git-runner.server.ts';
import { StubExecutor } from './executor/stub-executor.server.ts';
import type { ReviewExecutor } from './executor/types.ts';
import { NarrativeReviewSchema } from './narrative.ts';
import { parseNarrativeReview } from './prompt/parse-narrative.ts';
import { runJob, type RunJobDeps } from './run.server.ts';
import type { ReviewTarget } from './target.ts';

/**
 * The stub review end to end (phase-3-plan P3-D10): a real local git
 * repository stands in for GitHub via a `file://` clone URL, the stub
 * executor stands in for the model, and Postgres is real.
 */
interface Fixture {
  root: string;
  cloneUrl: string;
  baseSha: string;
  headSha: string;
}

let fixture: Fixture;

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await runGitOrThrow(runGit, args[0] ?? 'git', {
    args,
    cwd,
    env: {
      GIT_AUTHOR_NAME: 'Fixture Author',
      GIT_AUTHOR_EMAIL: 'fixture@example.test',
      GIT_COMMITTER_NAME: 'Fixture Author',
      GIT_COMMITTER_EMAIL: 'fixture@example.test',
    },
  });
  return result.stdout.trim();
}

async function buildFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), 'er-run-fixture-'));
  const repo = path.join(root, 'source');
  await runGitOrThrow(runGit, 'init', { args: ['init', '--quiet', '-b', 'main', repo] });
  await writeFile(path.join(repo, 'hello.txt'), 'hello\n');
  await git(repo, 'add', 'hello.txt');
  await git(repo, 'commit', '--quiet', '-m', 'initial');
  const baseSha = await git(repo, 'rev-parse', 'HEAD');

  await git(repo, 'checkout', '--quiet', '-b', 'feature');
  await writeFile(path.join(repo, 'hello.txt'), 'goodbye\n');
  await git(repo, 'commit', '--quiet', '-am', 'change greeting\n\nBecause reasons.');
  const headSha = await git(repo, 'rev-parse', 'HEAD');
  // GitHub exposes PR heads as refs/pull/N/head; mirror that locally.
  await git(repo, 'update-ref', 'refs/pull/1/head', headSha);

  return { root, cloneUrl: pathToFileURL(repo).href, baseSha, headSha };
}

function branchTarget(): ReviewTarget {
  return {
    kind: 'branch',
    owner: 'local',
    repo: 'source',
    ref: 'feature',
    baseRef: 'main',
    headSha: fixture.headSha,
    baseSha: fixture.baseSha,
  };
}

function prTarget(): ReviewTarget {
  return {
    kind: 'pr',
    owner: 'local',
    repo: 'source',
    number: 1,
    headSha: fixture.headSha,
    baseSha: fixture.baseSha,
    title: 'Change greeting',
  };
}

function deps(executor: ReviewExecutor = new StubExecutor({ fragmentDelayMs: 0 })): RunJobDeps {
  return {
    executor,
    git: runGit,
    cloneUrlFor: () => fixture.cloneUrl,
    getPullMetadata: async () => ({
      ok: true,
      data: {
        title: 'Change greeting (live)',
        authorLogin: 'fixture',
        authorAvatarUrl: null,
        body: 'PR body',
        baseRefName: 'main',
        headRefName: 'feature',
        baseSha: fixture.baseSha,
        headSha: fixture.headSha,
        changedFiles: 1,
        additions: 1,
        deletions: 1,
        htmlUrl: 'https://example.test/pull/1',
      },
    }),
  };
}

async function makeJob(target: ReviewTarget) {
  const user = await upsertUserFromGithub({
    githubId: 4242n,
    githubLogin: 'fixture',
    name: null,
    avatarUrl: null,
  });
  const job = await createJob({ userId: user.id, target, headSha: target.headSha });
  return { user, job };
}

describeDb('runJob (stub executor against a local git repository)', () => {
  beforeAll(async () => {
    fixture = await buildFixture();
  });
  afterAll(async () => {
    await rm(fixture.root, { recursive: true, force: true });
  });
  beforeEach(resetDb);

  it('takes a branch job from pending to done with chunks, files and a risk score', async () => {
    const { job } = await makeJob(branchTarget());

    const outcome = await runJob(
      {
        jobId: job.id,
        token: 'unused-for-file-urls',
        target: branchTarget(),
        headSha: fixture.headSha,
        model: 'stub',
        signal: new AbortController().signal,
      },
      deps(),
    );
    expect(outcome).toBe('done');

    const finished = await findJobById(job.id);
    expect(finished).toMatchObject({ status: 'done', riskScore: 2, errorMessage: null });
    expect(finished?.startedAt).toBeInstanceOf(Date);
    expect(finished?.completedAt).toBeInstanceOf(Date);

    const chunks = await listChunksAfter(job.id);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.map((c) => c.seq)).toEqual(chunks.map((_, i) => i));
    const replayed = parseNarrativeReview(chunks.map((c) => c.content).join(''));
    expect(replayed.ok && replayed.data.prTitle).toBe('Stub review');

    const review = await findReviewByJobId(job.id);
    expect(review?.diffTruncated).toBe(false);
    const content = NarrativeReviewSchema.parse(review?.content);
    expect(content.chapters.map((c) => c.id)).toEqual([
      'stub-chapter-1',
      'stub-chapter-2',
      'stub-chapter-3',
    ]);
    expect(content.files).toEqual([
      { filename: 'hello.txt', status: 'modified', additions: 1, deletions: 1 },
    ]);
  });

  it('runs a PR job by fetching refs/pull/N/head', async () => {
    const { job } = await makeJob(prTarget());
    let seen: string | undefined;
    const executor: ReviewExecutor = {
      name: 'capture',
      async run(input) {
        seen = `${input.prData.title}|${input.prData.author}|${input.prData.headRefName}`;
        return new StubExecutor({ fragmentDelayMs: 0 }).run(input);
      },
    };

    const outcome = await runJob(
      {
        jobId: job.id,
        token: 'unused',
        target: prTarget(),
        headSha: fixture.headSha,
        model: 'stub',
        signal: new AbortController().signal,
      },
      deps(executor),
    );
    expect(outcome).toBe('done');
    expect(seen).toBe('Change greeting (live)|fixture|pull/1/head');
    expect((await findJobById(job.id))?.status).toBe('done');
  });

  it('cancelled mid-executor: status stays cancelled and partial chunks survive', async () => {
    const { user, job } = await makeJob(branchTarget());
    const controller = new AbortController();
    const executor: ReviewExecutor = {
      name: 'cancel-once',
      async run(input) {
        input.onChunk?.('<narrative_review>{');
        // What the cancel action does: write the status, then signal the runner.
        expect(await cancelJob(job.id, user.id)).toBe(true);
        controller.abort('cancel');
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      },
    };

    const outcome = await runJob(
      {
        jobId: job.id,
        token: 'unused',
        target: branchTarget(),
        headSha: fixture.headSha,
        model: 'stub',
        signal: controller.signal,
      },
      deps(executor),
    );
    expect(outcome).toBe('aborted');
    expect((await findJobById(job.id))?.status).toBe('cancelled');
    expect(await listChunksAfter(job.id)).toMatchObject([
      { seq: 0, content: '<narrative_review>{' },
    ]);
    expect(await findReviewByJobId(job.id)).toBeNull();
  });

  it('a stale head SHA ends in error with a clone message', async () => {
    const stale = { ...branchTarget(), headSha: '0'.repeat(40) };
    const { job } = await makeJob(stale);
    const outcome = await runJob(
      {
        jobId: job.id,
        token: 'unused',
        target: stale,
        headSha: stale.headSha,
        model: 'stub',
        signal: new AbortController().signal,
      },
      deps(),
    );
    expect(outcome).toBe('errored');
    const errored = await findJobById(job.id);
    expect(errored?.status).toBe('error');
    expect(errored?.errorMessage).toMatch(/^clone: head SHA changed since job submit/);
  });
});
