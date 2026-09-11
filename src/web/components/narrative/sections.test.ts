import { describe, expect, it } from 'vitest';
import {
  RISK_SECTION_ID,
  SUMMARY_SECTION_ID,
  type NarrativeReview,
} from '@/domain/review/narrative';
import { HAND_BEFORE_AFTER, REAL_ARCHITECTURE } from '@/web/test/diagram-fixtures';
import { findSection, readerSections } from './sections';

function review(overrides: Partial<NarrativeReview> = {}): NarrativeReview {
  return {
    prTitle: 'A change',
    overviewSummary: 'It changes things.',
    chapters: [
      { id: 'ch1', title: 'One', insights: [], diffChunks: [] },
      { id: 'ch2', title: 'Two', insights: [], diffChunks: [] },
    ],
    ...overrides,
  };
}

describe('readerSections', () => {
  it('puts the summary first and the chapters last, in order', () => {
    expect(readerSections(review()).map((section) => section.id)).toEqual([
      SUMMARY_SECTION_ID,
      'ch1',
      'ch2',
    ]);
  });

  it('adds risk only when the review has an assessment', () => {
    const assessed = readerSections(
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
    expect(readerSections(review()).some((section) => section.kind === 'risk')).toBe(false);
  });

  it('numbers chapters past a risk section rather than counting it', () => {
    const sections = readerSections(
      review({ riskAssessment: { score: 1, summary: 'Minimal', rationale: '', factors: [] } }),
    );
    expect(sections.map((section) => section.chapterNumber)).toEqual([null, null, 1, 2]);
  });

  it('reports which sections carry a diagram', () => {
    const sections = readerSections(
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
  const sections = readerSections(review());

  it('finds a section by id', () => {
    expect(findSection(sections, 'ch2')?.label).toBe('Two');
  });

  it('returns null for an id this review does not have', () => {
    // A `?ch=` from an older review, or a hand-typed one.
    expect(findSection(sections, 'ch9')).toBeNull();
    expect(findSection(sections, RISK_SECTION_ID)).toBeNull();
    expect(findSection(sections, null)).toBeNull();
  });
});
