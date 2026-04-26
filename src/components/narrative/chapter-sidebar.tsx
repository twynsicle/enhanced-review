'use client';

import { SUMMARY_SECTION_ID, type NarrativeChapter } from '@enhanced-review/review-types';

interface ChapterSidebarProps {
  chapters: readonly NarrativeChapter[];
  activeId: string;
  /**
   * Click handler for a chapter / summary entry. The page wires this to
   * a URL update — sidebar items are buttons, not links, because the
   * URL strategy lives a layer up.
   */
  onSelect: (id: string) => void;
  reviewTitle: string;
}

/**
 * Sticky vertical chapter list. Replaces the POC's combination of
 * `ChapterNav` (sidebar) + `ChapterNavBar` (top Prev/Next) — Phase 6
 * settled on sidebar-only navigation.
 */
export function ChapterSidebar({
  chapters,
  activeId,
  onSelect,
  reviewTitle,
}: ChapterSidebarProps) {
  return (
    <nav
      aria-label="Chapters"
      className="sticky top-6 flex max-h-[calc(100vh-3rem)] flex-col gap-1 overflow-y-auto pr-2 text-sm"
    >
      <SidebarItem
        id={SUMMARY_SECTION_ID}
        label="Summary"
        sublabel={reviewTitle}
        active={activeId === SUMMARY_SECTION_ID}
        index={null}
        onSelect={onSelect}
      />
      <div className="my-2 border-t border-foreground/10" aria-hidden />
      {chapters.map((ch, i) => (
        <SidebarItem
          key={ch.id}
          id={ch.id}
          label={ch.title}
          sublabel={null}
          active={ch.id === activeId}
          index={i + 1}
          onSelect={onSelect}
        />
      ))}
    </nav>
  );
}

function SidebarItem({
  id,
  label,
  sublabel,
  active,
  index,
  onSelect,
}: {
  id: string;
  label: string;
  sublabel: string | null;
  active: boolean;
  index: number | null;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? 'true' : undefined}
      onClick={() => onSelect(id)}
      className={
        'group flex flex-col items-start gap-0.5 rounded-md px-2.5 py-1.5 text-left transition-colors ' +
        (active
          ? 'bg-primary/15 text-primary ring-1 ring-primary/30'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground')
      }
    >
      <span className="flex w-full items-baseline gap-2">
        {index !== null && (
          <span
            className={
              'shrink-0 font-mono text-[10px] tabular-nums ' +
              (active ? 'text-primary/70' : 'text-muted-foreground/70')
            }
          >
            {String(index).padStart(2, '0')}
          </span>
        )}
        <span className="line-clamp-2 grow text-sm leading-snug">{label}</span>
      </span>
      {sublabel && (
        <span className="ml-[1.7rem] line-clamp-1 text-[11px] text-muted-foreground/70">
          {sublabel}
        </span>
      )}
    </button>
  );
}
