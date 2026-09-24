import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LOCAL_WORKING_TREE, NARRATIVE_SYSTEM_PROMPT } from '../review/prompt/instructions.ts';
import type { RunContext } from './context.ts';
import { buildPrompt, writePrompt } from './prompt.ts';
import { runFiles, type RunFiles } from './run-folder.ts';

let run: RunFiles;
let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'cli-test-prompt-'));
  run = runFiles(root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function context(overrides: Partial<RunContext> = {}): RunContext {
  return {
    target: {
      kind: 'pr',
      slug: 'pr-7',
      repoRoot: 'C:/repos/widgets',
      baseSha: '1111111aaaa',
      headSha: '2222222bbbb',
      baseLabel: 'origin/main',
      headLabel: 'pull/7/head',
    },
    meta: {
      repo: 'acme/widgets',
      title: 'Add a login form',
      prNumber: 7,
      baseRefName: 'main',
      headRefName: 'feat/login',
      authorLogin: 'octo',
      description: 'Adds the form.',
      stats: { changedFiles: 3, additions: 12, deletions: 2 },
    },
    files: [
      { filename: 'src/login.ts', status: 'added', additions: 10, deletions: 0 },
      {
        filename: 'src/form.ts',
        status: 'renamed',
        additions: 2,
        deletions: 2,
        origin: { filename: 'src/old-form.ts', similarity: 83 },
      },
      {
        filename: 'package-lock.json',
        status: 'modified',
        additions: 40,
        deletions: 3,
        skipped: 'built-in',
      },
    ],
    hunks: [
      {
        id: 'H0001',
        filename: 'src/login.ts',
        header: '@@ -0,0 +1,10 @@',
        fileOrder: 1,
        original: { startLine: 1, lineCount: 0 },
        modified: { startLine: 1, lineCount: 10 },
      },
    ],
    contents: {},
    commits: [{ sha: '2222222bbbb', subject: 'Add the login form', body: 'With validation.' }],
    dirty: [],
    diffLines: 42,
    ...overrides,
  };
}

describe('the local prompt', () => {
  it('delivers a PR with its header, files, hunks and where the diff file is', () => {
    const prompt = buildPrompt(context(), run, null);

    expect(prompt).toMatch(/^# Pull Request #7: Add a login form\n/);
    expect(prompt).toContain('**Author**: octo');
    expect(prompt).toContain('**Branches**: feat/login → main');
    expect(prompt).toContain(
      '## Description\nAdds the form.\n\nUse the description as author-provided intent.',
    );
    expect(prompt).toContain(
      '## Files Changed (2)\n  added      +10/-0  src/login.ts\n  renamed    +2/-2  src/form.ts',
    );
    expect(prompt).toContain('  src/form.ts  (from src/old-form.ts, 83% similar)');
    expect(prompt).toContain('## Not Reviewed (1)');
    expect(prompt).toContain('  package-lock.json  (lockfile, bundle or snapshot)');
    expect(prompt).toContain(
      '  H0001  src/login.ts  @@ -0,0 +1,10 @@  original L1 (+0)  modified L1-10',
    );
    expect(prompt).toContain(`\`${run.diff.replaceAll('\\', '/')}\`, 42 lines`);
    expect(prompt).toContain('a limit of at least 42');
    expect(prompt).toContain('a temporary checkout of the pull request’s head commit (2222222)');
    expect(prompt).toContain(
      `except for this run’s own folder, \`${run.folder.replaceAll('\\', '/')}\``,
    );
    expect(prompt).toContain('- 2222222 Add the login form\n    With validation.');
  });

  it('points at pr.md instead of inlining a long description', () => {
    const long = 'x'.repeat(9000);
    const prompt = buildPrompt(
      context({ meta: { ...context().meta, description: long } }),
      run,
      null,
    );
    expect(prompt).not.toContain(long);
    expect(prompt).toContain(`read it in \`${run.pr.replaceAll('\\', '/')}\``);
  });

  it('leans on the commits when a branch has no description, and names what is dirty', () => {
    const base = context();
    const prompt = buildPrompt(
      {
        ...base,
        target: {
          ...base.target,
          kind: 'branch',
          slug: 'branch-feat-login',
          headLabel: 'feat/login',
        },
        meta: {
          ...base.meta,
          prNumber: null,
          title: 'feat/login',
          authorLogin: null,
          description: null,
        },
        dirty: ['src/login.ts', 'notes.txt'],
      },
      run,
      null,
    );

    expect(prompt).toMatch(/^# Branch: feat\/login\n/);
    expect(prompt).not.toContain('**Author**');
    expect(prompt).toContain(
      '(no description — the commit messages below are the best statement of intent)',
    );
    expect(prompt).toContain('the repository itself, at feat/login');
    expect(prompt).toContain(
      'not part of this review, so what you read there may differ from the reviewed version:\n  src/login.ts\n  notes.txt',
    );
  });

  it('ends with the reviewer’s instructions, framed as theirs rather than the author’s', () => {
    const instructions = ['Look hard at the session handling.', 'Skip the CSS.'].join('\n');
    const prompt = buildPrompt(context(), run, instructions);

    const [before, section] = prompt.split('## Reviewer’s Instructions');
    expect(before).toMatch(/code around it\.\n\n$/);
    expect(section).toContain('It comes from them, not from the change’s author.');
    expect(section).toMatch(
      /still holds\.\n\nLook hard at the session handling\.\nSkip the CSS\.\n$/,
    );
  });

  it('has no reviewer’s section without instructions', () => {
    expect(buildPrompt(context(), run, null)).not.toContain('Reviewer’s Instructions');
  });

  it('writes the shared instructions and the local paragraph beside the prompt', async () => {
    const user = await writePrompt(context(), run, null);
    expect(readFileSync(run.system, 'utf8')).toBe(NARRATIVE_SYSTEM_PROMPT + LOCAL_WORKING_TREE);
    expect(readFileSync(run.prompt, 'utf8')).toBe(user);
  });
});
