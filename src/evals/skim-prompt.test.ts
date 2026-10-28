import { describe, expect, it } from 'vitest';
import { ATTENTION_TIERS, NARRATIVE_SYSTEM_PROMPT } from '../review/prompt/instructions.ts';
import type { SkimCase } from './skim-case.ts';
import { buildSkimPrompt, SKIM_SYSTEM_PROMPT } from './skim-prompt.ts';

const skimCase: SkimCase = {
  name: 'c',
  source: { folder: 'er-reviews/pr-1/x', repo: 'o/r', kind: 'pr' },
  title: 'Rename the thing',
  description: 'Because.',
  commits: [{ sha: 'abcdef0123', subject: 'Rename', body: '' }],
  files: [
    { filename: 'src/a.ts', status: 'modified', additions: 1, deletions: 1 },
    { filename: 'dist/a.js', status: 'modified', additions: 1, deletions: 1, skipped: 'built-in' },
  ],
  hunks: [
    {
      id: 'H0001',
      filename: 'src/a.ts',
      header: '@@ -1,3 +1,3 @@',
      fileOrder: 1,
      original: { startLine: 1, lineCount: 3 },
      modified: { startLine: 1, lineCount: 3 },
      changedLines: 2,
      importsOnly: true,
    },
  ],
};

describe('the skim prompt', () => {
  it('asks the review’s own tiering rules, verbatim, for the tiers alone', () => {
    expect(ATTENTION_TIERS).toMatch(/^Attention tiers:\n/);
    expect(ATTENTION_TIERS).toContain('"skimReason"');
    expect(NARRATIVE_SYSTEM_PROMPT).toContain(ATTENTION_TIERS);
    expect(SKIM_SYSTEM_PROMPT).toContain(ATTENTION_TIERS);
    expect(SKIM_SYSTEM_PROMPT).toContain('<hunk_tiers>');
    expect(SKIM_SYSTEM_PROMPT).not.toContain('<narrative_review>');
  });

  it('shows the change as the prompt stage does, with the diff inline', () => {
    const prompt = buildSkimPrompt(
      skimCase,
      'diff --git a/src/a.ts b/src/a.ts\n# H0001\n@@ -1,3 +1,3 @@\n',
    );
    expect(prompt).toContain('# Rename the thing\n\n## Description\nBecause.');
    expect(prompt).toContain('## Commits (1)\n- abcdef0 Rename');
    expect(prompt).toContain('## Files Changed (1)\n  modified   +1/-1  src/a.ts');
    expect(prompt).toContain('## Not Reviewed (1)');
    expect(prompt).toContain(
      '  H0001  src/a.ts  @@ -1,3 +1,3 @@  original L1-3  modified L1-3  [imports only]',
    );
    expect(prompt).toMatch(/## Diff\n.*\n\ndiff --git a\/src\/a\.ts/);
  });
});
