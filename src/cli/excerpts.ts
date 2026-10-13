import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { excerptsDropped, type ExcerptDrop, type Finding } from '../review/findings.ts';
import type { ContextExcerpt, NarrativeReview } from '../review/narrative.ts';
import { MAX_EMBED_BYTES, treeEntries, type TreeEntry } from './context.ts';
import type { Shell } from './git.ts';
import { mapLimit, PARALLEL_GIT } from './git-runner.ts';
import type { RunFiles } from './run-folder.ts';

/**
 * The excerpts of unchanged code, held to the head commit: the half of their
 * checking the parser cannot do, because only git knows whether a file is
 * there and how long it is. What survives is shown from the text read here,
 * which goes to `excerpts.json` so the render stage never needs git.
 */
export const ExcerptContentsSchema = z.record(z.string(), z.string());
export type ExcerptContents = z.infer<typeof ExcerptContentsSchema>;

export interface CheckedExcerpts {
  review: NarrativeReview;
  /** The text of each file a surviving excerpt shows, at the head commit. */
  contents: ExcerptContents;
  /** One `excerpt-dropped` warning naming every excerpt that went, or null. */
  dropped: Finding | null;
}

/** A file as an excerpt can use it, or why it cannot be. */
type HeadFile = { text: string; lines: number } | { unusable: string };

/**
 * `dirty` is what the working tree holds beyond the reviewed commit. The agent
 * numbered its lines by what it read there, so an excerpt of a dirty file
 * would draw the commit's lines under the agent's numbers.
 */
export async function checkExcerpts(
  review: NarrativeReview,
  headSha: string,
  dirty: readonly string[],
  shell: Shell,
): Promise<CheckedExcerpts> {
  const paths = [
    ...new Set(
      review.chapters.flatMap((chapter) => (chapter.contextExcerpts ?? []).map((e) => e.filename)),
    ),
  ];
  if (paths.length === 0) return { review, contents: {}, dropped: null };

  const tree = await treeEntries(shell, headSha, paths);
  const read = await mapLimit(paths, PARALLEL_GIT, (filename) =>
    headFile(shell, tree.get(filename)),
  );
  const files = new Map(paths.map((filename, at) => [filename, read[at]!]));
  const onDisk = new Set(dirty);

  const drops: ExcerptDrop[] = [];
  const contents: ExcerptContents = {};
  const chapters = review.chapters.map((chapter) => {
    if (!chapter.contextExcerpts) return chapter;
    const kept = chapter.contextExcerpts.filter((excerpt) => {
      const drop = (why: string): false => {
        drops.push({ chapterId: chapter.id, excerpt: describe(excerpt), why });
        return false;
      };
      const file = files.get(excerpt.filename)!;
      if ('unusable' in file) return drop(file.unusable);
      if (onDisk.has(excerpt.filename)) return drop('changed on disk since the reviewed commit');
      if (excerpt.endLine > file.lines) return drop(`the file has ${String(file.lines)} lines`);
      contents[excerpt.filename] = file.text;
      return true;
    });
    const { contextExcerpts: _all, ...rest } = chapter;
    return kept.length > 0 ? { ...rest, contextExcerpts: kept } : rest;
  });

  return {
    review: { ...review, chapters },
    contents,
    dropped: drops.length > 0 ? excerptsDropped(drops) : null,
  };
}

function describe(excerpt: ContextExcerpt): string {
  return `${excerpt.filename} L${String(excerpt.startLine)}–${String(excerpt.endLine)}`;
}

/**
 * The same limits gather puts on a changed file, so an excerpt can never carry
 * into the report what a diff would have refused. Binary is git's own test:
 * a NUL byte anywhere in the blob.
 */
async function headFile(shell: Shell, entry: TreeEntry | undefined): Promise<HeadFile> {
  if (!entry) return { unusable: 'not in the head commit' };
  if (entry.type !== 'blob') return { unusable: 'not a file at the head commit' };
  if (entry.mode === '120000') return { unusable: 'a symbolic link at the head commit' };
  if (entry.size > MAX_EMBED_BYTES) return { unusable: 'too large to embed in the report' };
  const text = await shell.git(['cat-file', 'blob', entry.oid]);
  if (text.includes('\0')) return { unusable: 'a binary file' };
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  return { text, lines: text === '' ? 0 : body.split('\n').length };
}

/**
 * What the last parse read for the review's excerpts. Written by every parse
 * that produced a review, so its absence means the parse did not finish.
 */
export async function readExcerpts(run: RunFiles): Promise<ExcerptContents> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(run.excerpts, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${run.excerpts} was not fully written; run from parse`, { cause: error });
    }
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    throw new Error(`no excerpts.json in ${run.folder}; run from parse`, { cause: error });
  }
  const parsed = ExcerptContentsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`${run.excerpts} is not a set of file contents: ${parsed.error.message}`);
  }
  return parsed.data;
}
