import { VisuallyHidden } from '@mantine/core';
import {
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useSearchParams } from 'react-router';
import type { PullMetadata } from '@/domain/github/types';
import {
  RISK_SECTION_ID,
  SUMMARY_SECTION_ID,
  type NarrativeReview,
} from '@/domain/review/narrative';
import type { ReviewTarget } from '@/domain/review/target';
import { RerunButton } from '@/web/components/jobs/rerun-button';
import { ChapterCard } from '@/web/components/narrative/chapter-card';
import { ChapterSidebar } from '@/web/components/narrative/chapter-sidebar';
import { FileView } from '@/web/components/narrative/file-view';
import { RiskCard } from '@/web/components/narrative/risk-card';
import { findSection, readerSections } from '@/web/components/narrative/sections';
import { SummaryCard } from '@/web/components/narrative/summary-card';
import { useNarrativeKeyboard } from '@/web/components/narrative/use-narrative-keyboard';
import classes from './chapter-reader.module.css';

const DEFAULT_SIDEBAR_WIDTH = 256;
const MIN_SIDEBAR_WIDTH = 208;
const MAX_SIDEBAR_WIDTH = 420;

function clampSidebarWidth(width: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width));
}

function fileExists(filename: string, review: NarrativeReview): boolean {
  if (review.files?.some((f) => f.filename === filename)) return true;
  return review.chapters.some((chapter) =>
    chapter.diffChunks.some((chunk) => chunk.filename === filename),
  );
}

export interface ChapterReaderProps {
  review: NarrativeReview;
  target: ReviewTarget;
  pullMetadata: PullMetadata | null;
  /** Refs the inline diffs compare: the target's base SHA and the reviewed head SHA. */
  baseRef: string;
  headRef: string;
  /** Active section when the URL names none (or an unknown one). */
  initialActiveId: string;
  jobId: string;
  /** Byline for the summary header when GitHub metadata is unavailable. */
  jobAuthor: string;
}

/**
 * Two-column editorial reader: chapters + files on the left, the active
 * section on the right. Owns the keyboard bindings, the resizable sidebar
 * and the `?ch=` / `?file=` URL state (`?file=` wins when both are set; the
 * chapter is what comes back when the file view is closed).
 */
export function ChapterReader({
  review,
  target,
  pullMetadata,
  baseRef,
  headRef,
  initialActiveId,
  jobId,
  jobAuthor,
}: ChapterReaderProps) {
  const refs = { owner: target.owner, repo: target.repo, baseRef, headRef };
  const [searchParams, setSearchParams] = useSearchParams();
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
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
      const onPointerMove = (moveEvent: PointerEvent): void => {
        setSidebarWidth(clampSidebarWidth(startWidth + moveEvent.clientX - startX));
      };
      const onPointerUp = (): void => {
        window.removeEventListener('pointermove', onPointerMove);
      };
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp, { once: true });
    },
    [sidebarWidth],
  );

  const onResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    setSidebarWidth((current) => clampSidebarWidth(current + direction * 16));
  }, []);

  const activeChapter = review.chapters.find((ch) => ch.id === activeId) ?? null;
  const activeIndex = review.chapters.findIndex((ch) => ch.id === activeId) + 1;

  return (
    <div
      className={classes.grid}
      style={{ '--review-sidebar-width': `${sidebarWidth}px` } as CSSProperties}
    >
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
          aria-valuemin={MIN_SIDEBAR_WIDTH}
          aria-valuemax={MAX_SIDEBAR_WIDTH}
          aria-valuenow={sidebarWidth}
          onPointerDown={onResizePointerDown}
          onKeyDown={onResizeKeyDown}
          className={classes.handle}
        >
          <VisuallyHidden>Resize review navigation</VisuallyHidden>
        </button>
      </aside>

      <section aria-live="polite" className={classes.main}>
        {activeFile ? (
          <FileView
            filename={activeFile}
            chapters={review.chapters}
            files={review.files}
            {...refs}
          />
        ) : activeId === RISK_SECTION_ID && review.riskAssessment ? (
          <RiskCard assessment={review.riskAssessment} />
        ) : !activeChapter ? (
          <SummaryCard
            review={review}
            target={target}
            pullMetadata={pullMetadata}
            byline={{ author: jobAuthor }}
            actions={<RerunButton jobId={jobId} />}
            onSelectFile={onSelectFile}
          />
        ) : (
          <ChapterCard
            chapter={activeChapter}
            chapterIndex={activeIndex}
            onSelectFile={onSelectFile}
            {...refs}
          />
        )}
      </section>
    </div>
  );
}
