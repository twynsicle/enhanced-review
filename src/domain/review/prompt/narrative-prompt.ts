import { NARRATIVE_SYSTEM_PROMPT } from './instructions.ts';
import type { ReviewFile, ReviewFileSkipReason } from '../narrative.ts';
import { builtInSkipReason } from './ai-file-filter.ts';
import {
  buildDiffHunkIndex,
  groundingFor,
  type DiffHunk,
  type PromptGrounding,
} from './diff-hunk-catalog.ts';
import type { PrData } from './types.ts';

/**
 * Builds the system + user prompt for the narrative review. The files that
 * carry a `skipped` reason are listed apart and their patches dropped, the
 * rest of the diff is truncated per file above a token budget, and every hunk
 * in it is numbered into an id the model cites.
 *
 * Hunks are numbered over the whole filtered diff, before truncation, because
 * numbering after it would renumber every hunk that follows a trimmed one and
 * the ids stored on the review would then mean something different from the
 * ids the coverage backstop measures against. So the result carries both the
 * whole `catalog`, which is what coverage measures against, and the
 * `grounding` the model's answer is checked through, which resolves only the
 * hunks the prompt showed.
 */
const MAX_DIFF_TOKENS = 80_000;
const CHARS_PER_TOKEN = 4;
const MAX_DIFF_CHARS = MAX_DIFF_TOKENS * CHARS_PER_TOKEN;
const KEEP_LINES = 80;

export interface NarrativePromptResult {
  system: string;
  user: string;
  wasTruncated: boolean;
  /** Every hunk of every reviewed file, for the coverage backstop. */
  catalog: DiffHunk[];
  /** What the model's citations are resolved against. */
  grounding: PromptGrounding;
}

/** Trims the largest file patches first, keeping their head and tail. */
function truncateDiff(diff: string): { result: string; wasTruncated: boolean } {
  if (diff.length <= MAX_DIFF_CHARS) return { result: diff, wasTruncated: false };

  const patches = diff.split(/(?=^diff --git )/m);
  const bySize = patches
    .map((p, index) => ({ index, size: p.length }))
    .toSorted((a, b) => b.size - a.size);

  let totalSize = diff.length;
  const truncated = [...patches];
  for (const { index, size } of bySize) {
    if (totalSize <= MAX_DIFF_CHARS) break;
    const lines = (truncated[index] ?? '').split('\n');
    if (lines.length <= KEEP_LINES * 2 + 5) continue;

    const kept = [
      ...lines.slice(0, 4 + KEEP_LINES),
      `[... ${String(lines.length - KEEP_LINES * 2 - 4)} lines truncated ...]`,
      ...lines.slice(-KEEP_LINES),
    ];
    const newPatch = kept.join('\n');
    totalSize -= size - newPatch.length;
    truncated[index] = newPatch;
  }

  const result = truncated.join('');
  if (result.length > MAX_DIFF_CHARS) {
    return {
      result: result.slice(0, MAX_DIFF_CHARS) + '\n[... diff truncated due to size ...]',
      wasTruncated: true,
    };
  }
  return { result, wasTruncated: true };
}

function dropPatches(diff: string, shouldExclude: (filename: string) => boolean): string {
  return diff
    .split(/(?=^diff --git )/m)
    .filter((patch) => {
      const match = /^diff --git a\/.+ b\/(.+)/.exec(patch);
      return !match || !shouldExclude(match[1] ?? '');
    })
    .join('');
}

/** What each skip reason is called where the model reads it. */
const SKIP_NOTE: Record<ReviewFileSkipReason, string> = {
  generated: 'marked linguist-generated',
  vendored: 'marked linguist-vendored',
  'built-in': 'lockfile, bundle or snapshot',
  binary: 'binary',
};

type SkippedFile = ReviewFile & { skipped: ReviewFileSkipReason };

const isSkipped = (file: ReviewFile): file is SkippedFile => file.skipped !== undefined;

/**
 * The Not Reviewed block, or null when every changed file is reviewed. The
 * model sees these paths in the change it is describing either way — a commit
 * message, an import, a test name — so leaving them unmentioned invites it to
 * cite hunks that do not exist for them.
 */
