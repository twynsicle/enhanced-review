'use client';

import {
  useCallback,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SUMMARY_SECTION_ID, type NarrativeReview } from '@enhanced-review/review-types';
import type { ReviewTarget } from '@enhanced-review/github-client';
import type { PullMetadata } from '@/lib/github/view-time';
import { ChapterCard } from '@/components/narrative/chapter-card';
import { ChapterSidebar } from '@/components/narrative/chapter-sidebar';
import { SummaryCard } from '@/components/narrative/summary-card';
import { useNarrativeKeyboard } from '@/components/narrative/use-narrative-keyboard';
import { RerunButton } from './rerun-button';

const DEFAULT_SIDEBAR_WIDTH = 256;
const MIN_SIDEBAR_WIDTH = 208;
const MAX_SIDEBAR_WIDTH = 420;

interface ChapterReaderProps {
  review: NarrativeReview;
  target: ReviewTarget;
  pullMetadata: PullMetadata | null;
  owner: string;
  repo: string;
  baseRef: string;
  headRef: string;
  initialActiveId: string;
  /** Identity for the editorial header — author + sha shown in the byline. */
  jobId: string;
  jobAuthor: string;
  jobHeadSha: string;
}

/**
 * Two-column editorial reader: chapters + files on the left, and the
 * active chapter article in the main column.
 *
 * Owns keyboard nav and the `?ch=` URL state.
 */
export function ChapterReader({
  review,
  target,
  pullMetadata,
  owner,
  repo,
  baseRef,
  headRef,
  initialActiveId,
  jobId,
  jobAuthor,
  jobHeadSha,
}: ChapterReaderProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const urlActive = searchParams.get('ch');
  const activeId = isKnownId(urlActive, review.chapters)
    ? (urlActive ?? SUMMARY_SECTION_ID)
    : initialActiveId;

  const onSelect = useCallback(
    (id: string) => {
      const next = new URLSearchParams(searchParams.toString());
      if (id === SUMMARY_SECTION_ID) {
        next.delete('ch');
      } else {
        next.set('ch', id);
      }
      const queryString = next.toString();
      router.push(queryString.length === 0 ? '?' : `?${queryString}`, { scroll: false });
    },
    [router, searchParams],
  );

  useNarrativeKeyboard({ chapters: review.chapters, activeId, onSelect });

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
        window.removeEventListener('pointerup', onPointerUp);
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
  const isSummary = activeId === SUMMARY_SECTION_ID;
  const activeIndex = isSummary ? 0 : review.chapters.findIndex((ch) => ch.id === activeId) + 1;

  return (
    <div
      className="grid gap-10 lg:grid-cols-[var(--review-sidebar-width)_minmax(0,1fr)]"
      style={{ '--review-sidebar-width': `${sidebarWidth.toString()}px` } as CSSProperties}
    >
      <aside className="relative hidden min-w-0 lg:block">
        <ChapterSidebar
          chapters={review.chapters}
          files={review.files}
          activeId={activeId}
          reviewTitle={review.prTitle}
          riskAssessment={review.riskAssessment}
          onSelect={onSelect}
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
          className="absolute top-0 -right-5 h-full w-3 cursor-col-resize rounded-full transition-colors hover:bg-iris/15 focus-visible:bg-iris/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/50"
        >
          <span className="sr-only">Resize review navigation</span>
        </button>
      </aside>

      <section aria-live="polite" className="min-w-0">
        {isSummary || !activeChapter ? (
          <SummaryCard
            review={review}
            target={target}
            pullMetadata={pullMetadata}
            byline={{ author: jobAuthor, sha: jobHeadSha }}
            actions={<RerunButton jobId={jobId} />}
          />
        ) : (
          <ChapterCard
            chapter={activeChapter}
            chapterIndex={activeIndex}
            owner={owner}
            repo={repo}
            baseRef={baseRef}
            headRef={headRef}
          />
        )}
      </section>
    </div>
  );
}

function clampSidebarWidth(width: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width));
}

function isKnownId(raw: string | null, chapters: NarrativeReview['chapters']): boolean {
  if (raw === null) return true;
  if (raw === SUMMARY_SECTION_ID) return true;
  return chapters.some((ch) => ch.id === raw);
}
