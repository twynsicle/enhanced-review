import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runGit } from './git-runner.ts';
import { createTempRepo, GIT_TEST_TIMEOUT, type TempRepo } from '../test/git-repo.ts';
import { gather, MAX_EMBED_BYTES, readContext } from './context.ts';
import { Shell } from './git.ts';
import { createRunFolder } from './run-folder.ts';
import { resolveTarget, type TargetRequest } from './targets.ts';

// Real git, many spawns per test — see GIT_TEST_TIMEOUT.
vi.setConfig({ testTimeout: GIT_TEST_TIMEOUT, hookTimeout: GIT_TEST_TIMEOUT });

let repo: TempRepo;
let runsRoot: string;

beforeEach(() => {
  repo = createTempRepo();
  runsRoot = mkdtempSync(path.join(tmpdir(), 'cli-test-runs-'));
});
afterEach(() => {
  repo.cleanup();
  rmSync(runsRoot, { recursive: true, force: true });
});

const noGh = async () => ({ stdout: '', stderr: 'no gh in tests', exitCode: 1 });

async function gatherFor(request: TargetRequest) {
  const shell = new Shell(repo.work, { git: runGit, gh: noGh });
  const { target, meta } = await resolveTarget(request, shell, { warn: () => undefined });
  const run = await createRunFolder(runsRoot, target.slug, new Date(2026, 8, 11, 14, 30, 5));
  return { context: await gather(target, meta, shell.at(target.repoRoot), run), run };
}

const lines = (count: number, label: string) =>
  Array.from({ length: count }, (_, i) => `${label} ${String(i + 1)}`).join('\n') + '\n';

