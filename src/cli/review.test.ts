import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { HookInput } from '@anthropic-ai/claude-agent-sdk';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { BUNDLE_PLACEHOLDER } from '../domain/review/bundle-html.ts';
import { runGit } from '../domain/review/clone/git-runner.server.ts';
import { createTempRepo, GIT_TEST_TIMEOUT, type TempRepo } from '../test/git-repo.ts';
import type { QueryFn } from './claude-run.ts';
import { Shell } from './git.ts';
import { review, WARNED, type ReviewDeps, type ReviewOptions } from './review.ts';
import { RUNS_DIR } from './run-folder.ts';
import { removeWorktreeSync } from './worktree.ts';
import { runInterruptCleanups } from './interrupts.ts';
import * as stubRun from './stub-run.ts';
import * as terminal from './terminal.ts';

// Real git, many spawns per test — see GIT_TEST_TIMEOUT.
vi.setConfig({ testTimeout: GIT_TEST_TIMEOUT, hookTimeout: GIT_TEST_TIMEOUT });

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
/** `repo.work`, as `git rev-parse --show-toplevel` reports it: resolved past any symlink. */
let repoRoot: string;
let deps: ReviewDeps & { open: Mock<(file: string) => void> };

beforeEach(() => {
  repo = createTempRepo();
  repoRoot = path.resolve(realpathSync.native(repo.work));
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
  "overviewSummary": { "lede": "One chapter, written by the model in this test." },
  "chapters": [
    {
      "id": "app",
      "title": "App",
      "description": "src/app.ts changed.",
      "insights": [{ "type": "context", "title": "From the test model", "text": "Not a real run." }],
      "diffChunks": [{ "filename": "src/app.ts", "language": "typescript", "hunkIds": ["H0001"] }]
    }
  ]
}
</narrative_review>`;

/** MODEL_REVIEW, with its one diff chunk replaced by the ones given. */
const citing = (...chunks: string[]) =>
  MODEL_REVIEW.replace(
    '{ "filename": "src/app.ts", "language": "typescript", "hunkIds": ["H0001"] }',
    chunks.join(', '),
  );

const chunk = (filename: string, id: string) =>
  `{ "filename": "${filename}", "language": "typescript", "hunkIds": ["${id}"] }`;

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
    const run = path.join(repoRoot, RUNS_DIR, 'staged', folder!);
    const stageFiles = [
      'context.json',
      'system.md',
      'prompt.md',
      'raw.txt',
      'review.json',
      'findings.json',
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

    const run = path.join(repoRoot, RUNS_DIR, 'staged', runFolders()[0]!);
    expect(cwd).toBe(repoRoot);
    expect(readFileSync(path.join(run, 'raw.txt'), 'utf8')).toBe(MODEL_REVIEW);
    expect(readFileSync(path.join(run, 'events.jsonl'), 'utf8')).toContain('"subtype":"success"');
    expect(readFileSync(path.join(run, 'review.json'), 'utf8')).toContain('The staged change');
    expect(deps.open).toHaveBeenCalledWith(path.join(run, 'review.html'));
  });

  it('counts what the review covers, says nothing, and exits clean', async () => {
    await expect(review(options({ open: false }), deps)).resolves.toBe(0);

    expect(vi.mocked(terminal.stage)).toHaveBeenCalledWith(
      'parse',
      '1 chapter, 1 hunk',
      expect.any(Number),
    );
    expect(vi.mocked(terminal.warn)).not.toHaveBeenCalled();
  });

  it('asks the model again for an answer that leaves a hunk uncited, and says so', async () => {
    // Two files, so the first answer can leave one of them out without its
    // chapter ending up with no hunks of its own — which would fail outright.
    repo.write('src/other.ts', 'export const other = 1;\n');
    repo.git('add', 'src/other.ts');
    // src/app.ts is H0001 and src/other.ts H0002: the ids run over the whole
    // change, and a chunk may only cite hunks of the file it names.
    const answers = [
      citing(chunk('src/app.ts', 'H0001')),
      citing(chunk('src/app.ts', 'H0001'), chunk('src/other.ts', 'H0002')),
    ];
    const query: QueryFn = ({ options: sdkOptions }) =>
      (async function* () {
        for (const [index, answer] of answers.entries()) {
          yield assistantText(answer);
          const hook = sdkOptions.hooks?.Stop?.[0]?.hooks[0];
          if (!hook) throw new Error('no Stop hook was registered');
          const out = (await hook(
            {
              hook_event_name: 'Stop',
              stop_hook_active: index > 0,
              session_id: 's',
              transcript_path: 't',
              cwd: '.',
            } as HookInput,
            undefined,
            { signal: new AbortController().signal },
          )) as { decision?: string };
          if (out.decision !== 'block') break;
        }
        yield runResult();
      })();

    await expect(
      review(options({ stub: false, open: false }), { ...deps, claude: { query } }),
    ).resolves.toBe(WARNED);

    expect(vi.mocked(terminal.note)).toHaveBeenCalledWith(
      expect.stringContaining('answer disqualified, asking again (1 of 3)'),
    );
    // Written once, and read again from events.jsonl by every later parse.
    expect(vi.mocked(terminal.warn)).toHaveBeenCalledWith(
      expect.stringContaining('disqualified; this review is what it sent after 1 further attempt'),
    );

    const run = path.join(repoRoot, RUNS_DIR, 'staged', runFolders()[0]!);
    const findings = JSON.parse(readFileSync(path.join(run, 'findings.json'), 'utf8')) as {
      code: string;
    }[];
    // Every severity: the promoted prose is a note, recorded and never printed.
    expect(findings.map((item) => item.code)).toEqual(['prose-promoted', 'passed-after-retry']);
    expect(vi.mocked(terminal.warn)).toHaveBeenCalledTimes(1);

    vi.mocked(terminal.warn).mockClear();
    await expect(review(options({ from: 'parse', open: false }), deps)).resolves.toBe(WARNED);
    expect(vi.mocked(terminal.warn)).toHaveBeenCalledWith(
      expect.stringContaining('1 further attempt'),
    );
  });

  it('fails the parse stage when the run behind the answer stopped early', async () => {
    const query: QueryFn = () =>
      (async function* () {
        yield assistantText(MODEL_REVIEW);
        yield { type: 'result', subtype: 'error_max_turns', num_turns: 5 } as never;
      })();

    await expect(
      review(options({ stub: false, open: false }), { ...deps, claude: { query } }),
    ).rejects.toThrow(/did not finish cleanly \(error_max_turns\)/);
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
