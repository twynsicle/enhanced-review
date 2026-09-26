import { RISK_SECTION_ID, SUMMARY_SECTION_ID, type NarrativeReview } from '@/review/narrative';

/**
 * The reader's sections, in the one order the sidebar shows and the keyboard
 * walks: the risk card (when there is an assessment), then the summary row,
 * then the chapters — top to bottom in the sidebar, since the risk card sits
 * above the summary and chapter rows there.
 *
 * The sidebar and the keyboard both read this one list rather than each
 * deriving an order of its own, so they cannot disagree about it.
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
  const sections: ReaderSection[] = [];

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

  sections.push({
    id: SUMMARY_SECTION_ID,
    kind: 'summary',
    label: 'Summary',
    chapterNumber: null,
    hasDiagram: review.overviewDiagram !== undefined,
  });

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

/**
 * The two ids every section card spells. They read `chapter-…` for the
 * synthesised sections too: the keyboard hook focuses `sectionHeadingId`, so
 * a card that spells its id any other way is one End and the arrows skip
 * silently.
 */
export const sectionCardId = (id: string) => `chapter-${id}`;
export const sectionHeadingId = (id: string) => `chapter-heading-${id}`;

/** The sidebar's index glyph: a chapter's number, `00` for a synthesised section. */
export function sectionIndexLabel(section: ReaderSection): string {
  if (section.chapterNumber === null) return '00';
  return section.chapterNumber.toString().padStart(2, '0');
}

/** The section a `?ch=` value names, or null when it names nothing here. */
export function findSection(
  sections: readonly ReaderSection[],
  id: string | null,
): ReaderSection | null {
  if (id === null) return null;
  return sections.find((section) => section.id === id) ?? null;
}
