import { describe, expect, it } from 'vitest';
import { DIAGRAM_LIMITS } from '../diagram.ts';
import { buildNarrativePrompt } from './narrative-prompt.ts';
import type { PrData } from './types.ts';

function patch(filename: string, bodyLines: number): string {
  const lines = [
    `diff --git a/${filename} b/${filename}`,
    'index 1..2 100644',
    `--- a/${filename}`,
    `+++ b/${filename}`,
    `@@ -1,1 +1,${String(bodyLines)} @@`,
    ...Array.from({ length: bodyLines }, (_, i) => `+line ${String(i)}`),
  ];
  return lines.join('\n') + '\n';
}

function prData(overrides: Partial<PrData> = {}): PrData {
  return {
    title: 'Add widgets',
    body: 'Because widgets.',
    author: 'alice',
    baseRefName: 'main',
    headRefName: 'feat/widgets',
    files: [
      { filename: 'src/a.ts', status: 'modified', additions: 3, deletions: 0 },
      { filename: 'package-lock.json', status: 'modified', additions: 900, deletions: 900 },
    ],
    diff: patch('src/a.ts', 3) + patch('package-lock.json', 5),
    ...overrides,
  };
}

describe('buildNarrativePrompt', () => {
  it('drops excluded files from the file list, the diff and the hunk catalog', () => {
    const { user, hunkIndex, wasTruncated } = buildNarrativePrompt(prData());
    expect(user).toContain('## Files Changed (1)');
    expect(user).toContain('src/a.ts');
    expect(user).not.toContain('package-lock.json');
    expect(hunkIndex.hunks.map((h) => h.filename)).toEqual(['src/a.ts']);
    expect(user).toContain('H0001  src/a.ts  @@ -1,1 +1,3 @@  original L1  modified L1-3');
    expect(wasTruncated).toBe(false);
  });

  it('includes the header, description and hunk-id instructions', () => {
    const { system, user } = buildNarrativePrompt(prData());
    expect(user).toContain('# Pull Request: Add widgets');
    expect(user).toContain('**Author**: alice');
    expect(user).toContain('**Branches**: feat/widgets → main');
    expect(user).toContain('Because widgets.');
    expect(system).toContain('<narrative_review>');
    expect(system).toContain('hunkIds');
  });

  it('states the diagram contract with the real limits, not a template hole', () => {
    const { system } = buildNarrativePrompt(prData());
    expect(system).toContain('"overviewDiagram"');
    expect(system).toContain('architecture | state | beforeAfter | sequence');
    expect(system).toContain('describes a CHANGE, not a system');
    // The caps come from DIAGRAM_LIMITS so the prompt cannot drift from the
    // schema that rejects what it asks for.
    expect(system).toContain(`at most ${String(DIAGRAM_LIMITS.labelChars)} characters`);
    expect(system).not.toContain('${');
  });

  it('substitutes a placeholder for an empty description', () => {
    const { user } = buildNarrativePrompt(prData({ body: '' }));
    expect(user).toContain('(no description)');
  });

  it('honours user exclusion patterns', () => {
    const { user } = buildNarrativePrompt(prData(), ['src/a.ts']);
    expect(user).toContain('## Files Changed (0)');
    expect(user).toContain('(No patch hunks were detected in the provided diff.)');
  });

  it('truncates oversized patches, keeps head and tail, and flags it', () => {
    const big = patch('src/big.ts', 100_000); // ~ 1.2 MB, well over the 320k char budget
    const result = buildNarrativePrompt(
      prData({
        files: [{ filename: 'src/big.ts', status: 'added', additions: 100_000, deletions: 0 }],
        diff: big,
      }),
    );
    expect(result.wasTruncated).toBe(true);
    expect(result.user).toContain('lines truncated ...]');
    expect(result.user).toContain('+line 0\n');
    expect(result.user).toContain('+line 99999');
    expect(result.user).toContain('Note: Some large file diffs were truncated.');
    expect(result.user.length).toBeLessThan(big.length);
  });
});
