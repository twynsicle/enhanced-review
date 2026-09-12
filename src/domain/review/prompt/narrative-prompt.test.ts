import { describe, expect, it } from 'vitest';
import { reviewCoverage, withFileHunks } from '../coverage.ts';
import { DIAGRAM_LIMITS } from '../diagram.ts';
import type { NarrativeReview } from '../narrative.ts';
import { buildNarrativePrompt } from './narrative-prompt.ts';
import { parseNarrativeReview } from './parse-narrative.ts';
import type { PrData } from './types.ts';

/** One patch of `count` hunks, each far too big for the diff budget to keep whole. */
function manyHunkPatch(count: number): string {
  const body = Array.from({ length: count }, (_, h) =>
    [
      `@@ -${String(h * 60 + 1)},60 +${String(h * 60 + 1)},60 @@`,
      ...Array.from(
        { length: 60 },
        (__, i) => `+hunk ${String(h)} line ${String(i)} ${'x'.repeat(40)}`,
      ),
    ].join('\n'),
  ).join('\n');
  return [
    'diff --git a/src/big.ts b/src/big.ts',
    '--- a/src/big.ts',
    '+++ b/src/big.ts',
    body,
  ].join('\n');
}

/** A truncated prompt over one big file, plus what the model can and cannot have seen. */
function truncatedPrompt() {
  const result = buildNarrativePrompt({
    title: 'Add widgets',
    body: 'Because widgets.',
    author: 'alice',
    baseRefName: 'main',
    headRefName: 'feat/widgets',
    files: [{ filename: 'src/big.ts', status: 'modified', additions: 12_000, deletions: 0 }],
    diff: manyHunkPatch(200),
  });
  const shownIds = new Set(result.grounding.shown.hunks.map((hunk) => hunk.id));
  return {
    result,
    shownId: result.grounding.shown.hunks[0]!.id,
    gapId: result.catalog.find((hunk) => !shownIds.has(hunk.id))!.id,
  };
}

/**
 * A prompt whose diff is cut off whole rather than trimmed per file: every
 * patch is short enough that trimming skips it, so the budget takes the tail
 * of the diff off at a stroke and the last files carry no hunks at all.
 */
function hardTruncatedPrompt() {
  const names = Array.from({ length: 400 }, (_, i) => `src/f${String(i)}.ts`);
  const result = buildNarrativePrompt(
    prData({
      files: names.map((filename) => ({
        filename,
        status: 'modified' as const,
        additions: 100,
        deletions: 0,
      })),
      diff: names.map((name) => patch(name, 100)).join(''),
    }),
  );
  return { result, cut: names.at(-1)! };
}

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
      {
        filename: 'package-lock.json',
        status: 'modified',
        additions: 900,
        deletions: 900,
        skipped: 'built-in',
      },
    ],
    diff: patch('src/a.ts', 3) + patch('package-lock.json', 5),
    ...overrides,
  };
}

