import type { CitedHunk, DiffLineSpan, NarrativeChapter, ReviewFile } from '@/review/narrative';
import type { ReviewMeta } from '@/review/review-meta';

/**
 * Long enough that git never finds one ambiguous in a large repository, where
 * its own seven characters can be.
 */
const SHORT_SHA = 12;

function shortSha(sha: string): string {
  return sha.slice(0, SHORT_SHA);
}

function changeName(meta: ReviewMeta): string {
  switch (meta.kind) {
    case 'pr':
      return `PR #${String(meta.prNumber)} "${meta.title}"`;
    case 'branch':
      return `the branch ${meta.headRefName ?? meta.title}`;
    case 'staged':
      return meta.baseRefName === null
        ? 'the staged changes'
        : `the staged changes on ${meta.baseRefName}`;
  }
}

function lineRange(start: number, count: number): string {
  return count === 1 ? String(start) : `${String(start)}-${String(start + count - 1)}`;
}

/**
 * Both sides of a hunk, each where it lives: the head side under the path the
 * chapter cites, the base side under the path it had before a rename. Neither
 * side is judged the one that matters — a cited hunk carries git's context
 * lines, so a deletion inside a file still has head lines, and only the empty
 * side of a whole-file change says the lines are new or gone.
 */
function span(filename: string, origin: string | undefined, hunk: CitedHunk): string {
  const side = (name: string, path: string, { startLine, lineCount }: DiffLineSpan) =>
    `${name} ${path === filename ? '' : `${path} `}${lineRange(startLine, lineCount)}`;
  const base = side('base', origin ?? filename, hunk.original);
  const head = side('head', filename, hunk.modified);
  if (hunk.original.lineCount === 0) return `- ${filename}: ${head} (new)`;
  if (hunk.modified.lineCount === 0) return `- ${filename}: ${base} (gone at head)`;
  return `- ${filename}: ${head}, ${base}`;
}

/**
 * The text the chapter header's Ask button copies: enough for Claude Code,
 * standing in the repository, to find what the chapter is about and read it
 * for itself. No code is pasted, since the repository is right there and a
 * pasted copy would only be a staler one.
 */
export function askPrompt(
  meta: ReviewMeta,
  chapter: NarrativeChapter,
  files: ReadonlyMap<string, ReviewFile>,
): string {
  const base = shortSha(meta.baseSha);
  const head = shortSha(meta.headSha);
  const spans = chapter.diffChunks.flatMap((chunk) => {
    const origin = files.get(chunk.filename)?.origin?.filename;
    return chunk.hunks
      .toSorted((a, b) => a.fileOrder - b.fileOrder)
      .map((h) => span(chunk.filename, origin, h));
  });
  const excerpts = (chapter.contextExcerpts ?? []).map(
    (e) => `- ${e.filename}: head ${lineRange(e.startLine, e.endLine - e.startLine + 1)}`,
  );

  return [
    `Help me check one chapter of a code review of ${changeName(meta)} in ${meta.repo}.`,
    '',
    `The change is ${base}..${head}; \`git diff ${base} ${head}\` shows it.`,
    '',
    `Chapter: ${chapter.title}`,
    chapter.headline,
    '',
    `It cites these lines, "head" at ${head} and "base" at ${base}:`,
    ...spans,
    ...(excerpts.length > 0 ? ['', 'And this unchanged code it affects:', ...excerpts] : []),
    '',
    'Read those lines in the repository before answering. My question:',
  ].join('\n');
}
