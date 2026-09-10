import {
  RISK_SECTION_ID,
  SUMMARY_SECTION_ID,
  type NarrativeReview,
} from '@/domain/review/narrative';

/**
 * The reader's sections, in the one order the sidebar shows and the keyboard
 * walks.
 *
 * The reader used to be modelled as "chapters, plus a special case called the
 * summary": the sidebar hardcoded a `00 Summary` row and the keyboard hook
 * carried an `isSummary` branch through every binding. That held for one
 * synthesised section and fell over at two — and it was already inconsistent,
 * since the summary sat first in the sidebar but last in the arrow-key cycle.
 * One ordered list, derived here, is what both consume instead.
 */
export type SectionKind = 'summary' | 'risk' | 'chapter';

export interface ReaderSection {
  id: string;
  kind: SectionKind;
  /** Sidebar label. */
  label: string;
  /** 1-based position among chapters; null for a synthesised section. */
  chapterNumber: number | null;
  /** Whether this section draws a diagram, so the sidebar can say so. */
  hasDiagram: boolean;
}

export function readerSections(review: NarrativeReview): ReaderSection[] {
  const sections: ReaderSection[] = [
    {
      id: SUMMARY_SECTION_ID,
      kind: 'summary',
      label: 'Summary',
      chapterNumber: null,
      hasDiagram: review.overviewDiagram !== undefined,
    },
  ];

  // No assessment, no section — an empty risk page says less than no link to it.
  if (review.riskAssessment) {
    sections.push({
      id: RISK_SECTION_ID,
      kind: 'risk',
      label: 'Risk',
      chapterNumber: null,
      hasDiagram: false,
    });
  }

  review.chapters.forEach((chapter, index) => {
    sections.push({
      id: chapter.id,
      kind: 'chapter',
      label: chapter.title,
      chapterNumber: index + 1,
      hasDiagram: chapter.diagram !== undefined,
    });
  });

  return sections;
}

/** The section a `?ch=` value names, or null when it names nothing here. */
export function findSection(
  sections: readonly ReaderSection[],
  id: string | null,
): ReaderSection | null {
  if (id === null) return null;
  return sections.find((section) => section.id === id) ?? null;
}
