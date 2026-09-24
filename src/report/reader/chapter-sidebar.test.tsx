import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reviewCoverage } from '@/review/coverage';
import {
  RISK_SECTION_ID,
  SUMMARY_SECTION_ID,
  type NarrativeChapter,
  type ReviewFile,
  type ReviewRiskAssessment,
} from '@/review/narrative';
import { FILE_LIST_VIEW_KEY, useFileListView } from '@/report/stores/file-list-view';
import { HAND_BEFORE_AFTER } from '@/report/test/diagram-fixtures';
import { fireEvent, render, screen } from '@/report/test/render';
import { ChapterSidebar } from './chapter-sidebar';
import type { ReaderSection } from './sections';

const chapters: NarrativeChapter[] = [
  {
    id: 'ch1',
    title: 'Shape of the change',
    insights: [],
    diffChunks: [{ filename: 'src/app/page.tsx', language: 'typescript', hunks: [] }],
  },
  { id: 'ch2', title: 'Risks and follow-ups', insights: [], diffChunks: [] },
];

const sections: ReaderSection[] = [
  {
    id: SUMMARY_SECTION_ID,
    kind: 'summary',
    label: 'Summary',
    chapterNumber: null,
    hasDiagram: false,
  },
  { id: 'ch1', kind: 'chapter', label: 'Shape of the change', chapterNumber: 1, hasDiagram: false },
  {
    id: 'ch2',
    kind: 'chapter',
    label: 'Risks and follow-ups',
    chapterNumber: 2,
    hasDiagram: false,
  },
];

const riskAssessment: ReviewRiskAssessment = {
  score: 4,
  summary: 'High risk because data can be affected.',
  rationale: 'Persistence behavior changed.',
  factors: [],
};

/** The same list with a risk section, as `readerSections` builds it. */
const withRisk: ReaderSection[] = [
  sections[0] as ReaderSection,
  { id: RISK_SECTION_ID, kind: 'risk', label: 'Risk', chapterNumber: null, hasDiagram: false },
  ...sections.slice(1),
];

const noop = () => {};

const hunk = (id: string, fileOrder: number) => ({
  id,
  fileOrder,
  original: { startLine: fileOrder * 10, lineCount: 1 },
  modified: { startLine: fileOrder * 10, lineCount: 2 },
});

