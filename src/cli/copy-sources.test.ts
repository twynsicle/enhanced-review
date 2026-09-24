import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTempRepo, GIT_TEST_TIMEOUT, type TempRepo } from '../test/git-repo.ts';
import type { QueryFn } from './claude-run.ts';
import {
  checkCopySources,
  COPY_SOURCE_MODEL,
  copySourceLimits,
  findCopySources,
  parseCopySources,
} from './copy-sources.ts';
import { listChangedFileDetails, type ChangedFile } from './diff-files.ts';
import { runGit } from './git-runner.ts';
import { Shell } from './git.ts';
import { createRunFolder } from './run-folder.ts';
import { resolveTarget } from './targets.ts';
import * as terminal from './terminal.ts';

// Real git, many spawns per test — see GIT_TEST_TIMEOUT.
vi.setConfig({ testTimeout: GIT_TEST_TIMEOUT, hookTimeout: GIT_TEST_TIMEOUT });

vi.mock('./terminal.ts', () => ({
  line: vi.fn(),
  note: vi.fn(),
  stage: vi.fn(),
  warn: vi.fn(),
  fail: vi.fn(),
}));

const answer = (pairs: { file: string; source: string }[]) =>
  `Looked at the siblings.\n<copy_sources>${JSON.stringify(pairs)}</copy_sources>`;

const noGh = async () => ({ stdout: '', stderr: 'no gh in tests', exitCode: 1 });

type Seen = { prompt?: string; options?: Parameters<QueryFn>[0]['options'] };
const replying =
  (text: string, seen: Seen = {}): QueryFn =>
  ({ prompt, options }) => {
    seen.prompt = prompt;
    seen.options = options;
    return (async function* () {
      yield { type: 'assistant', message: { content: [{ type: 'text', text }] } } as never;
      yield { type: 'result', subtype: 'success', num_turns: 3, total_cost_usd: 0.01 } as never;
    })();
  };

const outOfTurns: QueryFn = () =>
  (async function* () {
    yield {
      type: 'result',
      subtype: 'error_max_turns',
      num_turns: 40,
      total_cost_usd: 0.2,
    } as never;
  })();

describe('parseCopySources', () => {
  it('reads the last block, source first', () => {
    const text = `I will answer in <copy_sources>[]</copy_sources> form.\n${answer([
      { file: 'src/b.ts', source: 'src/a.ts' },
    ])}`;
    expect(parseCopySources(text)).toEqual([{ from: 'src/a.ts', to: 'src/b.ts' }]);
  });

  it('reads a path the way a person writes one', () => {
    const text = answer([{ file: './src/b.ts', source: ' src\\a.ts' }]);
    expect(parseCopySources(text)).toEqual([{ from: 'src/a.ts', to: 'src/b.ts' }]);
  });

  it('takes an empty list as no sources', () => {
    expect(parseCopySources(answer([]))).toEqual([]);
  });

  it('refuses an answer with no block, broken JSON or the wrong shape', () => {
    expect(() => parseCopySources('none of them')).toThrow('no <copy_sources> block');
    expect(() => parseCopySources('<copy_sources>[{]</copy_sources>')).toThrow('not JSON');
    expect(() => parseCopySources('<copy_sources>[{"file": "a"}]</copy_sources>')).toThrow(
      'not a list of {file, source}',
    );
  });
});

describe('checkCopySources', () => {
  const file = (filename: string, status: ChangedFile['status'], origin?: string): ChangedFile => ({
    filename,
    status,
    additions: 1,
    deletions: 0,
    binary: false,
    ...(origin ? { origin: { filename: origin, similarity: 80 } } : {}),
  });
  const files = [
    file('new.ts', 'added'),
    file('other.ts', 'added'),
    file('gone.ts', 'removed'),
    file('moved.ts', 'renamed', 'was.ts'),
  ];
  const base = new Set(['tpl.ts', 'gone.ts', 'was.ts']);
  const check =
    (...requests: { from: string; to: string }[]) =>
    () =>
      checkCopySources(requests, ['new.ts', 'other.ts'], files, base);

  it('accepts a source at the base, and a removed one named once', () => {
    expect(
      check({ from: 'tpl.ts', to: 'new.ts' }, { from: 'gone.ts', to: 'other.ts' }),
    ).not.toThrow();
    expect(
      check({ from: 'tpl.ts', to: 'new.ts' }, { from: 'tpl.ts', to: 'other.ts' }),
    ).not.toThrow();
  });

  it('refuses a file it was not asked about, or one named twice', () => {
    expect(check({ from: 'tpl.ts', to: 'moved.ts' })).toThrow('not asked about');
    expect(check({ from: 'tpl.ts', to: 'new.ts' }, { from: 'gone.ts', to: 'new.ts' })).toThrow(
      'more than one source for new.ts',
    );
  });

  it('refuses a source that was not a file at the base', () => {
    expect(check({ from: 'src/', to: 'new.ts' })).toThrow('not a file at the base');
    expect(check({ from: 'new.ts', to: 'new.ts' })).toThrow('its own source');
  });

  it('refuses a source that already went to another file', () => {
    expect(check({ from: 'was.ts', to: 'new.ts' })).toThrow('renamed on the branch');
    expect(check({ from: 'gone.ts', to: 'new.ts' }, { from: 'gone.ts', to: 'other.ts' })).toThrow(
      'source of two files',
    );
  });
});