describe('buildNarrativePrompt', () => {
  it('lists a skipped file apart and keeps it out of the diff and the hunk catalog', () => {
    const { user, catalog, grounding, wasTruncated } = buildNarrativePrompt(prData());
    expect(user).toContain('## Files Changed (1)');
    expect(user).toContain('src/a.ts');
    expect(user).toContain('## Not Reviewed (1)');
    expect(user).toContain('package-lock.json  (lockfile, bundle or snapshot)');
    expect(user.slice(user.indexOf('## Full Diff'))).not.toContain('package-lock.json');
    expect(catalog.map((h) => h.filename)).toEqual(['src/a.ts']);
    expect(grounding.shown.hunks.map((h) => h.filename)).toEqual(['src/a.ts']);
    expect(user).toContain('H0001  src/a.ts  @@ -1,1 +1,3 @@  original L1  modified L1-3');
    expect(wasTruncated).toBe(false);
  });

  it('drops a skippable patch the changed-file list does not mention', () => {
    // The file list and the diff come from separate git commands, so a path
    // missing from the list is a path no `skipped` stamp can reach. Without
    // the rules applied to the patch itself, a lockfile's whole diff is
    // inlined and numbered into ids no stored file can carry.
    const { user, catalog } = buildNarrativePrompt(
      prData({
        files: [{ filename: 'src/a.ts', status: 'modified', additions: 3, deletions: 0 }],
      }),
    );
    expect(user).not.toContain('## Not Reviewed');
    expect(user.slice(user.indexOf('## Full Diff'))).not.toContain('package-lock.json');
    expect(catalog.map((h) => h.filename)).toEqual(['src/a.ts']);
  });

  it('grounds diagram filenames on the file list, which truncation never shortens', () => {
    // The instructions tell the model to take a diagram node's filename from
    // Files Changed. Ground the name on the hunks instead and a correctly
    // named node on a file the budget cut short of loses its click-through.
    const { result, cut } = hardTruncatedPrompt();

    expect(result.wasTruncated).toBe(true);
    expect(result.user.slice(0, result.user.indexOf('## Changed Hunks'))).toContain(cut);
    expect(result.grounding.shown.hunks.some((hunk) => hunk.filename === cut)).toBe(false);
    expect(result.grounding.filenames.has(cut)).toBe(true);
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

  it('does not both discourage and encourage diagrams', () => {
    /*
     * The first two runs against a 45-file PR each produced exactly one
     * chapter diagram out of eleven, because the section opened with "usually
     * absent" and said "most chapters should not have one", then contradicted
     * itself twelve rules later with "do not ration them to one". The model
     * settled the contradiction by rationing. Whatever the wording, the
     * section must not carry both halves of that argument at once.
     */
    const { system } = buildNarrativePrompt(prData());
    expect(system).not.toContain('usually absent');
    expect(system).not.toContain('Most chapters should not have one');
    expect(system).toContain('Do not ration diagrams to one per review');
  });

  it('gives every diagram kind a trigger to match against', () => {
    // `beforeAfter` went unused across both real runs: it had no cue a model
    // could match a chapter to, only a definition.
    const { system } = buildNarrativePrompt(prData());
    for (const kind of ['architecture', 'beforeAfter', 'state', 'sequence']) {
      expect(system).toContain(`- "${kind}":`);
    }
    expect(system).toContain('previously X, now Y');
  });

  it('substitutes a placeholder for an empty description', () => {
    const { user } = buildNarrativePrompt(prData({ body: '' }));
    expect(user).toContain('(no description)');
  });

  it('says nothing about files the change did not skip', () => {
    const { user } = buildNarrativePrompt(
      prData({
        files: [{ filename: 'src/a.ts', status: 'modified', additions: 3, deletions: 0 }],
        diff: patch('src/a.ts', 3),
      }),
    );
    expect(user).not.toContain('## Not Reviewed');
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

  it('numbers hunks over the untruncated diff and catalogues only what survives', () => {
    // A patch whose middle is trimmed away keeps the ids of the hunks either
    // side of the cut: numbering after truncation would renumber the tail, and
    // the ids stored on the review would then mean something else to the
    // coverage backstop than they did to the model.
    const { result } = truncatedPrompt();

    expect(result.wasTruncated).toBe(true);
    expect(result.catalog).toHaveLength(200);
    expect(result.catalog.at(-1)?.id).toBe('H0200');
    const catalog = result.user.slice(
      result.user.indexOf('## Changed Hunks'),
      result.user.indexOf('## Full Diff'),
    );
    expect(catalog).toContain('H0001');
    expect(catalog).toContain('H0200');
    expect(catalog).not.toContain('H0100');
  });

  it('resolves only the ids it showed, and leaves the rest to the backstop', () => {
    // A cited id from the trimmed gap is a guess: resolving it would paint a
    // chapter with a diff nobody was shown, and count that hunk as discussed.
    const { result, shownId, gapId } = truncatedPrompt();
    const raw = `<narrative_review>${JSON.stringify({
      prTitle: 'Add widgets',
      overviewSummary: 'Widgets.',
      chapters: [
        {
          id: 'widgets',
          title: 'Widgets',
          description: 'The widgets.',
          insights: [],
          diffChunks: [
            { filename: 'src/big.ts', language: 'typescript', hunkIds: [shownId, gapId] },
          ],
        },
      ],
    })}</narrative_review>`;

    const parsed = parseNarrativeReview(raw, result.grounding);
    expect(parsed.ok).toBe(true);
    const review = (parsed as { ok: true; data: NarrativeReview }).data;
    expect(review.chapters[0]!.diffChunks[0]!.hunks.map((hunk) => hunk.id)).toEqual([shownId]);

    const stored: NarrativeReview = {
      ...review,
      files: withFileHunks(
        [{ filename: 'src/big.ts', status: 'modified', additions: 12_000, deletions: 0 }],
        result.catalog,
      ),
    };
    const coverage = reviewCoverage(stored);
    expect(coverage.total).toBe(result.catalog.length);
    expect(coverage.uncited[0]!.uncited.map((hunk) => hunk.id)).toContain(gapId);
  });
});
