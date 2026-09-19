import { detectLanguage } from './language-map.ts';
import type {
  DiffChunk,
  NarrativeChapter,
  NarrativeReview,
  ResolvedDiffHunk,
  ReviewFile,
} from './narrative.ts';
import type { DiffHunk } from './prompt/diff-hunk-catalog.ts';

/**
 * What the chapters left out, file by file. A hunk the reviewer was shown and
 * no chapter cites disqualifies the whole answer (`validate-review.ts`), so a
 * review that reaches a reader has leftovers only where the prompt was
 * truncated: hunks in the catalog that were cut before the model ever saw
 * them. The file view still draws those, and the sidebar still marks the file
 * they belong to, because they are changes nobody looked at.
 *
 * Measured per hunk rather than per file: a file cited for two of its nine
 * hunks is discussed, and seven of its changes are still unseen.
 *
 * Only chapter `diffChunks` count as citing. A diagram node grounded on a
 * hunk points at it; it does not discuss it.
 */
export interface FileCoverage {
  file: ReviewFile;
  /** Hunks of this file the chapters cite. */
  cited: number;
  /** Hunks of this file the model was given. */
  total: number;
  /** The hunks no chapter cites, in file order. */
  uncited: ResolvedDiffHunk[];
  /** Those hunks as a chunk the inline diff can render; null when there are none. */
  chunk: DiffChunk | null;
}

export interface ReviewCoverage {
  /** Hunks across every reviewed file that carries a catalog. */
  total: number;
  cited: number;
  /** Coverage by filename, for every file with a catalog. */
  byFile: ReadonlyMap<string, FileCoverage>;
}

/**
 * Attaches the catalog to the files it belongs to. A reviewed file absent
 * from the catalog gets an empty one: nothing to cite is not the same as not
 * knowing. Skipped files carry none — they were never offered.
 */
export function withFileHunks(
  files: readonly ReviewFile[],
  hunks: readonly DiffHunk[],
): ReviewFile[] {
  const byFile = new Map<string, ResolvedDiffHunk[]>();
  for (const hunk of hunks) {
    const list = byFile.get(hunk.filename) ?? [];
    list.push({
      id: hunk.id,
      fileOrder: hunk.fileOrder,
      original: { ...hunk.original },
      modified: { ...hunk.modified },
    });
    byFile.set(hunk.filename, list);
  }
  return files.map((file) =>
    file.skipped ? file : { ...file, hunks: byFile.get(file.filename) ?? [] },
  );
}

/** Every hunk id some chapter's diffChunks cite. */
export function citedHunkIds(chapters: readonly NarrativeChapter[]): Set<string> {
  const ids = new Set<string>();
  for (const chapter of chapters) {
    for (const chunk of chapter.diffChunks) {
      for (const hunk of chunk.hunks) ids.add(hunk.id);
    }
  }
  return ids;
}

/** The chapters whose diffChunks name this file, in narrative order. */
export function chaptersCiting(
  filename: string,
  chapters: readonly NarrativeChapter[],
): NarrativeChapter[] {
  return chapters.filter((chapter) =>
    chapter.diffChunks.some((chunk) => chunk.filename === filename),
  );
}

/**
 * The chapter a judgement call is drawn in: the first whose chunk for its file
 * shows one of the hunks it cites. Matching the file alone is not enough — two
 * chapters can each show different hunks of one file, and a question drawn on
 * the card that lacks its lines asks about code the reader cannot see there.
 */
export function judgementCallOwner<C extends Pick<NarrativeChapter, 'diffChunks'>>(
  call: { filename: string; hunkIds: readonly string[] },
  chapters: readonly C[],
): C | undefined {
  const wanted = new Set(call.hunkIds);
  return chapters.find((chapter) =>
    chapter.diffChunks.some(
      (chunk) =>
        chunk.filename === call.filename && chunk.hunks.some((hunk) => wanted.has(hunk.id)),
    ),
  );
}

/**
 * Every hunk the chapters cited from one file, as a single chunk. The file
 * view draws this rather than a chunk per chapter: slicing the file around
 * each chapter's hunks separately repeats the lines between two neighbouring
 * hunks, once in each slice, and orders the editors by chapter instead of by
 * the file. Merged, `groupSelectedHunks` decides the editors from `fileOrder`
 * alone. Chapter cards still draw their own hunks and are unaffected.
 *
 * `language` is the first citing chapter's, which is the reviewer's own label
 * for the file rather than one re-derived from its name.
 *
 * Null only when no chapter names the file at all. A chapter that names it
 * and cites nothing keeps its chunk, because an empty hunk list is what the
 * inline diff reads as "show the whole file".
 */
export function citedChunk(
  filename: string,
  chapters: readonly NarrativeChapter[],
): DiffChunk | null {
  const hunks: ResolvedDiffHunk[] = [];
  const seen = new Set<string>();
  let language: string | null = null;

  for (const chapter of chapters) {
    for (const chunk of chapter.diffChunks) {
      if (chunk.filename !== filename) continue;
      language ??= chunk.language;
      for (const hunk of chunk.hunks) {
        if (seen.has(hunk.id)) continue;
        seen.add(hunk.id);
        hunks.push(hunk);
      }
    }
  }

  if (language === null) return null;
  return { filename, language, hunks: hunks.toSorted((a, b) => a.fileOrder - b.fileOrder) };
}

/**
 * Null when the file carries no catalog — it was skipped, or the executor
 * returned none (the stub does not). Nothing to report beats reporting every
 * hunk as uncited when there is no list of hunks to have cited.
 */
export function fileCoverage(file: ReviewFile, cited: ReadonlySet<string>): FileCoverage | null {
  if (!file.hunks) return null;
  const uncited = file.hunks
    .filter((hunk) => !cited.has(hunk.id))
    .toSorted((a, b) => a.fileOrder - b.fileOrder);
  return {
    file,
    cited: file.hunks.length - uncited.length,
    total: file.hunks.length,
    uncited,
    chunk:
      uncited.length === 0
        ? null
        : { filename: file.filename, language: detectLanguage(file.filename), hunks: uncited },
  };
}

export function reviewCoverage(review: NarrativeReview): ReviewCoverage {
  const cited = citedHunkIds(review.chapters);
  const byFile = new Map<string, FileCoverage>();
  let total = 0;
  let citedCount = 0;

  const files = (review.files ?? []).toSorted((a, b) => a.filename.localeCompare(b.filename));
  for (const file of files) {
    const coverage = fileCoverage(file, cited);
    if (!coverage) continue;
    byFile.set(file.filename, coverage);
    total += coverage.total;
    citedCount += coverage.cited;
  }

  return { total, cited: citedCount, byFile };
}
