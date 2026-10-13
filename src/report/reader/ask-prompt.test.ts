import { describe, expect, it } from 'vitest';
import type { CitedHunk, DiffChunk, NarrativeChapter, ReviewFile } from '@/review/narrative';
import type { ReviewMeta } from '@/review/review-meta';
import { askPrompt } from './ask-prompt';

const BASE = '3f9c2a1d7e4b6058a1c2d3e4f5a6b7c8d9e0f1a2';
const HEAD = '8b1e4d7a0c3f6295b8e1d4a7c0f3b6e9d2a5c8f1';

const prMeta: ReviewMeta = {
  repo: 'acme/widgets',
  kind: 'pr',
  title: 'Add hourly schedules',
  baseSha: BASE,
  headSha: HEAD,
  prNumber: 42,
  baseRefName: 'main',
  headRefName: 'feat/hourly',
  authorLogin: 'someone',
  description: null,
  stats: null,
};
const branchMeta: ReviewMeta = { ...prMeta, kind: 'branch', title: 'feat/hourly', prNumber: null };
const stagedMeta: ReviewMeta = {
  ...prMeta,
  kind: 'staged',
  title: 'Staged changes on main',
  prNumber: null,
  headRefName: 'staged',
};

const NO_FILES: ReadonlyMap<string, ReviewFile> = new Map();

/** Spans as git writes them, context lines included: `@@ -start,count +start,count @@`. */
function hunk(
  fileOrder: number,
  original: [number, number],
  modified: [number, number],
): CitedHunk {
  return {
    id: `H${String(fileOrder)}`,
    fileOrder,
    original: { startLine: original[0], lineCount: original[1] },
    modified: { startLine: modified[0], lineCount: modified[1] },
    changedLines: modified[1],
    tier: 'read',
  };
}

function chunk(filename: string, hunks: CitedHunk[]): DiffChunk {
  return { filename, language: 'typescript', hunks };
}

function chapter(diffChunks: DiffChunk[], extra: Partial<NarrativeChapter> = {}): NarrativeChapter {
  return {
    id: 'ch1',
    title: 'Cadence becomes a table',
    description: { lede: 'Due-date maths becomes a lookup table.', body: 'Not in the prompt.' },
    insights: [],
    diffChunks,
    ...extra,
  };
}

function spansOf(text: string): string[] {
  return text.split('\n').filter((line) => line.startsWith('- '));
}