describe('<ChapterSidebar />', () => {
  it('renders summary plus each chapter title', () => {
    render(
      <ChapterSidebar
        sections={sections}
        chapters={chapters}
        activeId={SUMMARY_SECTION_ID}
        reviewTitle="My PR"
        onSelect={noop}
        onSelectFile={noop}
      />,
    );
    expect(screen.getByText('Summary')).toBeDefined();
    expect(screen.queryByText('My PR')).toBeNull();
    expect(screen.getByText('Shape of the change')).toBeDefined();
    expect(screen.getByText('Risks and follow-ups')).toBeDefined();
  });

  it('marks the active item with aria-current', () => {
    const { rerender } = render(
      <ChapterSidebar
        sections={sections}
        chapters={chapters}
        activeId={SUMMARY_SECTION_ID}
        reviewTitle="t"
        onSelect={noop}
        onSelectFile={noop}
      />,
    );
    expect(screen.getByText('Summary').closest('button')?.getAttribute('aria-current')).toBe(
      'true',
    );
    expect(
      screen.getByText('Shape of the change').closest('button')?.getAttribute('aria-current'),
    ).toBeNull();

    rerender(
      <ChapterSidebar
        sections={sections}
        chapters={chapters}
        activeId="ch2"
        reviewTitle="t"
        onSelect={noop}
        onSelectFile={noop}
      />,
    );
    expect(
      screen.getByText('Risks and follow-ups').closest('button')?.getAttribute('aria-current'),
    ).toBe('true');
  });

  it('calls onSelect with the chapter id on click', () => {
    const onSelect = vi.fn();
    render(
      <ChapterSidebar
        sections={sections}
        chapters={chapters}
        activeId={SUMMARY_SECTION_ID}
        reviewTitle="t"
        onSelect={onSelect}
        onSelectFile={noop}
      />,
    );
    fireEvent.click(screen.getByText('Risks and follow-ups'));
    expect(onSelect).toHaveBeenCalledWith('ch2');
  });

  it('renders the risk score above the list and routes it to the risk section', () => {
    const onSelect = vi.fn();
    render(
      <ChapterSidebar
        sections={withRisk}
        chapters={chapters}
        activeId="ch1"
        reviewTitle="t"
        riskAssessment={riskAssessment}
        onSelect={onSelect}
        onSelectFile={noop}
      />,
    );

    // The card carries an accessible name; the bars carry the title.
    const riskCard = screen.getByLabelText(/Risk 4 of 5/);
    expect(riskCard).toBeDefined();
    expect(screen.getByTitle('Risk 4 of 5: High')).toBeDefined();
    fireEvent.click(riskCard);
    expect(onSelect).toHaveBeenCalledWith(RISK_SECTION_ID);
  });

  it('gives risk one entry, not two', () => {
    // The card is the risk section's row. A second row in the list below
    // would be a duplicate control for the same destination.
    render(
      <ChapterSidebar
        sections={withRisk}
        chapters={chapters}
        activeId={SUMMARY_SECTION_ID}
        reviewTitle="t"
        riskAssessment={riskAssessment}
        onSelect={noop}
        onSelectFile={noop}
      />,
    );
    expect(screen.getAllByText('Risk')).toHaveLength(1);
    expect(screen.queryByRole('listitem', { name: /Risk$/ })).toBeNull();
  });

  it('marks the sections that carry a diagram, and only those', () => {
    render(
      <ChapterSidebar
        sections={sections.map((section) =>
          section.id === 'ch2' ? { ...section, hasDiagram: true } : section,
        )}
        chapters={[
          chapters[0] as NarrativeChapter,
          { ...(chapters[1] as NarrativeChapter), diagram: HAND_BEFORE_AFTER },
        ]}
        activeId={SUMMARY_SECTION_ID}
        reviewTitle="t"
        onSelect={noop}
        onSelectFile={noop}
      />,
    );
    const marks = screen.getAllByLabelText('has a diagram');
    expect(marks).toHaveLength(1);
    expect(marks[0]?.closest('button')?.textContent).toContain('Risks and follow-ups');
  });

  it('falls back to the files chapters selected hunks from', () => {
    render(
      <ChapterSidebar
        sections={sections}
        chapters={chapters}
        activeId={SUMMARY_SECTION_ID}
        reviewTitle="t"
        onSelect={noop}
        onSelectFile={noop}
      />,
    );
    expect(screen.getByText('page.tsx')).toBeDefined();
    expect(screen.getByText('src/app/')).toBeDefined();
    expect(screen.queryByText(/^\+/)).toBeNull();
  });

  it('clicking a file row routes via onSelectFile, not onSelect', () => {
    const onSelect = vi.fn();
    const onSelectFile = vi.fn();
    render(
      <ChapterSidebar
        sections={sections}
        chapters={chapters}
        activeId={SUMMARY_SECTION_ID}
        reviewTitle="t"
        files={[{ filename: 'src/app/page.tsx', status: 'modified', additions: 12, deletions: 3 }]}
        onSelect={onSelect}
        onSelectFile={onSelectFile}
      />,
    );

    // Basename on the main row, dirname underneath; the whole button is the
    // target. Stats appear twice (header totals + the row).
    fireEvent.click(screen.getByText('page.tsx'));
    expect(screen.getByText('src/app/')).toBeDefined();
    expect(screen.getAllByText('+12').length).toBe(2);
    expect(screen.getAllByText('-3').length).toBe(2);
    expect(onSelectFile).toHaveBeenCalledWith('src/app/page.tsx');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('lists a skipped file quietly, with the reason for anyone who asks', () => {
    render(
      <ChapterSidebar
        sections={sections}
        chapters={chapters}
        activeId={SUMMARY_SECTION_ID}
        reviewTitle="t"
        files={[
          {
            filename: 'package-lock.json',
            status: 'modified',
            additions: 40,
            deletions: 2,
            skipped: 'built-in',
          },
        ]}
        onSelect={noop}
        onSelectFile={noop}
      />,
    );

    const row = screen.getByText('package-lock.json').closest('button')!;
    expect(row.hasAttribute('data-skipped')).toBe(true);
    expect(row.getAttribute('title')).toBe('Not reviewed: lockfile, bundle or snapshot');
    expect(row.textContent).toContain('Not reviewed: lockfile, bundle or snapshot');
  });

  it('marks the files the chapters left out, wholly or in part, and says so for anyone who asks', () => {
    const files: ReviewFile[] = [
      {
        filename: 'src/app/page.tsx',
        status: 'modified',
        additions: 3,
        deletions: 1,
        hunks: [hunk('H0001', 1), hunk('H0002', 2)],
      },
      {
        filename: 'src/routes.ts',
        status: 'modified',
        additions: 1,
        deletions: 0,
        hunks: [hunk('H0003', 1)],
      },
      {
        filename: 'src/done.ts',
        status: 'modified',
        additions: 1,
        deletions: 0,
        hunks: [hunk('H0004', 1)],
      },
    ];
    const cited: NarrativeChapter[] = [
      {
        id: 'ch1',
        title: 'Shape of the change',
        insights: [],
        diffChunks: [
          { filename: 'src/app/page.tsx', language: 'typescript', hunks: [hunk('H0001', 1)] },
          { filename: 'src/done.ts', language: 'typescript', hunks: [hunk('H0004', 1)] },
        ],
      },
    ];
    const coverage = reviewCoverage({
      prTitle: 't',
      overviewSummary: { lede: '' },
      files,
      chapters: cited,
    });
    render(
      <ChapterSidebar
        sections={sections}
        chapters={cited}
        files={files}
        coverage={coverage}
        activeId={SUMMARY_SECTION_ID}
        reviewTitle="t"
        onSelect={noop}
        onSelectFile={noop}
      />,
    );

    const undiscussed = screen.getByText('routes.ts').closest('button')!;
    expect(undiscussed.getAttribute('title')).toBe('Not discussed in any chapter');
    expect(undiscussed.textContent).toContain('○');

    const partly = screen.getByText('page.tsx').closest('button')!;
    expect(partly.getAttribute('title')).toBe('Partly discussed: 1 of 2 hunks are in a chapter');
    expect(partly.textContent).toContain('◐');

    // A file every hunk of which is in a chapter carries nothing extra.
    const done = screen.getByText('done.ts').closest('button')!;
    expect(done.hasAttribute('title')).toBe(false);
    expect(done.textContent).not.toMatch(/[○◐]/);
  });

  it('says where a renamed file came from, ahead of any other note on its row', () => {
    render(
      <ChapterSidebar
        sections={sections}
        chapters={chapters}
        activeId={SUMMARY_SECTION_ID}
        reviewTitle="t"
        files={[
          {
            filename: 'src/app/page.tsx',
            status: 'renamed',
            additions: 3,
            deletions: 1,
            origin: { filename: 'src/pages/index.tsx', similarity: 71 },
            skipped: 'generated',
          },
        ]}
        onSelect={noop}
        onSelectFile={noop}
      />,
    );

    const row = screen.getByText('page.tsx').closest('button')!;
    const note = 'Renamed from src/pages/index.tsx (71% similar). Not reviewed: generated';
    expect(row.getAttribute('title')).toBe(note);
    expect(row.textContent).toContain(note);
  });

  it('marks the active file row with aria-current', () => {
    render(
      <ChapterSidebar
        sections={sections}
        chapters={chapters}
        activeId={SUMMARY_SECTION_ID}
        activeFile="src/app/page.tsx"
        reviewTitle="t"
        files={[{ filename: 'src/app/page.tsx', status: 'modified', additions: 1, deletions: 0 }]}
        onSelect={noop}
        onSelectFile={noop}
      />,
    );

    expect(screen.getByText('page.tsx').closest('button')?.getAttribute('aria-current')).toBe(
      'true',
    );
  });
});

const treeFiles: ReviewFile[] = [
  { filename: 'docs/guide.md', status: 'modified', additions: 2, deletions: 1 },
  {
    filename: 'package-lock.json',
    status: 'modified',
    additions: 40,
    deletions: 2,
    skipped: 'built-in',
  },
  {
    filename: 'src/web/components/chapter-sidebar.tsx',
    status: 'modified',
    additions: 9,
    deletions: 4,
  },
  { filename: 'src/web/components/file-tree.ts', status: 'added', additions: 60, deletions: 0 },
];

function renderFiles(activeFile: string | null = null) {
  return render(
    <ChapterSidebar
      sections={sections}
      chapters={chapters}
      activeId={SUMMARY_SECTION_ID}
      activeFile={activeFile}
      reviewTitle="t"
      files={treeFiles}
      onSelect={noop}
      onSelectFile={noop}
    />,
  );
}

/** The `--file-depth` the row hands the stylesheet to turn into left padding. */
function depthOf(label: string): string {
  return screen.getByText(label).closest('button')!.style.getPropertyValue('--file-depth');
}

/** The rows that open a file, in either view — a directory row is the one carrying `aria-expanded`. */
function fileRowButtons(): HTMLButtonElement[] {
  const list = screen.getByLabelText('Changed files');
  return [...list.querySelectorAll<HTMLButtonElement>('button:not([aria-expanded])')];
}

/**
 * A directory row, found the way a screen reader would name it: by its own
 * contents, which must stay the folded path rather than the subtree under it.
 */
function dirRow(name: string): HTMLElement {
  return screen.getByRole('button', { name });
}

describe('<ChapterSidebar /> file list view', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useFileListView.setState({ view: 'flat' });
  });

  it('starts flat, and the toggle is in the Files header', () => {
    renderFiles();
    expect(screen.queryByRole('button', { name: 'src/web/components' })).toBeNull();
    fireEvent.click(screen.getByLabelText('Group files by directory'));
    expect(dirRow('src/web/components')).toBeDefined();
    expect(screen.getByLabelText('List files flat')).toBeDefined();
  });

  it('lists exactly the same files either way', () => {
    const onSelectFile = vi.fn();
    const view = (
      <ChapterSidebar
        sections={sections}
        chapters={chapters}
        activeId={SUMMARY_SECTION_ID}
        reviewTitle="t"
        files={treeFiles}
        onSelect={noop}
        onSelectFile={onSelectFile}
      />
    );
    render(view);

    const clickAll = () => {
      onSelectFile.mockClear();
      for (const button of fileRowButtons()) fireEvent.click(button);
      return onSelectFile.mock.calls.map(([filename]) => filename as string);
    };

    const flat = clickAll();
    fireEvent.click(screen.getByLabelText('Group files by directory'));
    const tree = clickAll();

    expect(flat).toEqual(treeFiles.map((file) => file.filename));
    expect(tree.toSorted()).toEqual(flat.toSorted());
  });

  it('groups files under the directory they share, collapsing the chain to one row', () => {
    renderFiles();
    fireEvent.click(screen.getByLabelText('Group files by directory'));

    // `src`, `web` and `components` offer no choice between them, so they are
    // one row rather than three levels of indentation.
    expect(screen.getByText('src/web/components')).toBeDefined();
    expect(screen.getByText('docs')).toBeDefined();
    // The tree carries the directory, so the row no longer trails it.
    expect(screen.queryByText('src/web/components/')).toBeNull();
    expect(screen.getByText('package-lock.json')).toBeDefined();
  });

  it('folds a directory away without selecting it as a file', () => {
    const onSelectFile = vi.fn();
    render(
      <ChapterSidebar
        sections={sections}
        chapters={chapters}
        activeId={SUMMARY_SECTION_ID}
        reviewTitle="t"
        files={treeFiles}
        onSelect={noop}
        onSelectFile={onSelectFile}
      />,
    );
    fireEvent.click(screen.getByLabelText('Group files by directory'));

    // The fold state belongs to the control that has the focus, so it is read
    // off the button rather than off any wrapper around it.
    expect(dirRow('src/web/components').getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(dirRow('src/web/components'));
    expect(onSelectFile).not.toHaveBeenCalled();
    expect(screen.queryByText('file-tree.ts')).toBeNull();
    expect(dirRow('src/web/components').getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(dirRow('src/web/components'));
    expect(screen.getByText('file-tree.ts')).toBeDefined();
  });

  it('nests the rows it groups, and claims no role it cannot honour', () => {
    renderFiles('src/web/components/file-tree.ts');
    fireEvent.click(screen.getByLabelText('Group files by directory'));

    // Nesting is the hierarchy: the directory's own item holds the list its
    // files sit in, which assistive technology reports without a tree role.
    const item = dirRow('src/web/components').closest('li')!;
    expect([...item.querySelectorAll(':scope > ul > li')]).toHaveLength(2);

    // An ARIA tree announces arrow-key navigation, and there is none here.
    const list = screen.getByLabelText('Changed files');
    expect(list.querySelectorAll('[role="tree"], [role="treeitem"], [role="group"]')).toHaveLength(
      0,
    );

    // The active file marks its own control, exactly as in the flat view.
    expect(screen.getByText('file-tree.ts').closest('button')?.getAttribute('aria-current')).toBe(
      'true',
    );

    // The depth the stylesheet turns into left padding. It is the row's only
    // account of where it sits, so a row that forgot it would sit flush with
    // its parent and look like a sibling.
    expect(depthOf('docs')).toBe('0');
    expect(depthOf('package-lock.json')).toBe('0');
    expect(depthOf('guide.md')).toBe('1');
    expect(depthOf('file-tree.ts')).toBe('1');
  });

  it('keeps the row itself identical across the two views', () => {
    renderFiles('src/web/components/file-tree.ts');
    const flatRow = screen.getByText('file-tree.ts').closest('button')!;
    expect(flatRow.getAttribute('aria-current')).toBe('true');
    expect(flatRow.textContent).toContain('A');
    expect(flatRow.textContent).toContain('+60');

    fireEvent.click(screen.getByLabelText('Group files by directory'));
    const treeRow = screen.getByText('file-tree.ts').closest('button')!;
    expect(treeRow.getAttribute('aria-current')).toBe('true');
    expect(treeRow.textContent).toContain('A');
    expect(treeRow.textContent).toContain('+60');

    const skipped = screen.getByText('package-lock.json').closest('button')!;
    expect(skipped.hasAttribute('data-skipped')).toBe(true);
    expect(skipped.getAttribute('title')).toBe('Not reviewed: lockfile, bundle or snapshot');
  });

  it('comes back as the tree after a reload', () => {
    window.localStorage.setItem(FILE_LIST_VIEW_KEY, 'tree');
    void useFileListView.persist.rehydrate();
    renderFiles();
    expect(dirRow('src/web/components')).toBeDefined();
  });

  it('remembers a choice but not which directories were folded', () => {
    const { unmount } = renderFiles();
    fireEvent.click(screen.getByLabelText('Group files by directory'));
    fireEvent.click(dirRow('src/web/components'));
    expect(window.localStorage.getItem(FILE_LIST_VIEW_KEY)).toBe('tree');
    unmount();

    renderFiles();
    expect(dirRow('src/web/components').getAttribute('aria-expanded')).toBe('true');
  });
});
