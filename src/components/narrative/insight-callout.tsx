import type { Insight, InsightType } from '@enhanced-review/review-types';
import { cn } from '@/lib/utils';

interface InsightTone {
  label: string;
  /** One-character mark / emoji for the eyebrow. */
  glyph: string;
}

const TYPE_TONE: Record<InsightType, InsightTone> = {
  context: { label: 'Context worth knowing', glyph: '◇' },
  rationale: { label: 'Why this matters', glyph: '✦' },
  highlight: { label: 'Worth flagging', glyph: '⚠' },
  reference: { label: 'For reference', glyph: '↗' },
};

/**
 * Pull-quote insight callout. Iris-soft background with a left-aligned
 * iris bar; eyebrow + serif body to read like a magazine sidebar.
 */
export function InsightCallout({ insight }: { insight: Insight }) {
  const tone = TYPE_TONE[insight.type];
  return (
    <aside
      className={cn('flex flex-col gap-2 rounded-xl border-l-2 border-iris bg-iris-soft px-6 py-5')}
    >
      <span className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-iris">
        {tone.glyph} {tone.label}
      </span>
      <p className="font-serif text-[18px] font-medium leading-[1.4] text-iris-ink">
        {insight.text}
      </p>
    </aside>
  );
}
