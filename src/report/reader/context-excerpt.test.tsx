import type { EditorProps } from '@monaco-editor/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reviewCoverage } from '@/review/coverage';
import type { ContextExcerpt, NarrativeChapter } from '@/review/narrative';
import { EmbeddedFileSource } from '@/report/reader/file-source';
import { SAMPLE_BUNDLE, SAMPLE_EXCERPT_FILE } from '@/report/sample-bundle';
import { useDimComments } from '@/report/stores/dim-comments';
import { act, render, screen, within } from '@/report/test/render';
import { ChapterCard } from './chapter-card';
import { ChapterReader } from './chapter-reader';
import { ContextExcerptCard, lineRange } from './context-excerpt';
import { DIMMED_THEME } from './monaco-themes';

/** What the excerpt's editor was handed, laid out where a test can read it. */
vi.mock('@monaco-editor/react', () => ({
  DiffEditor: () => <div data-testid="diff-editor" />,
  Editor: ({ value, path, options, theme }: EditorProps) => {
    const numbers = options?.lineNumbers;
    return (
      <div
        data-testid="code-editor"
        data-path={path}
        data-read-only={String(options?.readOnly)}
        data-first-line={typeof numbers === 'function' ? numbers(1) : String(numbers)}
        data-gutter={String(options?.lineNumbersMinChars)}
        data-theme={theme}
      >
        {value}
      </div>
    );
  },
  loader: { config: () => {}, init: () => Promise.resolve({ editor: { defineTheme: () => {} } }) },
}));

afterEach(() => {
  window.location.hash = '';
});

const excerpt = SAMPLE_BUNDLE.review.chapters
  .flatMap((chapter) => chapter.contextExcerpts ?? [])
  .find((each) => each.filename === SAMPLE_EXCERPT_FILE)!;

function renderExcerpt(shown: ContextExcerpt = excerpt) {
  return render(
    <EmbeddedFileSource bundle={SAMPLE_BUNDLE}>
      <ContextExcerptCard excerpt={shown} modelKey="cadence-table-0" />
    </EmbeddedFileSource>,
  );
}

describe('an excerpt of unchanged code', () => {
  it('names its file, its span and why it is here, then the lines in a read-only editor', async () => {
    renderExcerpt();
    const card = screen.getByRole('figure', {
      name: 'Unchanged code in src/runner/budget.ts, L3–14',
    });
    expect(within(card).getByText('src/runner/')).toBeInTheDocument();
    expect(within(card).getByText('budget.ts')).toBeInTheDocument();
    expect(within(card).getByText('unchanged · L3–14')).toBeInTheDocument();
    expect(within(card).getByText(excerpt.reason)).toBeInTheDocument();

    const editor = await within(card).findByTestId('code-editor');
    expect(editor.textContent).toMatch(/^\/\*\* Reviews one repo may run in a day/);
    expect(editor.textContent).toMatch(/return false;\n\}$/);
    expect(editor.textContent?.split('\n')).toHaveLength(12);
    expect(editor).toHaveAttribute('data-read-only', 'true');
  });

  it('numbers its lines as the file does, with a gutter wide enough for the last', async () => {
    renderExcerpt();
    const editor = await screen.findByTestId('code-editor');
    expect(editor).toHaveAttribute('data-first-line', '3');
    expect(editor).toHaveAttribute('data-gutter', '3');
    expect(editor.getAttribute('data-path')).toBe(
      'file:///__excerpt__/cadence-table-0/src/runner/budget.ts',
    );
  });

  it('dims its comments with the diffs’, in the editor it already has', async () => {
    useDimComments.setState({ comments: 'normal' });
    renderExcerpt();
    const editor = await screen.findByTestId('code-editor');
    expect(editor).toHaveAttribute('data-theme', 'vs-dark');

    act(() => useDimComments.setState({ comments: 'dimmed' }));
    expect(screen.getByTestId('code-editor')).toBe(editor);
    expect(editor).toHaveAttribute('data-theme', DIMMED_THEME.dark);
    act(() => useDimComments.setState({ comments: 'normal' }));
  });

  it('spells a one-line span as one line', () => {
    expect(lineRange({ ...excerpt, startLine: 5, endLine: 5 })).toBe('L5');
    expect(lineRange(excerpt)).toBe('L3–14');
  });

  it('says so when the report does not carry its file, rather than drawing an empty editor', () => {
    renderExcerpt({ ...excerpt, filename: 'src/not-embedded.ts' });
    expect(screen.getByText(/isn’t in the report/)).toBeInTheDocument();
    expect(screen.queryByTestId('code-editor')).not.toBeInTheDocument();
  });

  it('is never a mark of the changed file being read', () => {
    const { container } = renderExcerpt();
    expect(container.querySelector('[data-diff-file]')).toBeNull();
  });
});

describe('a chapter with an excerpt', () => {
  const chapter: NarrativeChapter = SAMPLE_BUNDLE.review.chapters.find(
    (each) => each.contextExcerpts !== undefined,
  )!;

  it('draws it after the chapter’s diffs, under its own rule, and does not count it as touched', () => {
    render(
      <EmbeddedFileSource bundle={SAMPLE_BUNDLE}>
        <ChapterCard chapter={chapter} chapterIndex={1} />
      </EmbeddedFileSource>,
    );
    const files = screen.getByText('Files in this chapter');
    const unchanged = screen.getByText('Unchanged code it affects');
    expect(
      files.compareDocumentPosition(unchanged) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(unchanged.closest('header')!).getByText('1')).toBeInTheDocument();
    expect(screen.getByText(/^1 file touched · /)).toBeInTheDocument();
  });

  it('leaves the excerpted file out of the sidebar’s files, coverage and the file view', () => {
    window.location.hash = `#/?ch=${chapter.id}`;
    const { review, meta } = SAMPLE_BUNDLE;
    render(
      <EmbeddedFileSource bundle={SAMPLE_BUNDLE}>
        <ChapterReader review={review} meta={meta} initialActiveId={chapter.id} />
      </EmbeddedFileSource>,
    );
    expect(
      screen.getByRole('figure', { name: /^Unchanged code in src\/runner\/budget\.ts/ }),
    ).toBeInTheDocument();
    const navigation = screen.getByRole('navigation', { name: 'Review navigation' });
    expect(within(navigation).getByText('cadence.ts')).toBeInTheDocument();
    expect(within(navigation).queryByText('budget.ts')).toBeNull();
    expect([...reviewCoverage(review).byFile.keys()]).not.toContain(SAMPLE_EXCERPT_FILE);
  });

  it('will not open the excerpted file as a changed file', () => {
    window.location.hash = `#/?file=${encodeURIComponent(SAMPLE_EXCERPT_FILE)}`;
    const { review, meta } = SAMPLE_BUNDLE;
    render(
      <EmbeddedFileSource bundle={SAMPLE_BUNDLE}>
        <ChapterReader review={review} meta={meta} initialActiveId={chapter.id} />
      </EmbeddedFileSource>,
    );
    expect(screen.queryByRole('figure', { name: `Diff for ${SAMPLE_EXCERPT_FILE}` })).toBeNull();
  });
});
