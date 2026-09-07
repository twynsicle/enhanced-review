'use client';

import type { NarrativeChapter } from '@enhanced-review/review-types';
import { cn } from '@/lib/utils';

interface ChapterPageRailProps {
  chapters: readonly NarrativeChapter[];
  activeId: string;
  /** 0 when summary is active, otherwise 1-based chapter index. */
  activeIndex: number;
  chapter: NarrativeChapter | null;
  isSummary: boolean;
}

/**
 * Right-rail "on this page" navigation. Lists in-chapter anchors —
 * insights and diff figures — with a small chapter-progress indicator
 * underneath. Hidden on narrow viewports.
 */
export function ChapterPageRail({
  chapters,
  activeId,
  activeIndex,
  chapter,
  isSummary,
}: ChapterPageRailProps) {
  const total = chapters.length;
  const progress = total === 0 ? 0 : Math.min(1, activeIndex / total);

  return (
    <nav
      aria-label="On this page"
      className="sticky top-20 flex max-h-[calc(100vh-6rem)] flex-col gap-4 pt-1 text-[12px]"
    >
      <p className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-subtle">
        On this page
      </p>
      <ul className="flex flex-col gap-1.5">
        <li
          className={cn(
            'truncate',
            isSummary ? 'font-semibold text-iris' : 'text-muted-foreground',
          )}
        >
          Summary
        </li>
        {!isSummary && chapter && (
          <>
            <li className="truncate font-semibold text-iris">{chapter.title}</li>
            {chapter.insights.map((ins, i) => (
              <li key={`ins-${i.toString()}`} className="truncate pl-3 text-muted-foreground">
                {labelForInsightType(ins.type)}
              </li>
            ))}
            {chapter.diffChunks.map((c, i) => (
              <li key={`diff-${i.toString()}`} className="truncate pl-3 text-muted-foreground">
                Diff: {c.filename.split('/').pop() ?? c.filename}
              </li>
            ))}
          </>
        )}
      </ul>

      {total > 0 && (
        <div className="mt-2 flex flex-col gap-1.5">
          <p className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-subtle">
            Progress
          </p>
          <div
            role="progressbar"
            aria-valuenow={Math.round(progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-1 overflow-hidden rounded-full bg-border"
          >
            <div
              className="h-full bg-iris transition-[width]"
              style={{ width: `${(progress * 100).toFixed(0)}%` }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            {isSummary ? 'Summary' : `Chapter ${activeIndex.toString()} of ${total.toString()}`}
          </p>
        </div>
      )}

      <div className="sr-only" aria-hidden>
        {/* keep activeId in DOM so SSR + client agree about the active row */}
        {activeId}
      </div>
    </nav>
  );
}

function labelForInsightType(type: NarrativeChapter['insights'][number]['type']): string {
  switch (type) {
    case 'context':
      return 'Context';
    case 'rationale':
      return 'Rationale';
    case 'highlight':
      return 'Highlight';
    case 'reference':
      return 'Reference';
    default:
      return 'Insight';
  }
}
