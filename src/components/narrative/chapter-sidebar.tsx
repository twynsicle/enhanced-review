'use client';

import { SUMMARY_SECTION_ID, type NarrativeChapter } from '@enhanced-review/review-types';
import { cn } from '@/lib/utils';

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
 * Editorial chapter list. Mono-faced index column on the left, serif
 * chapter title on the right, iris-coloured border-left on the active
 * row.
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
      className="sticky top-20 flex max-h-[calc(100vh-6rem)] flex-col gap-4 overflow-y-auto pt-1 pr-2"
    >
      <p className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-subtle">
        Chapters
      </p>
      <ul className="flex flex-col gap-2">
        <SidebarItem
          id={SUMMARY_SECTION_ID}
          label="Summary"
          sublabel={reviewTitle}
          active={activeId === SUMMARY_SECTION_ID}
          index={null}
          onSelect={onSelect}
        />
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
      </ul>
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
    <li>
      <button
        type="button"
        aria-current={active ? 'true' : undefined}
        onClick={() => {
          onSelect(id);
        }}
        className="flex w-full items-baseline gap-2.5 text-left"
      >
        <span
          className={cn(
            'shrink-0 pt-1 font-mono text-[10px] tabular-nums',
            active ? 'text-iris' : 'text-subtle',
          )}
        >
          {index === null ? '00' : index.toString().padStart(2, '0')}
        </span>
        <span
          className={cn(
            'font-serif text-[14px] leading-[1.35]',
            active
              ? 'border-l-2 border-iris pl-2 font-semibold text-foreground'
              : 'border-l-2 border-transparent pl-2 text-muted-foreground',
          )}
        >
          {label}
          {sublabel && (
            <span className="mt-0.5 block truncate text-[11px] font-normal text-subtle">
              {sublabel}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}