export function formatSkippedSection(files: readonly ReviewFile[]): string | null {
  const skipped = files.filter(isSkipped);
  if (skipped.length === 0) return null;
  return (
    `## Not Reviewed (${String(skipped.length)})\n` +
    'These files changed but are left out of the review. They have no hunks; do not cite them.\n' +
    skipped.map((file) => `  ${file.filename}  (${SKIP_NOTE[file.skipped]})`).join('\n')
  );
}

/** The Files Changed list: status, counts, path. */
export function formatFileList(files: readonly ReviewFile[]): string {
  return files
    .map(
      (f) =>
        `  ${f.status.padEnd(10)} +${String(f.additions)}/-${String(f.deletions)}  ${f.filename}`,
    )
    .join('\n');
}

/**
 * The subset of the catalog a truncated diff still carries. Matched on the
 * file's name and the hunk's own header rather than on position: truncation
 * drops lines from the middle of a patch, so the hunks after it keep their
 * headers but no longer their place in the file.
 */
function hunksShownIn(diff: string, hunks: readonly DiffHunk[]): DiffHunk[] {
  const shown = new Set(buildDiffHunkIndex(diff).hunks.map(hunkKey));
  return hunks.filter((hunk) => shown.has(hunkKey(hunk)));
}

const hunkKey = (hunk: DiffHunk) => `${hunk.filename}\u0000${hunk.header}`;

/** The Changed Hunks list the model cites ids from. */
export function formatHunkCatalog(hunks: readonly DiffHunk[]): string {
  if (hunks.length === 0) return '  (No patch hunks were detected in the provided diff.)';
  return hunks
    .map(
      (hunk) =>
        `  ${hunk.id}  ${hunk.filename}  ${hunk.header}  original ${formatLineSpan(hunk.original.startLine, hunk.original.lineCount)}  modified ${formatLineSpan(hunk.modified.startLine, hunk.modified.lineCount)}`,
    )
    .join('\n');
}

function formatLineSpan(startLine: number, lineCount: number): string {
  if (lineCount === 0) return `L${String(startLine)} (+0)`;
  if (lineCount === 1) return `L${String(startLine)}`;
  return `L${String(startLine)}-${String(startLine + lineCount - 1)}`;
}

export function buildNarrativePrompt(prData: PrData): NarrativePromptResult {
  const skipped = new Set(prData.files.filter(isSkipped).map((f) => f.filename));
  const reviewed = prData.files.filter((f) => !skipped.has(f.filename));

  // A patch is dropped when its file is stamped `skipped`, and also when the
  // built-in rules alone would stamp it: the file list and the diff come from
  // separate git commands, and a path missing from the list must not have a
  // lockfile's whole patch inlined and numbered into ids no file can carry.
  const filtered = dropPatches(
    prData.diff,
    (filename) => skipped.has(filename) || builtInSkipReason(filename) !== null,
  );
  const catalog = buildDiffHunkIndex(filtered).hunks;
  const { result: diff, wasTruncated } = truncateDiff(filtered);
  const shown = wasTruncated ? hunksShownIn(diff, catalog) : catalog;

  const sections = [
    `## Files Changed (${String(reviewed.length)})\n${formatFileList(reviewed)}`,
    formatSkippedSection(prData.files),
    `## Changed Hunks (Use These IDs in diffChunks.hunkIds)\n${formatHunkCatalog(shown)}`,
  ].filter((section) => section !== null);

  let user = `# Pull Request: ${prData.title}

**Author**: ${prData.author}
**Branches**: ${prData.headRefName} → ${prData.baseRefName}

## Description
${prData.body || '(no description)'}

Use the description as author-provided intent. If it mentions user impact, rollout, linked issues, testing strategy, or alternatives, reflect that context in overviewSummary and chapter descriptions.

${sections.join('\n\n')}

## Full Diff
\`\`\`
${diff}
\`\`\``;

  if (wasTruncated) {
    user +=
      '\n\nNote: Some large file diffs were truncated. Focus your narrative on the available content.';
  }

  return {
    system: NARRATIVE_SYSTEM_PROMPT,
    user,
    wasTruncated,
    catalog,
    grounding: groundingFor(
      shown,
      reviewed.map((file) => file.filename),
    ),
  };
}
