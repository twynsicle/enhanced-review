'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SUMMARY_SECTION_ID, type NarrativeReview } from '@enhanced-review/review-types';
import type { ReviewTarget } from '@enhanced-review/github-client';
import type { PullMetadata } from '@/lib/github/view-time';
import { ChapterCard } from '@/components/narrative/chapter-card';
import { ChapterPageRail } from '@/components/narrative/chapter-page-rail';
import { ChapterSidebar } from '@/components/narrative/chapter-sidebar';
import { SummaryCard } from '@/components/narrative/summary-card';
import { useNarrativeKeyboard } from '@/components/narrative/use-narrative-keyboard';
import { RerunButton } from './rerun-button';

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
 * Three-column editorial reader: chapters TOC on the left, the active
 * chapter article in the centre, and an "on this page" rail on the right
 * that lists the active chapter's insights + diff figures with a
 * progress bar.
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

  const activeChapter = review.chapters.find((ch) => ch.id === activeId) ?? null;
  const isSummary = activeId === SUMMARY_SECTION_ID;
  const activeIndex = isSummary ? 0 : review.chapters.findIndex((ch) => ch.id === activeId) + 1;

  return (
    <div className="grid gap-10 lg:grid-cols-[14rem_minmax(0,1fr)_12rem]">
      <aside className="hidden lg:block">
        <ChapterSidebar
          chapters={review.chapters}
          activeId={activeId}
          reviewTitle={review.prTitle}
          onSelect={onSelect}
        />
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

      <aside className="hidden lg:block">
        <ChapterPageRail
          chapters={review.chapters}
          activeId={activeId}
          activeIndex={activeIndex}
          chapter={activeChapter}
          isSummary={isSummary}
        />
      </aside>
    </div>
  );
}

function isKnownId(raw: string | null, chapters: NarrativeReview['chapters']): boolean {
  if (raw === null) return true;
  if (raw === SUMMARY_SECTION_ID) return true;
  return chapters.some((ch) => ch.id === raw);
}
