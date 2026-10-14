import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextExcerpt, NarrativeReview } from '../review/narrative.ts';
import { createTempRepo, GIT_TEST_TIMEOUT, type TempRepo } from '../test/git-repo.ts';
import { dirtyPaths, MAX_EMBED_BYTES } from './context.ts';
import { checkExcerpts, readExcerpts } from './excerpts.ts';
import { Shell } from './git.ts';
import { runGit } from './git-runner.ts';
import { runFiles } from './run-folder.ts';

// Real git, many spawns per test — see GIT_TEST_TIMEOUT.
vi.setConfig({ testTimeout: GIT_TEST_TIMEOUT, hookTimeout: GIT_TEST_TIMEOUT });

let repo: TempRepo;
let shell: Shell;
let head: string;

const RUNNER = Array.from({ length: 20 }, (_, i) => `line ${String(i + 1)}`).join('\n') + '\n';

beforeEach(() => {
  repo = createTempRepo();
  shell = new Shell(repo.work, {
    git: runGit,
    gh: () => Promise.reject(new Error('no gh in tests')),
  });
  repo.write('src/runner.ts', RUNNER);
  repo.write('src/no-newline.ts', 'one\ntwo');
  repo.write('assets/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a]));
  head = repo.commit('add the files the excerpts read');
});
afterEach(() => repo.cleanup());

const excerpt = (filename: string, startLine: number, endLine: number): ContextExcerpt => ({
  filename,
  startLine,
  endLine,
  reason: 'Reads what the change now writes.',
});

function review(...perChapter: ContextExcerpt[][]): NarrativeReview {
  return {
    prTitle: 't',
    overviewSummary: { lede: 's' },
    chapters: perChapter.map((contextExcerpts, index) => ({
      id: `c${String(index + 1)}`,
      title: 'C',
      insights: [],
      diffChunks: [],
      ...(contextExcerpts.length > 0 ? { contextExcerpts } : {}),
    })),
  };
}

describe('excerpts held to the head commit', () => {
  it('keeps an excerpt inside a file the head commit has, and reads that file', async () => {
    const kept = [excerpt('src/runner.ts', 5, 20), excerpt('src/no-newline.ts', 1, 2)];
    const checked = await checkExcerpts(review(kept), head, [], shell);

    expect(checked.review.chapters[0]?.contextExcerpts).toEqual(kept);
    expect(checked.contents).toEqual({ 'src/runner.ts': RUNNER, 'src/no-newline.ts': 'one\ntwo' });
    expect(checked.dropped).toBeNull();
  });

  it('keeps a root file named after an object member as a file of its own', async () => {
    repo.write('constructor', 'one\n');
    repo.write('__proto__', 'two\n');
    const withNames = repo.commit('add files named after object members');
    const checked = await checkExcerpts(
      review([excerpt('constructor', 1, 1), excerpt('__proto__', 1, 1)]),
      withNames,
      [],
      shell,
    );
    expect(checked.dropped).toBeNull();
    expect(Object.entries(checked.contents)).toEqual([
      ['constructor', 'one\n'],
      ['__proto__', 'two\n'],
    ]);
  });

  it('reads no git for a review without excerpts', async () => {
    const noGit = new Shell(repo.work, {
      git: () => Promise.reject(new Error('read git')),
      gh: () => Promise.reject(new Error('read gh')),
    });
    const checked = await checkExcerpts(review([]), head, [], noGit);
    expect(checked).toEqual({ review: review([]), contents: {}, dropped: null });
  });

  it('drops a missing file, a span past the end and a binary file, in one warning', async () => {
    const checked = await checkExcerpts(
      review(
        [excerpt('src/runner.ts', 1, 4), excerpt('src/gone.ts', 1, 3)],
        [excerpt('src/runner.ts', 15, 21), excerpt('assets/logo.png', 1, 1)],
      ),
      head,
      [],
      shell,
    );

    expect(checked.review.chapters.map((chapter) => chapter.contextExcerpts)).toEqual([
      [excerpt('src/runner.ts', 1, 4)],
      undefined,
    ]);
    expect('contextExcerpts' in checked.review.chapters[1]!).toBe(false);
    expect(checked.contents).toEqual({ 'src/runner.ts': RUNNER });
    expect(checked.dropped).toMatchObject({ code: 'excerpt-dropped', severity: 'warning' });
    expect(checked.dropped?.message).toBe(
      '3 excerpts of unchanged code were dropped: ' +
        'src/gone.ts L1–3 in chapter c1 (not in the head commit); ' +
        'src/runner.ts L15–21 in chapter c2 (the file has 20 lines); ' +
        'assets/logo.png L1–1 in chapter c2 (a binary file).',
    );
  });

  it('reads the file at the head commit, not as the working tree has it now', async () => {
    repo.write('src/runner.ts', 'one line now\n');
    repo.commit('shrink the runner after the reviewed commit');

    const checked = await checkExcerpts(
      review([excerpt('src/runner.ts', 18, 20)]),
      head,
      [],
      shell,
    );
    expect(checked.contents['src/runner.ts']).toBe(RUNNER);
    expect(checked.dropped).toBeNull();
  });

  it('drops a file over the size gather embeds, and a directory', async () => {
    repo.write('big.txt', 'x'.repeat(MAX_EMBED_BYTES + 1));
    const withBig = repo.commit('add a large file');

    const checked = await checkExcerpts(
      review([excerpt('big.txt', 1, 1), excerpt('src', 1, 1)]),
      withBig,
      [],
      shell,
    );
    expect(checked.review.chapters[0]?.contextExcerpts).toBeUndefined();
    expect(checked.dropped?.message).toContain('big.txt L1–1 in chapter c1 (too large to embed');
    expect(checked.dropped?.message).toContain('src L1–1 in chapter c1 (not in the head commit)');
  });

  it('drops a file edited on disk since the reviewed commit, which the reader could not match', async () => {
    repo.write('src/runner.ts', 'edited but not committed\n');
    const dirty = await dirtyPaths(shell, 'branch');
    expect(dirty).toEqual(['src/runner.ts']);

    const checked = await checkExcerpts(
      review([excerpt('src/runner.ts', 1, 4), excerpt('src/no-newline.ts', 1, 2)]),
      head,
      dirty,
      shell,
    );
    expect(checked.review.chapters[0]?.contextExcerpts).toEqual([
      excerpt('src/no-newline.ts', 1, 2),
    ]);
    expect(checked.contents).toEqual({ 'src/no-newline.ts': 'one\ntwo' });
    expect(checked.dropped?.message).toBe(
      '1 excerpt of unchanged code was dropped: ' +
        'src/runner.ts L1–4 in chapter c1 (changed on disk since the reviewed commit).',
    );
  });

  it('drops a symbolic link, whose blob is the path it points at', async () => {
    // Committed through the index, so the test needs no symlink support from the filesystem.
    const target = path.join(repo.work, '..', 'link-target.txt');
    writeFileSync(target, 'src/runner.ts');
    const oid = repo.git('hash-object', '-w', '--', target).trim();
    repo.git('update-index', '--add', '--cacheinfo', `120000,${oid},src/link.ts`);
    repo.git('commit', '--quiet', '-m', 'link to the runner');
    const withLink = repo.git('rev-parse', 'HEAD').trim();

    const checked = await checkExcerpts(
      review([excerpt('src/link.ts', 1, 1)]),
      withLink,
      [],
      shell,
    );
    expect(checked.review.chapters[0]?.contextExcerpts).toBeUndefined();
    expect(checked.contents).toEqual({});
    expect(checked.dropped?.message).toContain(
      'src/link.ts L1–1 in chapter c1 (a symbolic link at the head commit)',
    );
  });
});

describe('excerpts.json', () => {
  let folder: string;
  beforeEach(() => {
    folder = mkdtempSync(path.join(tmpdir(), 'cli-test-excerpts-'));
  });
  afterEach(() => rmSync(folder, { recursive: true, force: true }));

  it('reads back what the parse stage wrote', async () => {
    const run = runFiles(folder);
    writeFileSync(run.excerpts, JSON.stringify({ 'src/runner.ts': RUNNER }));
    await expect(readExcerpts(run)).resolves.toEqual({ 'src/runner.ts': RUNNER });
  });

  it('says to run from parse when it is missing or cut off', async () => {
    const run = runFiles(folder);
    await expect(readExcerpts(run)).rejects.toThrow(/no excerpts\.json in .*run from parse/);
    writeFileSync(run.excerpts, '{"src/runner.ts": "li');
    await expect(readExcerpts(run)).rejects.toThrow(/not fully written; run from parse/);
  });
});
