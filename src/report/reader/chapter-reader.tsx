import { VisuallyHidden } from '@mantine/core';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { reviewCoverage } from '@/review/coverage';
import { SUMMARY_SECTION_ID, type NarrativeReview } from '@/review/narrative';
import type { ReviewMeta } from '@/review/review-meta';
import { ChapterCard } from '@/report/reader/chapter-card';
import { ChapterSidebar } from '@/report/reader/chapter-sidebar';
import { FileView } from '@/report/reader/file-view';
import { useHashParams } from '@/report/reader/hash-params';
import {
  anchorJudgementCalls,
  judgementCallsByFile,
  type AnchoredJudgementCall,
} from '@/report/reader/judgement-calls';
import { RiskCard } from '@/report/reader/risk-card';
import { findSection, readerSections, type ReaderSection } from '@/report/reader/sections';
import { SummaryCard } from '@/report/reader/summary-card';
import { useNarrativeKeyboard } from '@/report/reader/use-narrative-keyboard';
import { useReadingFile } from '@/report/reader/use-reading-file';
import { useReaderColumn } from '@/report/stores/diff-view';
import {
  applySidebarWidth,
  clampSidebarWidth,
  useSidebarWidth,
} from '@/report/stores/sidebar-width';
import { SIDEBAR_WIDTHS } from '@/report/theme/tokens';
import classes from './chapter-reader.module.css';

/** Pixels per arrow press on the resize handle. Exported for the test that counts them. */
export const KEYBOARD_RESIZE_STEP = 16;

/**
 * Publish the article column's width for as long as the reader is on screen.
 *
 * A `data-bleed` diff spans this column exactly, so this element's width is the
 * width every Monaco editor gets, and it is the one number that decides whether
 * a side-by-side diff fits. Measuring here rather than in the diffs themselves
 * means the answer holds on a section that happens to have no diff in it, and
 * that one observer covers however many the section does have. It is cleared on
 * unmount, so a page without a reader leaves the preference alone.
 */
function useReportedColumnWidth(ref: React.RefObject<HTMLElement | null>): void {
  const setColumnWidth = useReaderColumn((s) => s.setColumnWidth);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    /*
     * A width of zero is not a narrow column, it is an unmeasured one — an
     * ancestor with `display: none`, or a test environment that reports zeros
     * for every box. The store reads `null` as "nothing has measured this yet"
     * and leaves the preference alone, whereas a zero would read as too narrow
     * for two panes: the toggle would sit permanently disabled and every diff
     * would be forced to stacked. So report the absence, not the number.
     */
    const publish = (width: number): void => setColumnWidth(width > 0 ? width : null);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) publish(entry.contentRect.width);
    });
    observer.observe(element);
    publish(element.getBoundingClientRect().width);
    return () => {
      observer.disconnect();
      setColumnWidth(null);
    };
  }, [ref, setColumnWidth]);
}

function fileExists(filename: string, review: NarrativeReview): boolean {
  if (review.files?.some((f) => f.filename === filename)) return true;
  return review.chapters.some((chapter) =>
    chapter.diffChunks.some((chunk) => chunk.filename === filename),
  );
}

export interface ChapterReaderProps {
  review: NarrativeReview;
  /** The summary header: repository, PR, refs, author, description. */
  meta: ReviewMeta;
  /** Active section when the URL names none (or an unknown one). */
  initialActiveId: string;
}

/**
 * Two-column editorial reader: chapters + files on the left, the active
 * section on the right. Owns the keyboard bindings, the resizable sidebar
 * and the `?ch=` / `?file=` URL state (`?file=` wins when both are set; the
 * chapter is what comes back when the file view is closed). Inline diffs read
 * their files from the `EmbeddedFileSource` the caller wraps it in.
 */
