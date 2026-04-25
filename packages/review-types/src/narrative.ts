/**
 * Narrative review type cluster, ported from the diffy/ Electron POC at
 * `diffy/src/shared/types.ts`. This is the shape Phase 4's worker will
 * persist into `reviews.content` and Phase 6's reader UI will render.
 *
 * Phase 3's stub worker writes a hard-coded value of this shape so the
 * pipeline can be tested end-to-end before opencode is wired up.
 */

export type InsightType = 'context' | 'rationale' | 'highlight' | 'reference';

export interface Insight {
  type: InsightType;
  text: string;
}

export interface DiffLineSpan {
  startLine: number;
  lineCount: number;
}

export interface ResolvedDiffHunk {
  id: string;
  fileOrder: number;
  original: DiffLineSpan;
  modified: DiffLineSpan;
}

export interface DiffChunk {
  filename: string;
  language: string;
  hunks: ResolvedDiffHunk[];
}

export interface NarrativeChapter {
  id: string;
  title: string;
  insights: Insight[];
  diffChunks: DiffChunk[];
}

export interface NarrativeReview {
  prTitle: string;
  overviewSummary: string;
  chapters: NarrativeChapter[];
}

/**
 * Reserved id used by the renderer to identify the synthesised summary
 * section that precedes the first chapter. Kept in sync with the POC so
 * components ported in Phase 6 don't need adjustment.
 */
export const SUMMARY_SECTION_ID = '__summary__';
