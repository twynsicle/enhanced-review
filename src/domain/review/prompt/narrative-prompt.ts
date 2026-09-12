import { isExcludedFromAI } from './ai-file-filter.ts';
import { NARRATIVE_SYSTEM_PROMPT } from './instructions.ts';
import type { ReviewFile } from '../narrative.ts';
import { buildDiffHunkIndex, type DiffHunk, type DiffHunkIndex } from './diff-hunk-catalog.ts';
import type { PrData } from './types.ts';

/**
 * Builds the system + user prompt for the narrative review. The diff is
 * filtered (lockfiles etc.), truncated per file above a token budget, and
 * indexed into hunk ids the model must cite; the returned `hunkIndex` lets
 * `parseNarrativeReview` resolve those ids back to line spans.
 */
const MAX_DIFF_TOKENS = 80_000;
const CHARS_PER_TOKEN = 4;
const MAX_DIFF_CHARS = MAX_DIFF_TOKENS * CHARS_PER_TOKEN;
const KEEP_LINES = 80;

export interface NarrativePromptResult {
  system: string;
  user: string;
  wasTruncated: boolean;
  hunkIndex: DiffHunkIndex;
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

function filterDiffPatches(diff: string, shouldExclude: (filename: string) => boolean): string {
  return diff
    .split(/(?=^diff --git )/m)
    .filter((patch) => {
      const match = /^diff --git a\/.+ b\/(.+)/.exec(patch);
      return !match || !shouldExclude(match[1] ?? '');
    })
    .join('');
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

export function buildNarrativePrompt(
  prData: PrData,
  userPatterns?: readonly string[],
): NarrativePromptResult {
  const shouldExclude = (filename: string): boolean => isExcludedFromAI(filename, userPatterns);
  const filteredFiles = prData.files.filter((f) => !shouldExclude(f.filename));

  const fileList = formatFileList(filteredFiles);

  const { result: diff, wasTruncated } = truncateDiff(
    filterDiffPatches(prData.diff, shouldExclude),
  );
  const hunkIndex = buildDiffHunkIndex(diff);
  const hunkCatalog = formatHunkCatalog(hunkIndex.hunks);

  let user = `# Pull Request: ${prData.title}

**Author**: ${prData.author}
**Branches**: ${prData.headRefName} → ${prData.baseRefName}

## Description
${prData.body || '(no description)'}

Use the description as author-provided intent. If it mentions user impact, rollout, linked issues, testing strategy, or alternatives, reflect that context in overviewSummary and chapter descriptions.

## Files Changed (${String(filteredFiles.length)})
${fileList}

## Changed Hunks (Use These IDs in diffChunks.hunkIds)
${hunkCatalog}

## Full Diff
\`\`\`
${diff}
\`\`\``;

  if (wasTruncated) {
    user +=
      '\n\nNote: Some large file diffs were truncated. Focus your narrative on the available content.';
  }

  return { system: NARRATIVE_SYSTEM_PROMPT, user, wasTruncated, hunkIndex };
}
