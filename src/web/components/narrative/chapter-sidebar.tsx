import { ActionIcon, Box, Group, Stack, UnstyledButton, VisuallyHidden } from '@mantine/core';
import { IconList, IconListTree } from '@tabler/icons-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  RISK_SECTION_ID,
  type NarrativeChapter,
  type ReviewFile,
  type ReviewRiskAssessment,
} from '@/domain/review/narrative';
import { Caption } from '@/web/components/caption';
import {
  buildFileTree,
  type FileTreeDirectory,
  type FileTreeNode,
} from '@/web/components/narrative/file-tree';
import { RiskInlineLabel, RiskScoreBars } from '@/web/components/narrative/risk-score';
import type { ReaderSection } from '@/web/components/narrative/sections';
import { SKIP_REASON_LABEL } from '@/web/components/narrative/skipped-file';
import { bindFileListView, useFileListView } from '@/web/stores/file-list-view';
import classes from './chapter-sidebar.module.css';

interface ChapterSidebarProps {
  /** Every section of the reader, in order; see `sections.ts`. */
  sections: readonly ReaderSection[];
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
 * Editorial navigation. Section links sit first; a compact changed-file list
 * follows so readers can jump by file when the narrative is not the path
 * they want. `reviewTitle` is accepted for parity with the page but not shown.
 *
 * The risk card is the risk section's entry. It is not repeated as a row in
 * the list below, because two controls that go to one place make a list the
 * reader has to read twice to be sure.
 */
export function ChapterSidebar({
  sections,
  chapters,
  activeId,
  activeFile = null,
  onSelect,
  onSelectFile,
  files,
  riskAssessment,
}: ChapterSidebarProps) {
  // Held by identity, not for the sort alone: the tree below is memoised on
  // this array, and a fresh one each render would rebuild the tree on every
  // pointer event the sidebar's drag handle fires.
  const reviewFiles = useMemo(() => buildReviewFiles(chapters, files), [chapters, files]);
  const rows = sections.filter((section) => section.kind !== 'risk');

  return (
    <nav aria-label="Review navigation" className={classes.nav}>
      {riskAssessment && (
        <UnstyledButton
          className={classes.riskCard}
          data-active={activeId === RISK_SECTION_ID || undefined}
          onClick={() => onSelect(RISK_SECTION_ID)}
          aria-label={`Risk ${riskAssessment.score} of 5 — open the risk assessment`}
        >
          <RiskScoreBars score={riskAssessment.score} size="lg" hideLabel />
          <Stack gap={0} miw={0}>
            <Caption>Risk</Caption>
            <RiskInlineLabel score={riskAssessment.score} />
          </Stack>
          <span aria-hidden className={classes.chevron}>
            ›
          </span>
        </UnstyledButton>
      )}

      <Stack component="section" gap={12}>
        <Caption>Chapters</Caption>
        <ul className={classes.list}>
          {rows.map((section) => (
            <SidebarItem
              key={section.id}
              section={section}
              active={section.id === activeId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      </Stack>

      {reviewFiles.length > 0 && (
        <section className={classes.files}>
          <FilesHeader files={reviewFiles} />
          <FileList files={reviewFiles} activeFile={activeFile} onSelectFile={onSelectFile} />
        </section>
      )}
    </nav>
  );
}

function SidebarItem({
  section,
  active,
  onSelect,
}: {
  section: ReaderSection;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const { chapterNumber, hasDiagram } = section;
  return (
    <li>
      <UnstyledButton
        className={classes.item}
        aria-current={active ? 'true' : undefined}
        data-active={active || undefined}
        onClick={() => onSelect(section.id)}
      >
        <span className={classes.index}>
          {chapterNumber === null ? '00' : chapterNumber.toString().padStart(2, '0')}
        </span>
        <span className={classes.label}>{section.label}</span>
        {/*
         * Which sections carry a picture, marked on the list the reader
         * already scans. A separate "Diagrams" block was the alternative, but
         * a diagram is not addressable apart from its section — both entries
         * would navigate to the same place, and the sidebar would grow a
         * fourth list to say what one glyph says here.
         */}
        {hasDiagram && (
          <span className={classes.diagramMark} aria-label="has a diagram">
            ◧
          </span>
        )}
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

/**
 * Flat list ⇄ directory tree, for the file list alone. It sits in this header
 * rather than beside the reader's other preferences in the topbar because it
 * governs one section of one column: a control in the topbar reads as a claim
 * over the whole reader, and the reader would go looking for what it did to
 * the article. Rehydrated here on mount, as the topbar toggles are from
 * theirs, and the icon names the current state rather than the action.
 */
function FileListViewToggle() {
  const view = useFileListView((s) => s.view);
  const toggle = useFileListView((s) => s.toggle);
  useEffect(() => bindFileListView(), []);

  const tree = view === 'tree';
  const label = tree ? 'List files flat' : 'Group files by directory';
  return (
    <ActionIcon
      variant="subtle"
      color="gray"
      size="sm"
      aria-label={label}
      title={label}
      onClick={toggle}
    >
      {tree ? <IconListTree size={16} /> : <IconList size={16} />}
    </ActionIcon>
  );
}

function FilesHeader({ files }: { files: readonly ReviewFile[] }) {
  let additions = 0;
  let deletions = 0;
  for (const file of files) {
    additions += file.additions;
    deletions += file.deletions;
  }
  // px 6 mirrors the row padding so the totals line up with the per-row stats,
  // which is why the toggle went on the caption's side rather than theirs.
  return (
    <Group justify="space-between" align="center" gap={8} px={6} wrap="nowrap">
      <Group gap={4} align="center" wrap="nowrap">
        <Caption>Files</Caption>
        <FileListViewToggle />
      </Group>
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

/** How deep a row sits, for the CSS that turns it into left padding. */
function indentStyle(depth: number): CSSProperties {
  return { '--file-depth': depth } as CSSProperties;
}

/**
 * One file, in either view. Both draw the same row — status letter, name,
 * stats, skipped state, active wash, and a click that opens the file — because
 * the two views differ over grouping and nothing else, and a reader who flips
 * between them should see the same rows move rather than different rows
 * appear. The directory is the one thing that does differ: in the tree it is
 * already overhead, spelled once on the row the file hangs under.
 */
function FileRow({
  file,
  active,
  depth,
  showDirname,
  onSelectFile,
}: {
  file: ReviewFile;
  active: boolean;
  depth: number;
  showDirname: boolean;
  onSelectFile: (filename: string) => void;
}) {
  const { dirname, basename } = splitFilename(file.filename);
  const showStats = file.additions > 0 || file.deletions > 0;
  const skipped = file.skipped ? `Not reviewed: ${SKIP_REASON_LABEL[file.skipped]}` : null;
  return (
    <UnstyledButton
      className={classes.fileRow}
      style={indentStyle(depth)}
      aria-current={active ? 'true' : undefined}
      data-active={active || undefined}
      data-skipped={skipped ? true : undefined}
      title={skipped ?? undefined}
      onClick={() => onSelectFile(file.filename)}
    >
      <span className={classes.status} data-status={file.status}>
        {STATUS_LETTER[file.status]}
      </span>
      <Box component="span" miw={0}>
        <span className={classes.basename}>{basename}</span>
        {skipped && <VisuallyHidden>{skipped}</VisuallyHidden>}
        {showDirname && dirname.length > 0 && <span className={classes.dirname}>{dirname}/</span>}
      </Box>
      {showStats ? (
        <Stats additions={file.additions} deletions={file.deletions} />
      ) : (
        <span aria-hidden />
      )}
    </UnstyledButton>
  );
}

interface FileListProps {
  files: readonly ReviewFile[];
  activeFile: string | null;
  onSelectFile: (filename: string) => void;
}

function FileList(props: FileListProps) {
  const view = useFileListView((s) => s.view);
  return view === 'tree' ? <FileTreeList {...props} /> : <FlatFileList {...props} />;
}

function FlatFileList({ files, activeFile, onSelectFile }: FileListProps) {
  return (
    <ul className={classes.fileList} aria-label="Changed files">
      {files.map((file) => (
        <li key={file.filename}>
          <FileRow
            file={file}
            active={file.filename === activeFile}
            depth={0}
            showDirname
            onSelectFile={onSelectFile}
          />
        </li>
      ))}
    </ul>
  );
}

/** What every row of the tree needs and none of them owns. */
interface TreeContext {
  /** Paths the reader has folded. Collapsed rather than expanded, so a tree arrives open. */
  collapsed: ReadonlySet<string>;
  onToggle: (path: string) => void;
  activeFile: string | null;
  onSelectFile: (filename: string) => void;
}

/**
 * The same files under their directories: a nested disclosure list, and
 * deliberately not an ARIA tree.
 *
 * The tree pattern is one composite widget — a single tab stop, with arrows,
 * Home/End and type-ahead moving a roving tabindex between rows. Every row
 * here is an ordinary button, reached by Tab. Taking the roles without that
 * focus model would announce navigation the list does not have and hide each
 * row's real control inside a widget role, so `role="tree"`, `treeitem` and
 * `group` cannot come back on their own: they are only honest once the whole
 * key map is behind them, and half a key map is worse than plain buttons.
 *
 * The nesting carries the hierarchy instead. Nested `ul`/`li` is itself
 * exposed, depth included, so the levels are structure rather than left
 * padding. `aria-expanded` sits on the directory button, where focus actually
 * lands, and that button is named by its own contents — the folded path, not
 * the subtree under it.
 */
function FileTreeList({ files, activeFile, onSelectFile }: FileListProps) {
  const nodes = useMemo(() => buildFileTree(files), [files]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set<string>());
  const onToggle = useCallback((path: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  }, []);

  return (
    <ul className={classes.fileList} aria-label="Changed files">
      {treeItems(nodes, 0, { collapsed, onToggle, activeFile, onSelectFile })}
    </ul>
  );
}

function treeItems(
  nodes: readonly FileTreeNode[],
  depth: number,
  context: TreeContext,
): ReactNode[] {
  return nodes.map((node) =>
    node.kind === 'file' ? (
      <li key={`file:${node.file.filename}`}>
        <FileRow
          file={node.file}
          active={node.file.filename === context.activeFile}
          depth={depth}
          showDirname={false}
          onSelectFile={context.onSelectFile}
        />
      </li>
    ) : (
      <DirectoryItem key={`dir:${node.path}`} node={node} depth={depth} context={context} />
    ),
  );
}

function DirectoryItem({
  node,
  depth,
  context,
}: {
  node: FileTreeDirectory;
  depth: number;
  context: TreeContext;
}) {
  const open = !context.collapsed.has(node.path);
  return (
    <li>
      <UnstyledButton
        className={classes.dirRow}
        style={indentStyle(depth)}
        aria-expanded={open}
        onClick={() => context.onToggle(node.path)}
      >
        <span aria-hidden className={classes.twisty} data-open={open || undefined}>
          ›
        </span>
        <span className={classes.dirLabel}>{node.name}</span>
      </UnstyledButton>
      {open && <ul className={classes.group}>{treeItems(node.children, depth + 1, context)}</ul>}
    </li>
  );
}
