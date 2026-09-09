import { Box, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import {
  SUMMARY_SECTION_ID,
  type NarrativeChapter,
  type ReviewFile,
  type ReviewRiskAssessment,
} from '@/domain/review/narrative';
import { RiskInlineLabel, RiskScoreBars } from '@/web/components/narrative/risk-score';
import { token } from '@/web/theme/tokens';
import classes from './chapter-sidebar.module.css';

const CAPTION = { fz: 10.5, fw: 500, tt: 'uppercase', style: { letterSpacing: '0.18em' } } as const;

interface ChapterSidebarProps {
  chapters: readonly NarrativeChapter[];
  activeId: string;
  /** Filename currently shown in the file-only view, or null. */
  activeFile?: string | null;
  /** Sidebar entries are buttons, not links: the URL strategy lives a layer up. */
  onSelect: (id: string) => void;
  onSelectFile: (filename: string) => void;
  reviewTitle: string;
  files?: readonly ReviewFile[];
  riskAssessment?: ReviewRiskAssessment;
}

/**
 * Editorial navigation. Chapter links sit first; a compact changed-file tree
 * follows so readers can jump by file when the narrative is not the path
 * they want. `reviewTitle` is accepted for parity with the page but not shown.
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
    <nav aria-label="Review navigation" className={classes.nav}>
      {riskAssessment && (
        <UnstyledButton
          className={classes.riskCard}
          data-active={activeId === SUMMARY_SECTION_ID || undefined}
          onClick={() => onSelect(SUMMARY_SECTION_ID)}
          aria-label={`Risk ${riskAssessment.score} of 5 — open the review summary`}
        >
          <RiskScoreBars score={riskAssessment.score} size="lg" hideLabel />
          <Stack gap={0} miw={0}>
            <Text component="span" {...CAPTION} fw={600} c={token('subtle')}>
              Risk
            </Text>
            <RiskInlineLabel score={riskAssessment.score} />
          </Stack>
          <span aria-hidden className={classes.chevron}>
            ›
          </span>
        </UnstyledButton>
      )}

      <Stack component="section" gap={12}>
        <Text {...CAPTION} c={token('subtle')}>
          Chapters
        </Text>
        <ul className={classes.list}>
          <SidebarItem
            id={SUMMARY_SECTION_ID}
            label="Summary"
            active={activeId === SUMMARY_SECTION_ID}
            index={null}
            onSelect={onSelect}
          />
          {chapters.map((ch, i) => (
            <SidebarItem
              key={ch.id}
              id={ch.id}
              label={ch.title}
              active={ch.id === activeId}
              index={i + 1}
              onSelect={onSelect}
            />
          ))}
        </ul>
      </Stack>

      {reviewFiles.length > 0 && (
        <section className={classes.files}>
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
  active,
  index,
  onSelect,
}: {
  id: string;
  label: string;
  active: boolean;
  index: number | null;
  onSelect: (id: string) => void;
}) {
  return (
    <li>
      <UnstyledButton
        className={classes.item}
        aria-current={active ? 'true' : undefined}
        data-active={active || undefined}
        onClick={() => onSelect(id)}
      >
        <span className={classes.index}>
          {index === null ? '00' : index.toString().padStart(2, '0')}
        </span>
        <span className={classes.label}>{label}</span>
      </UnstyledButton>
    </li>
  );
}

function compareFilename(a: ReviewFile, b: ReviewFile): number {
  return a.filename.localeCompare(b.filename);
}

/** The review's `files[]` when present; otherwise every file a chapter selected hunks from. */
function buildReviewFiles(
  chapters: readonly NarrativeChapter[],
  files?: readonly ReviewFile[],
): ReviewFile[] {
  if (files && files.length > 0) return files.toSorted(compareFilename);

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
  return [...byFilename.values()].toSorted(compareFilename);
}

function Stats({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className={classes.stats}>
      <span className={classes.add}>+{additions}</span>{' '}
      <span className={classes.del}>-{deletions}</span>
    </span>
  );
}

function FilesHeader({ files }: { files: readonly ReviewFile[] }) {
  let additions = 0;
  let deletions = 0;
  for (const file of files) {
    additions += file.additions;
    deletions += file.deletions;
  }
  // px 6 mirrors the row padding so the totals line up with the per-row stats.
  return (
    <Group justify="space-between" align="baseline" gap={8} px={6}>
      <Text {...CAPTION} c={token('subtle')}>
        Files
      </Text>
      {(additions > 0 || deletions > 0) && <Stats additions={additions} deletions={deletions} />}
    </Group>
  );
}

function splitFilename(path: string): { dirname: string; basename: string } {
  const slash = path.lastIndexOf('/');
  if (slash === -1) return { dirname: '', basename: path };
  return { dirname: path.slice(0, slash), basename: path.slice(slash + 1) };
}

const STATUS_LETTER: Record<ReviewFile['status'], string> = {
  added: 'A',
  removed: 'D',
  renamed: 'R',
  copied: 'C',
  modified: 'M',
  unchanged: 'M',
};

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
    <ul className={classes.fileList}>
      {files.map((file) => {
        const active = file.filename === activeFile;
        const { dirname, basename } = splitFilename(file.filename);
        const showStats = file.additions > 0 || file.deletions > 0;
        return (
          <li key={file.filename}>
            <UnstyledButton
              className={classes.fileRow}
              aria-current={active ? 'true' : undefined}
              data-active={active || undefined}
              onClick={() => onSelectFile(file.filename)}
            >
              <span className={classes.status} data-status={file.status}>
                {STATUS_LETTER[file.status]}
              </span>
              <Box component="span" miw={0}>
                <span className={classes.basename}>{basename}</span>
                {dirname.length > 0 && <span className={classes.dirname}>{dirname}/</span>}
              </Box>
              {showStats ? (
                <Stats additions={file.additions} deletions={file.deletions} />
              ) : (
                <span aria-hidden />
              )}
            </UnstyledButton>
          </li>
        );
      })}
    </ul>
  );
}