export function ChapterReader({ review, meta, initialActiveId }: ChapterReaderProps) {
  const [searchParams, setSearchParams] = useHashParams();
  const sidebarWidth = useSidebarWidth((state) => state.width);
  const setSidebarWidth = useSidebarWidth((state) => state.setWidth);
  const mainRef = useRef<HTMLElement | null>(null);
  useReportedColumnWidth(mainRef);
  const coverage = useMemo(() => reviewCoverage(review), [review]);
  const sections = useMemo(() => readerSections(review), [review]);
  const judgementCalls = useMemo(() => anchorJudgementCalls(review), [review]);
  const urlActive = searchParams.get('ch');
  const urlFile = searchParams.get('file');
  const activeFile = urlFile && fileExists(urlFile, review) ? urlFile : null;
  const activeId =
    activeFile === null
      ? urlActive === null
        ? SUMMARY_SECTION_ID
        : (findSection(sections, urlActive)?.id ?? initialActiveId)
      : SUMMARY_SECTION_ID;

  /*
   * A chapter or file switch starts the reader at the top of its content —
   * carrying over the previous section's scroll position reads as picking up
   * a new chapter halfway through. This effect skips its own first run so a deep link still lands where its
   * `?ch=`/`?file=` puts it rather than snapping away from it.
   */
  const activeContentId = activeFile ?? activeId;
  /*
   * Only in the chapter view. The file view already marks its file, and that
   * mark means "this is what the column shows", which is a stronger claim than
   * scroll position has any business making.
   */
  const readingFile = useReadingFile(mainRef, activeContentId);
  const isFirstRender = useRef(true);
  // oxlint-disable-next-line react/exhaustive-deps -- activeContentId is the trigger, not read in the body
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
  }, [activeContentId]);

  const onSelect = useCallback(
    (id: string) => {
      const next = new URLSearchParams(searchParams);
      next.delete('file');
      if (id === SUMMARY_SECTION_ID) next.delete('ch');
      else next.set('ch', id);
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  const onSelectFile = useCallback(
    (filename: string) => {
      const next = new URLSearchParams(searchParams);
      next.delete('ch');
      next.set('file', filename);
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  useNarrativeKeyboard({ sections, activeId, onSelect });

  const onResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = sidebarWidth;
      let width = startWidth;
      /*
       * Painted straight onto the variable while the pointer is down, and
       * committed to the store once the gesture ends: a width that is still
       * moving has not earned a re-render of every editor in the article, nor
       * a write to localStorage per frame.
       *
       * `pointercancel` ends it the same way `pointerup` does, and is the case
       * that costs something now that the commit happens once. A browser that
       * takes a touch over for panning sends only the cancel, and a gesture
       * that ended there would leave the column painted at a width nothing had
       * stored — back to the old one on reload, and wrong in `aria-valuenow`
       * meanwhile — with the move handler still live, so the column would go
       * on following a pointer with no button down.
       */
      const onPointerMove = (moveEvent: PointerEvent): void => {
        width = clampSidebarWidth(startWidth + moveEvent.clientX - startX);
        applySidebarWidth(width);
      };
      const onPointerEnd = (): void => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerEnd);
        window.removeEventListener('pointercancel', onPointerEnd);
        setSidebarWidth(width);
      };
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerEnd);
      window.addEventListener('pointercancel', onPointerEnd);
    },
    [sidebarWidth, setSidebarWidth],
  );

  const onResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      setSidebarWidth(sidebarWidth + direction * KEYBOARD_RESIZE_STEP);
    },
    [sidebarWidth, setSidebarWidth],
  );

  // One lookup, then one switch: the section list already knows which kind of
  // card each id wants, so the render site never re-derives that from the id.
  // Falls back to the summary, not sections[0] — risk sits ahead of it in the
  // list when there is an assessment.
  const activeSection =
    findSection(sections, activeId) ?? findSection(sections, SUMMARY_SECTION_ID)!;
  const activeIndex = review.chapters.findIndex((ch) => ch.id === activeId) + 1;

  return (
    <div className={classes.grid}>
      <aside className={classes.aside}>
        <ChapterSidebar
          sections={sections}
          chapters={review.chapters}
          files={review.files}
          coverage={coverage}
          activeId={activeId}
          activeFile={activeFile}
          readingFile={activeFile === null ? readingFile : null}
          reviewTitle={review.prTitle}
          riskAssessment={review.riskAssessment}
          onSelect={onSelect}
          onSelectFile={onSelectFile}
        />
        <button
          type="button"
          role="separator"
          aria-label="Resize review navigation"
          aria-orientation="vertical"
          aria-valuemin={SIDEBAR_WIDTHS.min}
          aria-valuemax={SIDEBAR_WIDTHS.max}
          aria-valuenow={sidebarWidth}
          onPointerDown={onResizePointerDown}
          onKeyDown={onResizeKeyDown}
          className={classes.handle}
        >
          <VisuallyHidden>Resize review navigation</VisuallyHidden>
        </button>
      </aside>

      <section aria-live="polite" className={classes.main} ref={mainRef}>
        {activeFile ? (
          <FileView
            filename={activeFile}
            chapters={review.chapters}
            files={review.files}
            coverage={coverage.byFile.get(activeFile) ?? null}
          />
        ) : (
          <SectionCard
            section={activeSection}
            review={review}
            meta={meta}
            judgementCalls={judgementCalls}
            chapterIndex={activeIndex}
            onSelectFile={onSelectFile}
            onSelect={onSelect}
          />
        )}
      </section>
    </div>
  );
}

/**
 * The one card the reader shows for the active section. `sections` is already
 * the authority on which sections this review has — the risk section is only
 * in the list when there is an assessment — so the kind alone decides which
 * card to draw. Where a case still tests its data, it is narrowing an optional
 * field for the type system, not asking whether the section can be reached.
 */
function SectionCard({
  section,
  review,
  meta,
  judgementCalls,
  chapterIndex,
  onSelectFile,
  onSelect,
}: {
  section: ReaderSection;
  review: NarrativeReview;
  meta: ReviewMeta;
  judgementCalls: readonly AnchoredJudgementCall[];
  chapterIndex: number;
  onSelectFile: (filename: string) => void;
  onSelect: (id: string) => void;
}) {
  switch (section.kind) {
    case 'risk':
      return review.riskAssessment ? <RiskCard assessment={review.riskAssessment} /> : null;
    case 'chapter': {
      const chapter = review.chapters.find((ch) => ch.id === section.id);
      return chapter ? (
        <ChapterCard
          chapter={chapter}
          chapterIndex={chapterIndex}
          judgementCalls={judgementCallsByFile(judgementCalls, chapter.id)}
          onSelectFile={onSelectFile}
        />
      ) : null;
    }
    case 'summary':
      return (
        <SummaryCard
          review={review}
          meta={meta}
          judgementCalls={judgementCalls}
          onSelectFile={onSelectFile}
          onSelectChapter={onSelect}
        />
      );
  }
}
