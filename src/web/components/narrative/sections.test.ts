import { describe, expect, it } from 'vitest';
import { reviewCoverage } from '@/domain/review/coverage';
import {
  RISK_SECTION_ID,
  SUMMARY_SECTION_ID,
  UNDISCUSSED_SECTION_ID,
  type NarrativeReview,
} from '@/domain/review/narrative';
import { HAND_BEFORE_AFTER, REAL_ARCHITECTURE } from '@/web/test/diagram-fixtures';
import { findSection, readerSections } from './sections';

/** The sections over a review's own coverage, the way the reader derives them. */
const sectionsOf = (r: NarrativeReview) => readerSections(r, reviewCoverage(r));

function review(overrides: Partial<NarrativeReview> = {}): NarrativeReview {
  return {
    prTitle: 'A change',
    overviewSummary: { lede: 'It changes things.' },
    chapters: [
      { id: 'ch1', title: 'One', insights: [], diffChunks: [] },
      { id: 'ch2', title: 'Two', insights: [], diffChunks: [] },
    ],
    ...overrides,
  };
}

describe('readerSections', () => {
  it('puts the summary first and the chapters last, in order', () => {
    expect(sectionsOf(review()).map((section) => section.id)).toEqual([
      SUMMARY_SECTION_ID,
      'ch1',
      'ch2',
    ]);
  });

  it('adds risk only when the review has an assessment', () => {
    const assessed = sectionsOf(
      review({
        riskAssessment: { score: 3, summary: 'Moderate', rationale: '', factors: [] },
      }),
    );
    expect(assessed.map((section) => section.id)).toEqual([
      SUMMARY_SECTION_ID,
      RISK_SECTION_ID,
      'ch1',
      'ch2',
    ]);
    // An empty risk page says less than no link to one.
    expect(sectionsOf(review()).some((section) => section.kind === 'risk')).toBe(false);
  });

  it('numbers chapters past a risk section rather than counting it', () => {
    const sections = sectionsOf(
      review({ riskAssessment: { score: 1, summary: 'Minimal', rationale: '', factors: [] } }),
    );
    expect(sections.map((section) => section.chapterNumber)).toEqual([null, null, 1, 2]);
  });

  it('ends with "Not discussed" only when a chapter left a hunk uncited', () => {
    const hunk = {
      id: 'H0001',
      fileOrder: 1,
      original: { startLine: 1, lineCount: 1 },
      modified: { startLine: 1, lineCount: 1 },
    };
    const files = [
      {
        filename: 'src/a.ts',
        status: 'modified' as const,
        additions: 1,
        deletions: 1,
        hunks: [hunk],
      },
    ];

    const leftOut = sectionsOf(review({ files }));
    expect(leftOut.at(-1)).toMatchObject({
      id: UNDISCUSSED_SECTION_ID,
      kind: 'undiscussed',
      label: 'Not discussed',
      chapterNumber: null,
    });

    const cited = sectionsOf(
      review({
        files,
        chapters: [
          {
            id: 'ch1',
            title: 'One',
            insights: [],
            diffChunks: [{ filename: 'src/a.ts', language: 'typescript', hunks: [hunk] }],
          },
        ],
      }),
    );
    expect(cited.some((section) => section.kind === 'undiscussed')).toBe(false);
    // No catalog at all, so there is nothing a backstop could report on.
    expect(sectionsOf(review()).some((section) => section.kind === 'undiscussed')).toBe(false);
  });

  it('reports which sections carry a diagram', () => {
    const sections = sectionsOf(
      review({
        overviewDiagram: REAL_ARCHITECTURE,
        chapters: [
          { id: 'ch1', title: 'One', insights: [], diffChunks: [], diagram: HAND_BEFORE_AFTER },
          { id: 'ch2', title: 'Two', insights: [], diffChunks: [] },
        ],
      }),
    );
    expect(sections.map((section) => section.hasDiagram)).toEqual([true, true, false]);
  });
});

describe('findSection', () => {
  const sections = sectionsOf(review());

  it('finds a section by id', () => {
    expect(findSection(sections, 'ch2')?.label).toBe('Two');
  });

  it('returns null for an id this review does not have', () => {
    // A hand-typed `?ch=`, or one carried over from a different review.
    expect(findSection(sections, 'ch9')).toBeNull();
    expect(findSection(sections, RISK_SECTION_ID)).toBeNull();
    expect(findSection(sections, null)).toBeNull();
  });
});
