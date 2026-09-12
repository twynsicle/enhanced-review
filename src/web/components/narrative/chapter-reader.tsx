import { VisuallyHidden } from '@mantine/core';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useSearchParams } from 'react-router';
import {
  RISK_SECTION_ID,
  SUMMARY_SECTION_ID,
  type NarrativeReview,
} from '@/domain/review/narrative';
import type { ReviewMeta } from '@/domain/review/review-meta';
import { ChapterCard } from '@/web/components/narrative/chapter-card';
import { ChapterSidebar } from '@/web/components/narrative/chapter-sidebar';
import { FileView } from '@/web/components/narrative/file-view';
import { RiskCard } from '@/web/components/narrative/risk-card';
import { findSection, readerSections } from '@/web/components/narrative/sections';
import { SummaryCard } from '@/web/components/narrative/summary-card';
import { useNarrativeKeyboard } from '@/web/components/narrative/use-narrative-keyboard';
import { useReaderColumn } from '@/web/stores/diff-view';
import {
  applySidebarWidth,
  bindSidebarWidth,
  clampSidebarWidth,
  useSidebarWidth,
} from '@/web/stores/sidebar-width';
import { SIDEBAR_WIDTHS } from '@/web/theme/tokens';
import classes from './chapter-reader.module.css';

const KEYBOARD_RESIZE_STEP = 16;

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
  /** Summary-header actions (the hosted app's rerun button). */
  actions?: ReactNode;
}

/**
 * Two-column editorial reader: chapters + files on the left, the active
 * section on the right. Owns the keyboard bindings, the resizable sidebar
 * and the `?ch=` / `?file=` URL state (`?file=` wins when both are set; the
 * chapter is what comes back when the file view is closed). Inline diffs read
 * their files from the `FileSource` the caller wraps it in.
 */
export function ChapterReader({ review, meta, initialActiveId, actions }: ChapterReaderProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const sidebarWidth = useSidebarWidth((state) => state.width);
  const setSidebarWidth = useSidebarWidth((state) => state.setWidth);
  useEffect(() => bindSidebarWidth(), []);
  const mainRef = useRef<HTMLElement | null>(null);
  useReportedColumnWidth(mainRef);
  const sections = useMemo(() => readerSections(review), [review]);
  const urlActive = searchParams.get('ch');
  const urlFile = searchParams.get('file');
  const activeFile = urlFile && fileExists(urlFile, review) ? urlFile : null;
  const activeId =
    activeFile === null
      ? urlActive === null
        ? SUMMARY_SECTION_ID
        : (findSection(sections, urlActive)?.id ?? initialActiveId)
      : SUMMARY_SECTION_ID;

  const onSelect = useCallback(
    (id: string) => {
      const next = new URLSearchParams(searchParams);
      next.delete('file');
      if (id === SUMMARY_SECTION_ID) next.delete('ch');
      else next.set('ch', id);
      void setSearchParams(next, { preventScrollReset: true });
    },
    [searchParams, setSearchParams],
  );

  const onSelectFile = useCallback(
    (filename: string) => {
      const next = new URLSearchParams(searchParams);
      next.delete('ch');
      next.set('file', filename);
      void setSearchParams(next, { preventScrollReset: true });
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
       * committed to the store once on release: a width that is still moving
       * has not earned a re-render of every editor in the article, nor a write
       * to localStorage per frame.
       */
      const onPointerMove = (moveEvent: PointerEvent): void => {
        width = clampSidebarWidth(startWidth + moveEvent.clientX - startX);
        applySidebarWidth(width);
      };
      const onPointerUp = (): void => {
        window.removeEventListener('pointermove', onPointerMove);
        setSidebarWidth(width);
      };
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp, { once: true });
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

  const activeChapter = review.chapters.find((ch) => ch.id === activeId) ?? null;
  const activeIndex = review.chapters.findIndex((ch) => ch.id === activeId) + 1;

  return (
    <div className={classes.grid}>
      <aside className={classes.aside}>
        <ChapterSidebar
          sections={sections}
          chapters={review.chapters}
          files={review.files}
          activeId={activeId}
          activeFile={activeFile}
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
          <FileView filename={activeFile} chapters={review.chapters} files={review.files} />
        ) : activeId === RISK_SECTION_ID && review.riskAssessment ? (
          <RiskCard assessment={review.riskAssessment} />
        ) : !activeChapter ? (
          <SummaryCard review={review} meta={meta} actions={actions} onSelectFile={onSelectFile} />
        ) : (
          <ChapterCard
            chapter={activeChapter}
            chapterIndex={activeIndex}
            onSelectFile={onSelectFile}
          />
        )}
      </section>
    </div>
  );
}