describe('askPrompt', () => {
  it('names a PR, its range, the chapter and every cited span, and ends on the reader’s question', () => {
    const text = askPrompt(
      prMeta,
      chapter([chunk('src/cadence.ts', [hunk(0, [3, 7], [3, 8])])]),
      NO_FILES,
    );
    expect(text).toBe(
      [
        'Help me check one chapter of a code review of PR #42 "Add hourly schedules" in acme/widgets.',
        '',
        'The change is 3f9c2a1d7e4b..8b1e4d7a0c3f; `git diff 3f9c2a1d7e4b 8b1e4d7a0c3f` shows it.',
        '',
        'Chapter: Cadence becomes a table',
        'Due-date maths becomes a lookup table.',
        '',
        'It cites these lines, "head" at 8b1e4d7a0c3f and "base" at 3f9c2a1d7e4b:',
        '- src/cadence.ts: head 3-10, base 3-9',
        '',
        'Read those lines in the repository before answering. My question:',
      ].join('\n'),
    );
  });

  it('names a branch by its name, whatever the name', () => {
    expect(askPrompt(branchMeta, chapter([]), NO_FILES)).toMatch(
      /^Help me check one chapter of a code review of the branch feat\/hourly in acme\/widgets\.$/m,
    );
    expect(askPrompt({ ...branchMeta, headRefName: 'staged' }, chapter([]), NO_FILES)).toMatch(
      /of a code review of the branch staged in acme\/widgets\.$/m,
    );
  });

  it('names staged changes as such, and the branch they sit on', () => {
    expect(askPrompt(stagedMeta, chapter([]), NO_FILES)).toMatch(
      /of a code review of the staged changes on main in acme\/widgets\.$/m,
    );
  });

  it('names both sides of a deletion inside a file, an addition and a mixed edit', () => {
    const text = askPrompt(
      prMeta,
      chapter([
        chunk('src/a.ts', [
          // Three lines removed between three of context on each side.
          hunk(0, [10, 9], [10, 6]),
          // Four lines added between three of context on each side.
          hunk(1, [40, 6], [37, 10]),
          // One line rewritten into two.
          hunk(2, [70, 7], [71, 8]),
        ]),
      ]),
      NO_FILES,
    );
    expect(spansOf(text)).toEqual([
      '- src/a.ts: head 10-15, base 10-18',
      '- src/a.ts: head 37-46, base 40-45',
      '- src/a.ts: head 71-78, base 70-76',
    ]);
  });

  it('names only the side that exists for a deleted file and for a new one', () => {
    const text = askPrompt(
      prMeta,
      chapter([
        chunk('src/legacy/cron.ts', [hunk(0, [1, 9], [0, 0])]),
        chunk('src/queue.ts', [hunk(0, [0, 0], [1, 19])]),
      ]),
      NO_FILES,
    );
    expect(spansOf(text)).toEqual([
      '- src/legacy/cron.ts: base 1-9 (gone at head)',
      '- src/queue.ts: head 1-19 (new)',
    ]);
  });

  it('names a renamed file’s base side under the path it had', () => {
    const files = new Map<string, ReviewFile>([
      [
        'src/schedule/cadence.ts',
        {
          filename: 'src/schedule/cadence.ts',
          status: 'renamed',
          additions: 2,
          deletions: 1,
          origin: { filename: 'src/cadence.ts', similarity: 91 },
        },
      ],
    ]);
    const text = askPrompt(
      prMeta,
      chapter([chunk('src/schedule/cadence.ts', [hunk(0, [5, 7], [5, 8])])]),
      files,
    );
    expect(spansOf(text)).toEqual([
      '- src/schedule/cadence.ts: head 5-12, base src/cadence.ts 5-11',
    ]);
  });

  it('writes a one-line side as a single line number', () => {
    const text = askPrompt(
      prMeta,
      chapter([chunk('src/a.ts', [hunk(0, [13, 1], [22, 1])])]),
      NO_FILES,
    );
    expect(spansOf(text)).toEqual(['- src/a.ts: head 22, base 13']);
  });

  it('lists every span of a chapter citing several files, each file’s in file order', () => {
    const text = askPrompt(
      prMeta,
      chapter([
        chunk('src/cadence.ts', [hunk(2, [9, 7], [11, 14]), hunk(0, [1, 7], [1, 7])]),
        chunk('src/queue.ts', [hunk(0, [0, 0], [1, 19])]),
        chunk('test/helpers.ts', [hunk(1, [11, 8], [1, 7])]),
      ]),
      NO_FILES,
    );
    expect(spansOf(text)).toEqual([
      '- src/cadence.ts: head 1-7, base 1-7',
      '- src/cadence.ts: head 11-24, base 9-15',
      '- src/queue.ts: head 1-19 (new)',
      '- test/helpers.ts: head 1-7, base 11-18',
    ]);
  });

  it('adds the unchanged code the chapter points to, and leaves out a missing lede', () => {
    const text = askPrompt(
      prMeta,
      chapter([chunk('src/a.ts', [hunk(0, [1, 6], [1, 7])])], {
        description: undefined,
        contextExcerpts: [
          { filename: 'src/runner.ts', startLine: 10, endLine: 24, reason: 'Caps runs a day.' },
        ],
      }),
      NO_FILES,
    );
    expect(text).toContain('Chapter: Cadence becomes a table\n\nIt cites');
    expect(text).toContain('And this unchanged code it affects:\n- src/runner.ts: head 10-24\n');
    expect(text).not.toContain('Caps runs a day.');
  });

  it('leaves the description’s body out', () => {
    const text = askPrompt(
      prMeta,
      chapter([chunk('src/a.ts', [hunk(0, [1, 6], [1, 7])])]),
      NO_FILES,
    );
    expect(text).not.toContain('Not in the prompt.');
  });
});