describe('copySourceLimits', () => {
  it('gives more turns and more time to more files', () => {
    const one = copySourceLimits(1);
    const many = copySourceLimits(150);
    expect(many.maxTurns).toBeGreaterThan(3 * 150);
    expect(many.timeoutMs).toBeGreaterThan(one.timeoutMs);
  });
});

describe('findCopySources', () => {
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

  const lines = (count: number, label: string) =>
    Array.from({ length: count }, (_, i) => `${label} ${String(i + 1)}`).join('\n') + '\n';

  /** A branch adding a heavy rework of the template, and a file with nothing in common with it. */
  async function setUp() {
    repo.write('src/template.ts', lines(40, 'line'));
    repo.commit('the template');
    repo.git('push', '--quiet', 'origin', 'main');
    repo.git('checkout', '--quiet', '-b', 'feat/copy');
    repo.write(
      'src/copy.ts',
      lines(40, 'line').replace(/^line (\d+)$/gm, (row, n: string) =>
        Number(n) % 3 === 0 ? row : `reworked ${n}`,
      ),
    );
    repo.write('src/fresh.ts', 'export const fresh = 1;\n');
    repo.commit('add two files');
    const shell = new Shell(repo.work, { git: runGit, gh: noGh });
    const { target } = await resolveTarget({ kind: 'branch', base: 'main' }, shell, {
      warn: () => undefined,
    });
    const run = await createRunFolder(runsRoot, target.slug, new Date(2026, 8, 24, 9, 0, 0));
    const files = await listChangedFileDetails(runGit, repo.work, target.baseSha, target.headSha);
    return { shell: shell.at(target.repoRoot), target, run, files };
  }

  const both = ['src/copy.ts', 'src/fresh.ts'];

  it('asks about the unpaired files and lists the source it names as a copy', async () => {
    const { shell, target, run, files } = await setUp();
    const seen: Seen = {};
    const query = replying(answer([{ file: 'src/copy.ts', source: 'src/template.ts' }]), seen);

    const result = await findCopySources(shell, target, run, files, both, { query });

    expect(result.map((f) => [f.filename, f.status, f.origin?.filename])).toEqual([
      ['src/copy.ts', 'copied', 'src/template.ts'],
      ['src/fresh.ts', 'added', undefined],
    ]);
    expect(result[0]?.origin?.similarity).toBeLessThan(50);
    expect(seen.prompt).toContain('- src/copy.ts\n- src/fresh.ts');
    expect(seen.prompt).toContain(`git show ${target.headSha}:<path>`);
    expect(seen.options).toMatchObject({
      model: COPY_SOURCE_MODEL,
      tools: ['Bash'],
      settingSources: ['user'],
      cwd: shell.cwd,
    });
    expect(readFileSync(run.copySources, 'utf8')).toContain('<copy_sources>');
    expect(terminal.stage).toHaveBeenCalledWith(
      'sources',
      '2 new files checked, 1 source found, $0.01',
      expect.any(Number),
    );
  });

  it('warns and keeps a file new when git finds nothing in common with the named source', async () => {
    const { shell, target, run, files } = await setUp();
    const query = replying(answer([{ file: 'src/fresh.ts', source: 'src/template.ts' }]));

    await expect(findCopySources(shell, target, run, files, both, { query })).resolves.toEqual(
      files,
    );
    expect(terminal.warn).toHaveBeenCalledWith(
      expect.stringContaining('src/fresh.ts is reviewed as a new file'),
    );
  });

  it('fails on a source that is not at the base, quoting what the model said', async () => {
    const { shell, target, run, files } = await setUp();
    const query = replying(answer([{ file: 'src/copy.ts', source: 'src/nowhere.ts' }]));

    const failed = findCopySources(shell, target, run, files, both, { query });
    await expect(failed).rejects.toThrow(
      'src/nowhere.ts as the source of src/copy.ts, but it is not a file at the base',
    );
    await expect(failed).rejects.toThrow('the model answered:\nLooked at the siblings.');
  });

  it('fails on a directory named as a source', async () => {
    const { shell, target, run, files } = await setUp();
    const query = replying(answer([{ file: 'src/copy.ts', source: 'src' }]));

    await expect(findCopySources(shell, target, run, files, both, { query })).rejects.toThrow(
      'not a file at the base',
    );
  });

  it('fails when the run does not end cleanly', async () => {
    const { shell, target, run, files } = await setUp();
    await expect(
      findCopySources(shell, target, run, files, both, { query: outOfTurns }),
    ).rejects.toThrow('finding copy sources ended error_max_turns');
  });
});
