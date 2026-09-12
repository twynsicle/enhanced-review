import { createRoutesStub } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { BUNDLE_SCHEMA_VERSION, type ReviewBundle } from '@/domain/review/bundle';
import { reviewCoverage } from '@/domain/review/coverage';
import type { NarrativeChapter, ResolvedDiffHunk, ReviewFile } from '@/domain/review/narrative';
import { EmbeddedFileSource } from '@/web/components/narrative/file-source';
import { render, screen } from '@/web/test/render';
import { FileView } from './file-view';

vi.mock('@monaco-editor/react', () => ({
  DiffEditor: () => <div data-testid="diff-editor" />,
}));

const chapters: NarrativeChapter[] = [
  { id: 'ch1', title: 'Shape of the change', insights: [], diffChunks: [] },
];

const hunk = (id: string, fileOrder: number): ResolvedDiffHunk => ({
  id,
  fileOrder,
  original: { startLine: fileOrder, lineCount: 1 },
  modified: { startLine: fileOrder, lineCount: 1 },
});

/** The view inside an embedded source carrying both sides of the one fixture file. */
function renderWithSource(files: ReviewFile[], cited: NarrativeChapter[]) {
  const bundle: ReviewBundle = {
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    generatedAt: '2026-09-11T10:00:00.000Z',
    meta: {
      repo: 'a/r',
      title: 't',
      prNumber: null,
      baseRefName: null,
      headRefName: null,
      authorLogin: null,
      description: null,
      stats: null,
    },
    review: { prTitle: 't', overviewSummary: '', chapters: cited, files },
    files: {
      'src/app.ts': {
        base: { kind: 'content', content: 'a\nb\nc\n' },
        head: { kind: 'content', content: 'a\nB\nC\n' },
      },
    },
  };
  // The reader computes coverage once and hands each file its share.
  const coverage = reviewCoverage(bundle.review).byFile.get('src/app.ts') ?? null;
  const Stub = createRoutesStub([
    {
      path: '/',
      Component: () => (
        <EmbeddedFileSource bundle={bundle}>
          <FileView filename="src/app.ts" chapters={cited} files={files} coverage={coverage} />
        </EmbeddedFileSource>
      ),
    },
  ]);
  return render(<Stub initialEntries={['/']} />);
}

describe('FileView without hunks', () => {
  it('says why a skipped file was not reviewed', () => {
    render(
      <FileView
        filename="src/generated/client.ts"
        chapters={chapters}
        coverage={null}
        files={[
          {
            filename: 'src/generated/client.ts',
            status: 'modified',
            additions: 300,
            deletions: 12,
            skipped: 'generated',
          },
        ]}
      />,
    );
    expect(screen.getByText(/marked linguist-generated in .gitattributes/)).toBeDefined();
  });

  it('says the reviewer chose no hunks for a file from a review without a catalog', () => {
    render(
      <FileView
        filename="src/app.ts"
        chapters={chapters}
        coverage={null}
        files={[{ filename: 'src/app.ts', status: 'modified', additions: 1, deletions: 1 }]}
      />,
    );
    expect(screen.getByText(/didn’t select any hunks for this file/)).toBeDefined();
  });

  it('says there was no text diff for a file whose catalog is empty and nothing changed', () => {
    render(
      <FileView
        filename="src/app.ts"
        chapters={chapters}
        coverage={null}
        files={[
          { filename: 'src/app.ts', status: 'modified', additions: 0, deletions: 0, hunks: [] },
        ]}
      />,
    );
    expect(screen.getByText(/changed without a text diff to show/)).toBeDefined();
  });

  it('does not claim "no text diff" for an empty catalog beside a line count', () => {
    // A file the prompt filtered or truncated away: it has a patch, the
    // reviewer was simply never given it.
    render(
      <FileView
        filename="src/app.ts"
        chapters={chapters}
        coverage={null}
        files={[
          { filename: 'src/app.ts', status: 'modified', additions: 9, deletions: 2, hunks: [] },
        ]}
      />,
    );
    expect(screen.queryByText(/without a text diff/)).toBeNull();
    expect(screen.getByText(/wasn’t among the hunks the reviewer was given/)).toBeDefined();
  });
});

describe('FileView with hunks the chapters left out', () => {
  const files: ReviewFile[] = [
    {
      filename: 'src/app.ts',
      status: 'modified',
      additions: 2,
      deletions: 2,
      hunks: [hunk('H0001', 1), hunk('H0002', 2)],
    },
  ];

  it('shows the uncited hunks under their own label, after the cited ones', () => {
    const cited: NarrativeChapter[] = [
      {
        id: 'ch1',
        title: 'Shape of the change',
        insights: [],
        diffChunks: [{ filename: 'src/app.ts', language: 'typescript', hunks: [hunk('H0001', 1)] }],
      },
    ];
    renderWithSource(files, cited);

    expect(screen.getByText(/Discussed in/).textContent).toContain('(1 of 2 hunks)');
    const leftover = screen.getByRole('region', { name: 'Hunks not discussed in any chapter' });
    expect(leftover.textContent).toContain('Not discussed in any chapter');
    // Two figures: the chapter's chunk and the leftover one.
    expect(screen.getAllByRole('figure', { name: 'Diff for src/app.ts' })).toHaveLength(2);
  });

  it('shows a file no chapter cites as one diff, and says so in the header', () => {
    renderWithSource(files, chapters);

    expect(screen.getByText('Not discussed in any chapter')).toBeDefined();
    expect(screen.getAllByRole('figure', { name: 'Diff for src/app.ts' })).toHaveLength(1);
    expect(screen.queryByText(/didn’t select any hunks/)).toBeNull();
  });
});
