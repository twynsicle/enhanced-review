import { isExcludedFromAI } from './ai-file-filter';
import { buildDiffHunkIndex, type DiffHunkIndex } from './diff-hunk-catalog';
import type { PrData } from './types';

/**
 * Build the (system, user) prompt pair sent to opencode. Ported from the
 * diffy POC's `narrative-prompt.ts`. The system prompt instructs the
 * model to emit `<narrative_review>{...}</narrative_review>`; the user
 * prompt carries the diff, file list, and hunk catalog.
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

function truncateDiff(diff: string): { result: string; wasTruncated: boolean } {
  if (diff.length <= MAX_DIFF_CHARS) {
    return { result: diff, wasTruncated: false };
  }

  const patches = diff.split(/(?=^diff --git )/m);
  const patchSizes = patches.map((p, i) => ({ index: i, size: p.length }));
  patchSizes.sort((a, b) => b.size - a.size);

  let totalSize = diff.length;
  const truncated = [...patches];

  for (const { index, size } of patchSizes) {
    if (totalSize <= MAX_DIFF_CHARS) break;

    const lines = truncated[index]!.split('\n');
    if (lines.length <= KEEP_LINES * 2 + 5) continue;

    const header = lines.slice(0, 4);
    const kept = [
      ...header,
      ...lines.slice(4, 4 + KEEP_LINES),
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
  const patches = diff.split(/(?=^diff --git )/m);
  const kept = patches.filter((patch) => {
    const match = patch.match(/^diff --git a\/.+ b\/(.+)/);
    if (!match) return true;
    return !shouldExclude(match[1]!);
  });
  return kept.join('');
}

function formatLineSpan(startLine: number, lineCount: number): string {
  if (lineCount === 0) {
    return `L${String(startLine)} (+0)`;
  }

  if (lineCount === 1) {
    return `L${String(startLine)}`;
  }

  return `L${String(startLine)}-${String(startLine + lineCount - 1)}`;
}

export function buildNarrativePrompt(
  prData: PrData,
  userPatterns?: readonly string[],
): NarrativePromptResult {
  const system = `You are a senior software engineer reviewing a pull request. Your job is to produce a structured narrative review that organizes the PR changes into logical chapters.

Output a JSON object wrapped in <narrative_review> tags. The JSON must conform to this schema:

{
  "prTitle": "string — the PR title",
  "overviewSummary": "string — 2-4 sentence high-level summary of the entire PR",
  "chapters": [
    {
      "id": "string — unique slug like 'auth-middleware'",
      "title": "string — actionable takeaway title (McKinsey-style, a full sentence conveying the key insight, e.g., 'Centralizing auth middleware reduces duplication across 12 route handlers')",
      "insights": [
        {
          "type": "context | rationale | highlight | reference",
          "text": "string — concise reviewer aid"
        }
      ],
      "diffChunks": [
        {
          "filename": "string — path of the file (must match a path from the Files Changed list)",
          "language": "string — programming language",
          "hunkIds": ["string — one or more hunk IDs from the Changed Hunks list (example: H0007)"]
        }
      ]
    }
  ]
}

Guidelines:
- Produce 2–12 chapters depending on PR complexity. For small PRs (1–2 files, under 20 lines changed), 2–3 chapters is appropriate.
- Group related changes together logically (e.g. "API types", "database migration", "UI components").
- Each chapter should tell a coherent story about one aspect of the change.
- Chapter titles must be actionable takeaway sentences (McKinsey-style), not short labels. They should convey the key insight of the chapter, e.g., "Extracting shared validation logic into a reusable hook eliminates 200 lines of duplication".
- Each chapter must have 1–3 insights. Insight types are reviewer aids (not AI opinions):
  - "context": background info to help the reviewer understand the change
  - "rationale": why this approach was chosen over alternatives
  - "highlight": key change the reviewer should focus on
  - "reference": pointers to related code, docs, or patterns
- Each diffChunk must use only hunk IDs listed in "Changed Hunks". Do not invent IDs.
- Keep hunk IDs file-consistent: only use hunk IDs that belong to the same filename as the diffChunk.
- Prefer one diffChunk per file per chapter; group relevant hunk IDs in that chunk.
- Output ONLY the <narrative_review> JSON tags — no other text.`;

  const shouldExclude = (filename: string): boolean => isExcludedFromAI(filename, userPatterns);
  const filteredFiles = prData.files.filter((f) => !shouldExclude(f.filename));

  const fileList = filteredFiles
    .map(
      (f) =>
        `  ${f.status.padEnd(10)} +${String(f.additions)}/-${String(f.deletions)}  ${f.filename}`,
    )
    .join('\n');

  const filteredDiff = filterDiffPatches(prData.diff, shouldExclude);
  const { result: diff, wasTruncated } = truncateDiff(filteredDiff);
  const hunkIndex = buildDiffHunkIndex(diff);
  const hunkCatalog =
    hunkIndex.hunks.length === 0
      ? '  (No patch hunks were detected in the provided diff.)'
      : hunkIndex.hunks
          .map(
            (hunk) =>
              `  ${hunk.id}  ${hunk.filename}  ${hunk.header}  original ${formatLineSpan(hunk.original.startLine, hunk.original.lineCount)}  modified ${formatLineSpan(hunk.modified.startLine, hunk.modified.lineCount)}`,
          )
          .join('\n');

  let user = `# Pull Request: ${prData.title}

**Author**: ${prData.author}
**Branches**: ${prData.headRefName} → ${prData.baseRefName}

## Description
${prData.body || '(no description)'}

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

  return { system, user, wasTruncated, hunkIndex };
}
