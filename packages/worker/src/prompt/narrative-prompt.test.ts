import { describe, expect, it } from 'vitest';

import { buildNarrativePrompt } from './narrative-prompt';
import type { PrData, PrFileChange } from './types';

function makePrFile(filename: string, overrides?: Partial<PrFileChange>): PrFileChange {
  return {
    filename,
    status: 'modified',
    additions: 10,
    deletions: 5,
    ...overrides,
  };
}

function makePrData(overrides?: Partial<PrData>): PrData {
  return {
    title: 'Test PR',
    body: 'Test body',
    author: 'testuser',
    baseRefName: 'main',
    headRefName: 'feature',
    files: [makePrFile('src/index.ts'), makePrFile('src/utils.ts')],
    diff: [
      'diff --git a/src/index.ts b/src/index.ts',
      '--- a/src/index.ts',
      '+++ b/src/index.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      'diff --git a/src/utils.ts b/src/utils.ts',
      '--- a/src/utils.ts',
      '+++ b/src/utils.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n'),
    ...overrides,
  };
}

describe('buildNarrativePrompt', () => {
  it('returns the four expected fields', () => {
    const result = buildNarrativePrompt(makePrData());
    expect(result).toHaveProperty('system');
    expect(result).toHaveProperty('user');
    expect(result).toHaveProperty('wasTruncated');
    expect(result).toHaveProperty('hunkIndex');
  });

  it('system prompt asks for narrative review with hunk IDs in <narrative_review> tags', () => {
    const { system } = buildNarrativePrompt(makePrData());
    expect(system).toContain('narrative review');
    expect(system).toContain('<narrative_review>');
    expect(system).toContain('chapters');
    expect(system).toContain('hunkIds');
  });

  it('user prompt includes PR metadata', () => {
    const { user } = buildNarrativePrompt(
      makePrData({
        title: 'Add auth feature',
        author: 'alice',
        baseRefName: 'main',
        headRefName: 'feat/auth',
        body: 'Implements OAuth2 flow',
      }),
    );
    expect(user).toContain('Add auth feature');
    expect(user).toContain('alice');
    expect(user).toContain('feat/auth');
    expect(user).toContain('main');
    expect(user).toContain('Implements OAuth2 flow');
  });

  it('shows "(no description)" for empty body', () => {
    const { user } = buildNarrativePrompt(makePrData({ body: '' }));
    expect(user).toContain('(no description)');
  });

  it('lists files and changed hunks in user prompt', () => {
    const { user } = buildNarrativePrompt(makePrData());
    expect(user).toContain('src/index.ts');
    expect(user).toContain('src/utils.ts');
    expect(user).toContain('Changed Hunks');
    expect(user).toContain('H0001');
    expect(user).toContain('H0002');
    expect(user).toContain('Files Changed (2)');
  });

  it('filters excluded files from both list and diff', () => {
    const prData = makePrData({
      files: [makePrFile('src/index.ts'), makePrFile('package-lock.json')],
      diff: [
        'diff --git a/src/index.ts b/src/index.ts',
        '@@ -1 +1 @@',
        '-old',
        '+new',
        'diff --git a/package-lock.json b/package-lock.json',
        '@@ -1 +1 @@',
        '-old',
        '+new',
      ].join('\n'),
    });
    const { user } = buildNarrativePrompt(prData);
    expect(user).toContain('src/index.ts');
    expect(user).not.toContain('package-lock.json');
    expect(user).toContain('Files Changed (1)');
  });

  it('does not flag small diffs as truncated', () => {
    const { wasTruncated } = buildNarrativePrompt(makePrData());
    expect(wasTruncated).toBe(false);
  });

  it('flags wasTruncated and adds a note for diffs over the char budget', () => {
    const largePatch = 'x\n'.repeat(200_000);
    const prData = makePrData({
      diff: `diff --git a/big.ts b/big.ts\n${largePatch}`,
    });
    const { user, wasTruncated } = buildNarrativePrompt(prData);
    expect(wasTruncated).toBe(true);
    expect(user).toContain('truncated');
  });

  it('honours user-supplied filter patterns', () => {
    const prData = makePrData({
      files: [makePrFile('src/index.ts'), makePrFile('src/generated.ts')],
      diff: [
        'diff --git a/src/index.ts b/src/index.ts',
        '@@ -1 +1 @@',
        '-old',
        '+new',
        'diff --git a/src/generated.ts b/src/generated.ts',
        '@@ -1 +1 @@',
        '-old',
        '+new',
      ].join('\n'),
    });
    const { user } = buildNarrativePrompt(prData, ['generated.ts']);
    expect(user).toContain('src/index.ts');
    expect(user).not.toContain('generated.ts');
  });
});
