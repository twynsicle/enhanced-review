'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SUMMARY_SECTION_ID, type NarrativeReview } from '@enhanced-review/review-types';
import type { ReviewTarget } from '@enhanced-review/github-client';
import type { PullMetadata } from '@/lib/github/view-time';
import { ChapterCard } from '@/components/narrative/chapter-card';
import { ChapterSidebar } from '@/components/narrative/chapter-sidebar';
import { SummaryCard } from '@/components/narrative/summary-card';
import { useNarrativeKeyboard } from '@/components/narrative/use-narrative-keyboard';

interface ChapterReaderProps {
  review: NarrativeReview;
  target: ReviewTarget;
  pullMetadata: PullMetadata | null;
  owner: string;
  repo: string;
  baseRef: string;
  headRef: string;
  initialActiveId: string;
}

/**
 * Client wrapper around the sidebar + active chapter content. Owns
 * keyboard navigation and `?ch=` URL state. The active id starts from
 * the server-resolved `initialActiveId`; subsequent client-side
 * navigations replace `?ch=` via the App Router.
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
}: ChapterReaderProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Read from the URL but fall back to the SSR-derived initial id so the
  // first paint is correct on a fresh navigation.
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

  return (
    <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="hidden lg:block">
        <ChapterSidebar
          chapters={review.chapters}
          activeId={activeId}
          reviewTitle={review.prTitle}
          onSelect={onSelect}
        />
      </aside>

      <section
        aria-live="polite"
        className="min-w-0 rounded-lg ring-1 ring-foreground/10 bg-card p-6"
      >
        {isSummary || !activeChapter ? (
          <SummaryCard review={review} target={target} pullMetadata={pullMetadata} />
        ) : (
          <ChapterCard
            chapter={activeChapter}
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

function isKnownId(
  raw: string | null,
  chapters: NarrativeReview['chapters'],
): boolean {
  if (raw === null) return true; // null = summary, always valid
  if (raw === SUMMARY_SECTION_ID) return true;
  return chapters.some((ch) => ch.id === raw);
}
