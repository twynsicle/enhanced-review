import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { BUNDLE_PLACEHOLDER } from '../domain/review/bundle-html.ts';
import { runGit } from '../domain/review/clone/git-runner.server.ts';
import { createTempRepo, type TempRepo } from '../test/git-repo.ts';
import { Shell } from './git.ts';
import { review, type ReviewDeps, type ReviewOptions } from './review.ts';
import { RUNS_DIR } from './run-folder.ts';

vi.mock('./terminal.ts', () => ({
  line: vi.fn(),
  note: vi.fn(),
  stage: vi.fn(),
  warn: vi.fn(),
  fail: vi.fn(),
}));

let repo: TempRepo;
let deps: ReviewDeps & { open: Mock<(file: string) => void> };

beforeEach(() => {
  repo = createTempRepo();
  deps = {
    shell: new Shell(repo.work, {
      git: runGit,
      gh: async () => ({ stdout: '', stderr: 'no gh in tests', exitCode: 1 }),
    }),
    render: { viewerShell: async () => `<html>${BUNDLE_PLACEHOLDER}</html>` },
    open: vi.fn<(file: string) => void>(),
  };
  repo.write('src/app.ts', 'export const app = 2;\n');
  repo.git('add', 'src/app.ts');
});
afterEach(() => repo.cleanup());

const options = (overrides: Partial<ReviewOptions> = {}): ReviewOptions => ({
  request: { kind: 'staged' },
  cwd: repo.work,
  stub: true,
  from: null,
  open: true,
  ...overrides,
});

function runFolders(): string[] {
  const dir = path.join(repo.work, RUNS_DIR, 'staged');
  return existsSync(dir) ? readdirSync(dir) : [];
}

describe('er review', () => {
  it('runs every stage with --stub and opens the report', async () => {
    await expect(review(options(), deps)).resolves.toBe(0);

    const [folder] = runFolders();
    const run = path.join(repo.work, RUNS_DIR, 'staged', folder!);
    const stageFiles = [
      'context.json',
      'system.md',
      'prompt.md',
      'raw.txt',
      'review.json',
      'review.html',
    ];
    expect(stageFiles.filter((file) => !existsSync(path.join(run, file)))).toEqual([]);
    expect(deps.open).toHaveBeenCalledWith(path.join(run, 'review.html'));
  });

  it('stops after the prompt without --stub', async () => {
    await review(options({ stub: false }), deps);
    const run = path.join(repo.work, RUNS_DIR, 'staged', runFolders()[0]!);
    expect(existsSync(path.join(run, 'prompt.md'))).toBe(true);
    expect(existsSync(path.join(run, 'raw.txt'))).toBe(false);
    expect(deps.open).not.toHaveBeenCalled();
  });

  it('resumes the newest run from parse without starting another', async () => {
    await review(options({ open: false }), deps);
    const run = path.join(repo.work, RUNS_DIR, 'staged', runFolders()[0]!);
    const raw = path.join(run, 'raw.txt');
    const edited = readFileSync(raw, 'utf8').replace(
      '"prTitle": "Staged changes on main"',
      '"prTitle": "Edited"',
    );

    writeFileSync(raw, edited);
    // Nothing staged any more: a fresh run would fail, a resumed one must not look.
    repo.git('reset', '--quiet');
    await review(options({ from: 'parse', open: false }), deps);

    expect(runFolders()).toHaveLength(1);
    expect(JSON.parse(readFileSync(path.join(run, 'review.json'), 'utf8')).prTitle).toBe('Edited');
  });

  it('refuses to resume a target that has never run', async () => {
    await expect(review(options({ from: 'render' }), deps)).rejects.toThrow(
      'no earlier run for staged to resume; run without --from first',
    );
  });
});
