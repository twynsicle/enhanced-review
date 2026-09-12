import { createRoutesStub } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { BUNDLE_SCHEMA_VERSION, type ReviewBundle } from '@/domain/review/bundle';
import {
  SUMMARY_SECTION_ID,
  UNDISCUSSED_SECTION_ID,
  type NarrativeReview,
  type ResolvedDiffHunk,
} from '@/domain/review/narrative';
import { ChapterReader } from '@/web/components/narrative/chapter-reader';
import { EmbeddedFileSource } from '@/web/components/narrative/file-source';
import { sectionHeadingId } from '@/web/components/narrative/sections';
import { fireEvent, render, screen } from '@/web/test/render';

vi.mock('@monaco-editor/react', () => ({
  DiffEditor: () => <div data-testid="diff-editor" />,
}));

const hunk = (id: string, fileOrder: number): ResolvedDiffHunk => ({
  id,
  fileOrder,
  original: { startLine: fileOrder, lineCount: 1 },
  modified: { startLine: fileOrder, lineCount: 1 },
});

/** One chapter citing half of `a.ts`; `b.ts` cited nowhere; `c.ts` fully cited. */
const review: NarrativeReview = {
  prTitle: 'A change',
  overviewSummary: 'It changes things.',
  files: [
    {
      filename: 'src/a.ts',
      status: 'modified',
      additions: 2,
      deletions: 2,
      hunks: [hunk('H0001', 1), hunk('H0002', 2)],
    },
    {
      filename: 'src/b.ts',
      status: 'modified',
      additions: 1,
      deletions: 1,
      hunks: [hunk('H0003', 1)],
    },
    {
      filename: 'src/c.ts',
      status: 'modified',
      additions: 1,
      deletions: 1,
      hunks: [hunk('H0004', 1)],
    },
  ],
  chapters: [
    {
      id: 'ch1',
      title: 'The one chapter',
      insights: [],
      diffChunks: [
        { filename: 'src/a.ts', language: 'typescript', hunks: [hunk('H0001', 1)] },
        { filename: 'src/c.ts', language: 'typescript', hunks: [hunk('H0004', 1)] },
      ],
    },
  ],
};

const bundle: ReviewBundle = {
  schemaVersion: BUNDLE_SCHEMA_VERSION,
  generatedAt: '2026-09-11T10:00:00.000Z',
  meta: {
    repo: 'acme/widgets',
    title: 'A change',
    prNumber: null,
    baseRefName: null,
    headRefName: null,
    authorLogin: null,
    description: null,
    stats: null,
  },
  review,
  files: Object.fromEntries(
    ['src/a.ts', 'src/b.ts', 'src/c.ts'].map((name) => [
      name,
      {
        base: { kind: 'content' as const, content: 'a\nb\nc\n' },
        head: { kind: 'content' as const, content: 'A\nB\nC\n' },
      },
    ]),
  ),
};

function renderReader(entry: string) {
  const Stub = createRoutesStub([
    {
      path: '/',
      Component: () => (
        <EmbeddedFileSource bundle={bundle}>
          <ChapterReader review={review} meta={bundle.meta} initialActiveId={SUMMARY_SECTION_ID} />
        </EmbeddedFileSource>
      ),
    },
  ]);
  render(<Stub initialEntries={[entry]} />);
}

describe('the "Not discussed" section', () => {
  it('is the last entry in the sidebar and opens from it', () => {
    renderReader('/');
    const rows = screen.getAllByRole('listitem').map((item) => item.textContent ?? '');
    const sectionRows = rows.filter((text) => /Summary|chapter|Not discussed/.test(text));
    expect(sectionRows.at(-1)).toContain('Not discussed');

    // The exact text is the section row's label; the file rows only carry
    // the longer "Not discussed in any chapter" for screen readers.
    fireEvent.click(screen.getByText('Not discussed'));
    expect(screen.getByRole('heading', { level: 1, name: 'Not discussed' })).toBeDefined();
  });

  it('renders every uncited hunk by file, and says where a partly discussed file is discussed', () => {
    renderReader(`/?ch=${UNDISCUSSED_SECTION_ID}`);

    expect(screen.getByRole('heading', { level: 1, name: 'Not discussed' })).toBeDefined();
    expect(
      screen.getByText('The chapters cite 2 of the 4 hunks the reviewer was given.', {
        exact: false,
      }),
    ).toBeDefined();
    expect(
      screen.getByText('1 file not discussed in any chapter, and 1 file discussed only in part'),
    ).toBeDefined();
    expect(screen.getByRole('figure', { name: 'Diff for src/a.ts' })).toBeDefined();
    expect(screen.getByRole('figure', { name: 'Diff for src/b.ts' })).toBeDefined();
    expect(screen.queryByRole('figure', { name: 'Diff for src/c.ts' })).toBeNull();
    expect(
      screen.getByText('Other hunks of src/a.ts are discussed in The one chapter.'),
    ).toBeDefined();
  });

  it('is where End lands, with focus on its heading like any other section', () => {
    renderReader('/');
    fireEvent.keyDown(document, { key: 'End' });

    const heading = screen.getByRole('heading', { level: 1, name: 'Not discussed' });
    // The id convention the keyboard hook focuses; a card that spelled its own
    // was walked to and then never focused.
    expect(heading.id).toBe(sectionHeadingId(UNDISCUSSED_SECTION_ID));
  });

  it('is absent when every hunk is cited', () => {
    const fully: NarrativeReview = {
      ...review,
      chapters: [
        {
          ...review.chapters[0]!,
          diffChunks: [
            {
              filename: 'src/a.ts',
              language: 'typescript',
              hunks: [hunk('H0001', 1), hunk('H0002', 2)],
            },
            { filename: 'src/b.ts', language: 'typescript', hunks: [hunk('H0003', 1)] },
            { filename: 'src/c.ts', language: 'typescript', hunks: [hunk('H0004', 1)] },
          ],
        },
      ],
    };
    const Stub = createRoutesStub([
      {
        path: '/',
        Component: () => (
          <EmbeddedFileSource bundle={{ ...bundle, review: fully }}>
            <ChapterReader review={fully} meta={bundle.meta} initialActiveId={SUMMARY_SECTION_ID} />
          </EmbeddedFileSource>
        ),
      },
    ]);
    render(<Stub initialEntries={[`/?ch=${UNDISCUSSED_SECTION_ID}`]} />);

    expect(screen.queryByText('Not discussed')).toBeNull();
    // A section id this review does not have falls back to the summary rather than an empty page.
    expect(screen.queryByRole('heading', { level: 1, name: 'Not discussed' })).toBeNull();
  });
});
