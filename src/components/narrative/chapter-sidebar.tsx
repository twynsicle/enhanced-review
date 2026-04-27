'use client';

import {
  SUMMARY_SECTION_ID,
  type NarrativeChapter,
  type ReviewFile,
  type ReviewRiskAssessment,
} from '@enhanced-review/review-types';
import { cn } from '@/lib/utils';
import { RiskInlineLabel, RiskScoreBars } from './risk-score';

interface ChapterSidebarProps {
  chapters: readonly NarrativeChapter[];
  activeId: string;
  /** Filename currently shown in the file-only view, or null. */
  activeFile?: string | null;
  /**
   * Click handler for a chapter / summary entry. The page wires this to
   * a URL update - sidebar items are buttons, not links, because the
   * URL strategy lives a layer up.
   */
  onSelect: (id: string) => void;
  /** Click handler for a file row — opens the file-only diff view. */
  onSelectFile: (filename: string) => void;
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
  activeFile = null,
  onSelect,
  onSelectFile,
  files,
  riskAssessment,
}: ChapterSidebarProps) {
  const reviewFiles = buildReviewFiles(chapters, files);

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
            'group flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors',
            activeId === SUMMARY_SECTION_ID
              ? 'border-iris/35 bg-iris-soft'
              : 'border-border bg-card/70 hover:bg-muted/40',
          )}
          aria-label={`Risk ${String(riskAssessment.score)} of 5 — open the review summary`}
        >
          <RiskScoreBars score={riskAssessment.score} size="lg" hideLabel />
          <span className="flex min-w-0 flex-col">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-subtle">
              Risk
            </span>
            <RiskInlineLabel score={riskAssessment.score} />
          </span>
          <span
            aria-hidden
            className="ml-auto text-[14px] text-subtle transition-transform group-hover:translate-x-0.5"
          >
            ›
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
          <FilesHeader files={reviewFiles} />
          <FileTree files={reviewFiles} activeFile={activeFile} onSelectFile={onSelectFile} />
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
            'min-w-0 text-[13px] leading-[1.35]',
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

function compareFilename(a: ReviewFile, b: ReviewFile): number {
  return a.filename.localeCompare(b.filename);
}

function FilesHeader({ files }: { files: readonly ReviewFile[] }) {
  let additions = 0;
  let deletions = 0;
  for (const file of files) {
    additions += file.additions;
    deletions += file.deletions;
  }
  const showStats = additions > 0 || deletions > 0;

  // px-1.5 mirrors the FileTree button padding so the stats span's right
  // edge sits in the same column as the per-row stats below.
  return (
    <div className="flex items-baseline justify-between gap-2 px-1.5">
      <p className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-subtle">Files</p>
      {showStats && (
        <span className="font-mono text-[10.5px] text-subtle">
          <span className="text-add">+{additions.toString()}</span>{' '}
          <span className="text-del">-{deletions.toString()}</span>
        </span>
      )}
    </div>
  );
}

function splitFilename(path: string): { dirname: string; basename: string } {
  const slash = path.lastIndexOf('/');
  if (slash === -1) return { dirname: '', basename: path };
  return { dirname: path.slice(0, slash), basename: path.slice(slash + 1) };
}

function FileTree({
  files,
  activeFile,
  onSelectFile,
}: {
  files: readonly ReviewFile[];
  activeFile: string | null;
  onSelectFile: (filename: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-1">
      {files.map((file) => {
        const active = file.filename === activeFile;
        const { dirname, basename } = splitFilename(file.filename);
        const showStats = file.additions > 0 || file.deletions > 0;
        return (
          <li key={file.filename}>
            <button
              type="button"
              aria-current={active ? 'true' : undefined}
              onClick={() => {
                onSelectFile(file.filename);
              }}
              className={cn(
                'relative grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 overflow-hidden rounded-md px-1.5 py-1.5 text-left transition-colors',
                active
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
              )}
            >
              {active && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 bg-gradient-to-r from-iris/22 via-iris/6 via-8% to-transparent to-22%"
                />
              )}
              <span
                className={cn('relative mt-0.5 font-mono text-[10px]', statusTone(file.status))}
              >
                {statusLabel(file.status)}
              </span>
              <span className="relative min-w-0">
                <span className="block truncate font-mono text-[12px] leading-[1.3] text-foreground">
                  {basename}
                </span>
                {dirname.length > 0 && (
                  <span className="block truncate font-mono text-[10.5px] leading-[1.3] text-subtle">
                    {dirname}/
                  </span>
                )}
              </span>
              {showStats ? (
                <span className="relative mt-0.5 font-mono text-[10.5px] text-subtle">
                  <span className="text-add">+{file.additions.toString()}</span>{' '}
                  <span className="text-del">-{file.deletions.toString()}</span>
                </span>
              ) : (
                <span aria-hidden />
              )}
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
  if (status === 'added' || status === 'copied') return 'text-after';
  if (status === 'removed') return 'text-risk';
  if (status === 'renamed') return 'text-suggestion';
  return 'text-before';
}
