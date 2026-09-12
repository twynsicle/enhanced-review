import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { BUNDLE_PLACEHOLDER } from '../domain/review/bundle-html.ts';
import { runGit } from '../domain/review/clone/git-runner.server.ts';
import { createTempRepo, type TempRepo } from '../test/git-repo.ts';
import type { QueryFn } from './claude-run.ts';
import { Shell } from './git.ts';
import { review, type ReviewDeps, type ReviewOptions } from './review.ts';
import { RUNS_DIR } from './run-folder.ts';
import { removeWorktreeSync } from './worktree.ts';
import { runInterruptCleanups } from './interrupts.ts';
import * as stubRun from './stub-run.ts';

vi.mock('./stub-run.ts', { spy: true });

vi.mock('./terminal.ts', () => ({
  line: vi.fn(),
  note: vi.fn(),
  stage: vi.fn(),
  warn: vi.fn(),
  fail: vi.fn(),
  status: vi.fn(),
  clearStatus: vi.fn(),
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
    claude: {},
  };
  repo.write('src/app.ts', 'export const app = 2;\n');
  repo.git('add', 'src/app.ts');
});
afterEach(() => repo.cleanup());

const options = (overrides: Partial<ReviewOptions> = {}): ReviewOptions => ({
  request: { kind: 'staged' },
  cwd: repo.work,
  stub: true,
  model: 'test-model',
  maxTurns: 5,
  timeoutMs: 60_000,
  from: null,
  open: true,
  keepWorktree: false,
  ...overrides,
});

const MODEL_REVIEW = `<narrative_review>
{
  "prTitle": "The staged change",
  "overviewSummary": "One chapter, written by the model in this test.",
  "chapters": [
    {
      "id": "app",
      "title": "App",
      "description": "src/app.ts changed.",
      "insights": [{ "type": "context", "title": "From the test model", "text": "Not a real run." }],
      "diffChunks": []
    }
  ]
}
</narrative_review>`;

const assistantText = (text: string) =>
  ({ type: 'assistant', message: { content: [{ type: 'text', text }] } }) as never;

const runResult = () =>
  ({ type: 'result', subtype: 'success', num_turns: 4, total_cost_usd: 0.05 }) as never;

/** This process's worktrees for PR 7 in the temp dir. */
function ourWorktrees(): string[] {
  return readdirSync(tmpdir()).filter((name) => name.startsWith(`er-pr7-${String(process.pid)}-`));
}

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

  it('runs the model without --stub, in the repository, and reports what it wrote', async () => {
    let cwd = '';
    const query: QueryFn = ({ options: sdkOptions }) => {
      cwd = sdkOptions.cwd ?? '';
      return (async function* () {
        yield assistantText(MODEL_REVIEW);
        yield runResult();
      })();
    };

    await expect(review(options({ stub: false }), { ...deps, claude: { query } })).resolves.toBe(0);

    const run = path.join(repo.work, RUNS_DIR, 'staged', runFolders()[0]!);
    expect(cwd).toBe(repo.work);
    expect(readFileSync(path.join(run, 'raw.txt'), 'utf8')).toBe(MODEL_REVIEW);
    expect(readFileSync(path.join(run, 'events.jsonl'), 'utf8')).toContain('"subtype":"success"');
    expect(readFileSync(path.join(run, 'review.json'), 'utf8')).toContain('The staged change');
    expect(deps.open).toHaveBeenCalledWith(path.join(run, 'review.html'));
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

  describe('a PR review', () => {
    function openPull(): string {
      repo.git('commit', '--quiet', '-m', 'the PR');
      const head = repo.git('rev-parse', 'HEAD').trim();
      repo.git('push', '--quiet', 'origin', 'HEAD:refs/pull/7/head');
      repo.git('reset', '--quiet', '--hard', 'HEAD~1');
      const pull = {
        number: 7,
        title: 'Change the app',
        body: '',
        author: { login: 'octo' },
        baseRefName: 'main',
        headRefName: 'feat/app',
        headRefOid: head,
        state: 'OPEN',
      };
      deps.shell = new Shell(repo.work, {
        git: runGit,
        gh: async () => ({ stdout: JSON.stringify(pull), stderr: '', exitCode: 0 }),
      });
      return head;
    }

    it('runs in a worktree of the PR head and removes it afterwards', async () => {
      openPull();
      await review(options({ request: { kind: 'pr', number: 7, base: null }, open: false }), deps);

      expect(existsSync(path.join(repo.work, RUNS_DIR, 'pr-7'))).toBe(true);
      expect(ourWorktrees()).toEqual([]);
      expect(repo.git('worktree', 'list').trim().split('\n')).toHaveLength(1);
    });

    it('removes the worktree when interrupted mid-run', async () => {
      openPull();
      let during: string[] = [];
      vi.mocked(stubRun.writeStubRun).mockImplementationOnce(async () => {
        during = ourWorktrees();
        // What the SIGINT handler does, short of exiting.
        runInterruptCleanups();
        throw new Error('interrupted');
      });
      await expect(
        review(options({ request: { kind: 'pr', number: 7, base: null }, open: false }), deps),
      ).rejects.toThrow('interrupted');

      expect(during).toHaveLength(1);
      expect(ourWorktrees()).toEqual([]);
    });

    it('keeps the worktree with --keep-worktree', async () => {
      openPull();
      await review(
        options({
          request: { kind: 'pr', number: 7, base: null },
          open: false,
          keepWorktree: true,
        }),
        deps,
      );
      const kept = ourWorktrees();
      expect(kept).toHaveLength(1);
      removeWorktreeSync({ path: path.join(tmpdir(), kept[0]!), repoRoot: repo.work });
    });
  });
});
