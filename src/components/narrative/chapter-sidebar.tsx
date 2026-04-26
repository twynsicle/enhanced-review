'use client';

import {
  SUMMARY_SECTION_ID,
  type NarrativeChapter,
  type ReviewFile,
  type ReviewRiskAssessment,
} from '@enhanced-review/review-types';
import { cn } from '@/lib/utils';
import { RiskScorePill } from './risk-score';

interface ChapterSidebarProps {
  chapters: readonly NarrativeChapter[];
  activeId: string;
  /**
   * Click handler for a chapter / summary entry. The page wires this to
   * a URL update - sidebar items are buttons, not links, because the
   * URL strategy lives a layer up.
   */
  onSelect: (id: string) => void;
  reviewTitle: string;
  files?: readonly ReviewFile[];
  riskAssessment?: ReviewRiskAssessment;
}

/**
 * Editorial navigation. Chapter links sit first; a compact changed-file
 * tree follows so readers can jump by file when the narrative is not the
 * path they want.
 */
export function ChapterSidebar({
  chapters,
  activeId,
  onSelect,
  files,
  riskAssessment,
}: ChapterSidebarProps) {
  const reviewFiles = buildReviewFiles(chapters, files);
  const chapterByFile = buildChapterByFile(chapters);

  return (
    <nav
      aria-label="Review navigation"
      className="sticky top-20 flex max-h-[calc(100vh-6rem)] flex-col gap-4 overflow-x-hidden overflow-y-auto pt-1 pr-3"
    >
      {riskAssessment && (
        <button
          type="button"
          onClick={() => {
            onSelect(SUMMARY_SECTION_ID);
          }}
          className={cn(
            'flex w-full flex-col gap-2 rounded-lg border p-3 text-left transition-colors',
            activeId === SUMMARY_SECTION_ID
              ? 'border-iris/35 bg-iris-soft'
              : 'border-border bg-card/70 hover:bg-muted/40',
          )}
        >
          <span className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-subtle">
            Review risk
          </span>
          <RiskScorePill score={riskAssessment.score} />
          <span className="line-clamp-2 text-[12px] leading-[1.4] text-muted-foreground">
            {riskAssessment.summary}
          </span>
        </button>
      )}

      <section className="flex flex-col gap-3">
        <p className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-subtle">
          Chapters
        </p>
        <ul className="flex flex-col gap-2">
          <SidebarItem
            id={SUMMARY_SECTION_ID}
            label="Summary"
            sublabel={null}
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
      </section>

      {reviewFiles.length > 0 && (
        <section className="mt-3 flex flex-col gap-3 border-t border-border pt-4">
          <p className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-subtle">Files</p>
          <FileTree
            files={reviewFiles}
            chapterByFile={chapterByFile}
            activeId={activeId}
            onSelect={onSelect}
          />
        </section>
      )}
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
            'min-w-0 font-serif text-[14px] leading-[1.35]',
            active
              ? 'border-l-2 border-iris pl-2 font-semibold text-foreground'
              : 'border-l-2 border-transparent pl-2 text-muted-foreground',
          )}
        >
          <span className="block truncate">{label}</span>
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

function buildReviewFiles(
  chapters: readonly NarrativeChapter[],
  files?: readonly ReviewFile[],
): ReviewFile[] {
  if (files && files.length > 0) return [...files].sort(compareFilename);

  const byFilename = new Map<string, ReviewFile>();
  for (const chapter of chapters) {
    for (const chunk of chapter.diffChunks) {
      if (!byFilename.has(chunk.filename)) {
        byFilename.set(chunk.filename, {
          filename: chunk.filename,
          status: 'modified',
          additions: 0,
          deletions: 0,
        });
      }
    }
  }
  return [...byFilename.values()].sort(compareFilename);
}

function buildChapterByFile(chapters: readonly NarrativeChapter[]): Map<string, string> {
  const byFilename = new Map<string, string>();
  for (const chapter of chapters) {
    for (const chunk of chapter.diffChunks) {
      if (!byFilename.has(chunk.filename)) byFilename.set(chunk.filename, chapter.id);
    }
  }
  return byFilename;
}

function compareFilename(a: ReviewFile, b: ReviewFile): number {
  return a.filename.localeCompare(b.filename);
}

function FileTree({
  files,
  chapterByFile,
  activeId,
  onSelect,
}: {
  files: readonly ReviewFile[];
  chapterByFile: Map<string, string>;
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-1.5">
      {files.map((file) => {
        const chapterId = chapterByFile.get(file.filename);
        const active = chapterId === activeId;
        return (
          <li key={file.filename}>
            <button
              type="button"
              disabled={!chapterId}
              onClick={() => {
                if (chapterId) onSelect(chapterId);
              }}
              className={cn(
                'grid w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-2 rounded-md px-1.5 py-1 text-left transition-colors',
                active
                  ? 'bg-iris-soft text-foreground'
                  : chapterId
                    ? 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                    : 'cursor-default text-subtle',
              )}
            >
              <span className={cn('mt-0.5 font-mono text-[10px]', statusTone(file.status))}>
                {statusLabel(file.status)}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-mono text-[11.5px] leading-5">
                  {file.filename}
                </span>
                {(file.additions > 0 || file.deletions > 0) && (
                  <span className="block font-mono text-[10.5px] text-subtle">
                    <span className="text-add">+{file.additions.toString()}</span>{' '}
                    <span className="text-del">-{file.deletions.toString()}</span>
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function statusLabel(status: ReviewFile['status']): string {
  switch (status) {
    case 'added':
      return 'A';
    case 'removed':
      return 'D';
    case 'renamed':
      return 'R';
    case 'copied':
      return 'C';
    default:
      return 'M';
  }
}

function statusTone(status: ReviewFile['status']): string {
  if (status === 'added' || status === 'copied') return 'text-add';
  if (status === 'removed') return 'text-del';
  if (status === 'renamed') return 'text-sky-600 dark:text-sky-300';
  return 'text-iris';
}