/** A branch touching one file of every kind gather tells apart. */
function branchOfEveryKind(): void {
  repo.write('src/keep.ts', lines(30, 'keep'));
  repo.write('src/old-name.ts', lines(12, 'moved'));
  repo.write('src/gone.ts', 'export const gone = true;\n');
  repo.write('api/client.gen.ts', 'export const client = 1;\n');
  repo.write('package-lock.json', '{ "lockfileVersion": 3 }\n');
  repo.commit('the files the branch will touch');
  repo.git('push', '--quiet', 'origin', 'main');

  repo.git('checkout', '--quiet', '-b', 'feat/every-kind');
  repo.write(
    'src/keep.ts',
    lines(30, 'keep').replace('keep 2\n', 'keep two\n').replace('keep 28\n', 'keep 28\nadded\n'),
  );
  repo.git('mv', 'src/old-name.ts', 'src/new-name.ts');
  repo.write('src/new-name.ts', lines(12, 'moved').replace('moved 6\n', 'moved six\n'));
  repo.git('rm', '--quiet', 'src/gone.ts');
  repo.write('.gitattributes', 'api/*.gen.ts linguist-generated\nvendor/** linguist-vendored\n');
  repo.write('api/client.gen.ts', 'export const client = 2;\n');
  repo.write('vendor/lib.js', 'module.exports = {};\n');
  repo.write('assets/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
  repo.write('package-lock.json', '{ "lockfileVersion": 3, "packages": {} }\n');
  repo.write('data/huge.txt', 'x'.repeat(MAX_EMBED_BYTES + 1));
  repo.commit('touch every kind of file');
  repo.write('src/keep.ts', 'uncommitted edit\n');
  repo.write('scratch.txt', 'untracked\n');
}

describe('gather', () => {
  it('lists every changed file and marks the ones left out', async () => {
    branchOfEveryKind();
    const { context } = await gatherFor({ kind: 'branch', base: 'main' });

    const byName = Object.fromEntries(context.files.map((file) => [file.filename, file]));
    expect(Object.keys(byName).toSorted()).toEqual([
      '.gitattributes',
      'api/client.gen.ts',
      'assets/logo.png',
      'data/huge.txt',
      'package-lock.json',
      'src/gone.ts',
      'src/keep.ts',
      'src/new-name.ts',
      'vendor/lib.js',
    ]);
    expect(byName['api/client.gen.ts']?.skipped).toBe('generated');
    expect(byName['vendor/lib.js']?.skipped).toBe('vendored');
    expect(byName['assets/logo.png']?.skipped).toBe('binary');
    expect(byName['package-lock.json']?.skipped).toBe('built-in');
    expect(byName['src/keep.ts']).toEqual({
      filename: 'src/keep.ts',
      status: 'modified',
      additions: 2,
      deletions: 1,
    });
    expect(byName['src/new-name.ts']).toMatchObject({
      status: 'renamed',
      origin: { filename: 'src/old-name.ts', similarity: expect.any(Number) },
    });
    expect(context.meta.stats).toEqual({
      changedFiles: 9,
      additions: context.files.reduce((sum, file) => sum + file.additions, 0),
      deletions: context.files.reduce((sum, file) => sum + file.deletions, 0),
    });
  });

  it('numbers the reviewed files’ hunks across the change, in file order', async () => {
    branchOfEveryKind();
    const { context } = await gatherFor({ kind: 'branch', base: 'main' });

    expect(context.hunks.map((hunk) => hunk.id)).toEqual(
      context.hunks.map((_, i) => `H${String(i + 1).padStart(4, '0')}`),
    );
    const skipped = new Set(context.files.filter((f) => f.skipped).map((f) => f.filename));
    expect(context.hunks.filter((hunk) => skipped.has(hunk.filename))).toEqual([]);
    const keep = context.hunks.filter((hunk) => hunk.filename === 'src/keep.ts');
    expect(keep.map((hunk) => hunk.fileOrder)).toEqual([1, 2]);
    expect(keep[0]?.original).toEqual({ startLine: 1, lineCount: 5 });
    expect(context.hunks.find((hunk) => hunk.filename === 'src/new-name.ts')).toBeDefined();
  });

  it('embeds both sides of each reviewed file, reading a rename’s base from its old path', async () => {
    branchOfEveryKind();
    const { context } = await gatherFor({ kind: 'branch', base: 'main' });

    expect(Object.keys(context.contents).toSorted()).toEqual([
      '.gitattributes',
      'data/huge.txt',
      'src/gone.ts',
      'src/keep.ts',
      'src/new-name.ts',
    ]);
    expect(context.contents['src/new-name.ts']?.base).toEqual({
      kind: 'content',
      content: lines(12, 'moved'),
    });
    expect(context.contents['src/gone.ts']).toEqual({
      base: { kind: 'content', content: 'export const gone = true;\n' },
      head: { kind: 'absent' },
    });
    expect(context.contents['data/huge.txt']).toEqual({
      base: { kind: 'absent' },
      head: { kind: 'too-large' },
    });
    // The committed head, not the uncommitted edit on disk.
    expect(context.contents['src/keep.ts']?.head).toMatchObject({ kind: 'content' });
    expect(JSON.stringify(context.contents['src/keep.ts']?.head)).toContain('keep two');
  });

  describe('a rename git cannot see across the whole range', () => {
    /** A branch off main that moves `from`, commit by commit, through `moves`, then rewrites it with `rewrite`. */
    function moveThenRewrite(from: string, moves: readonly string[], rewrite: string): void {
      repo.write(from, lines(40, 'line'));
      repo.commit('the file the branch will move');
      repo.git('push', '--quiet', 'origin', 'main');
      repo.git('checkout', '--quiet', '-b', 'feat/move');
      let at = from;
      for (const to of moves) {
        repo.git('mv', at, to);
        repo.commit(`move ${at} to ${to}`);
        at = to;
      }
      repo.write(at, rewrite);
      repo.commit('rewrite it');
    }

    // Two thirds of the lines changed: well under git's 50% over the range.
    const heavyRewrite = lines(40, 'line').replace(/^line (\d+)$/gm, (row, n: string) =>
      Number(n) % 3 === 0 ? row : `rewritten ${n}`,
    );

    it('pairs a file moved in one commit and rewritten in a later one', async () => {
      moveThenRewrite('src/old.ts', ['src/new.ts'], heavyRewrite);
      const { context } = await gatherFor({ kind: 'branch', base: 'main' });

      expect(context.files.map((file) => file.filename)).toEqual(['src/new.ts']);
      const [moved] = context.files;
      expect(moved).toMatchObject({ status: 'renamed', origin: { filename: 'src/old.ts' } });
      expect(moved?.origin?.similarity).toBeLessThan(50);
      expect(moved?.origin?.similarity).toBeGreaterThan(0);
      expect(context.contents['src/new.ts']?.base).toEqual({
        kind: 'content',
        content: lines(40, 'line'),
      });
      // Hunks against the old content, not one hunk adding the whole file.
      const hunks = context.hunks.filter((hunk) => hunk.filename === 'src/new.ts');
      expect(hunks.length).toBeGreaterThan(0);
      expect(hunks.every((hunk) => hunk.original.lineCount > 0)).toBe(true);
    });

    it('follows a chain of moves back to the path the file had at the base', async () => {
      moveThenRewrite('src/one.ts', ['src/two.ts', 'src/three.ts'], heavyRewrite);
      const { context } = await gatherFor({ kind: 'branch', base: 'main' });

      expect(context.files).toEqual([
        expect.objectContaining({
          filename: 'src/three.ts',
          status: 'renamed',
          origin: expect.objectContaining({ filename: 'src/one.ts' }),
        }),
      ]);
    });

    it('leaves a file that shares nothing with its old self as a removal and an addition', async () => {
      moveThenRewrite('src/old.ts', ['src/new.ts'], 'export const entirely = "different";\n');
      const { context } = await gatherFor({ kind: 'branch', base: 'main' });

      expect(context.files.map((file) => [file.filename, file.status])).toEqual([
        ['src/new.ts', 'added'],
        ['src/old.ts', 'removed'],
      ]);
    });
  });

  it('writes one diff file for the whole change, each hunk id above its header', async () => {
    branchOfEveryKind();
    const { context, run } = await gatherFor({ kind: 'branch', base: 'main' });

    const text = readFileSync(run.diff, 'utf8').split('\n');
    const keep = context.hunks.filter((hunk) => hunk.filename === 'src/keep.ts');
    for (const hunk of keep) {
      const at = text.indexOf(`# ${hunk.id}`);
      expect(at).toBeGreaterThan(-1);
      expect(text[at + 1]).toBe(hunk.header);
    }
    expect(text.join('\n')).not.toContain('package-lock.json');
  });

  it('records the commits and the working-tree changes the review leaves out', async () => {
    branchOfEveryKind();
    const { context } = await gatherFor({ kind: 'branch', base: 'main' });

    expect(context.commits.map((commit) => commit.subject)).toEqual(['touch every kind of file']);
    expect(context.dirty).toEqual(['src/keep.ts', 'scratch.txt']);
  });

  it('leaves the staged changes out of a staged review’s dirty list', async () => {
    repo.write('staged.ts', 'staged\n');
    repo.git('add', 'staged.ts');
    repo.write('README.md', 'unstaged\n');
    const { context } = await gatherFor({ kind: 'staged' });

    expect(context.files.map((file) => file.filename)).toEqual(['staged.ts']);
    expect(context.dirty).toEqual(['README.md']);
    expect(context.commits).toEqual([]);
  });

  it('round-trips through context.json', async () => {
    branchOfEveryKind();
    const { context, run } = await gatherFor({ kind: 'branch', base: 'main' });
    await expect(readContext(run)).resolves.toEqual(context);
  });

  it('says what to do when a context is missing', async () => {
    const run = await createRunFolder(runsRoot, 'staged', new Date());
    await expect(readContext(run)).rejects.toThrow(/no context\.json .*run without --from/);
  });
});
