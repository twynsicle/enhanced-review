import type { Insight, InsightType } from '@enhanced-review/review-types';
import { cn } from '@/lib/utils';

interface InsightTone {
  label: string;
  /** Tailwind class for the colored left rail. */
  rail: string;
  /** Tailwind class for the eyebrow label tint. */
  eyebrow: string;
}

/**
 * Color-coded by kind: highlight reads as risk (coral), rationale as
 * praise (mint), reference as suggestion (amber), context as question
 * (cobalt). The kind shows as a 3px solid left rail in the accent hue
 * — editorial marginalia, sitting directly on the page background with
 * no card chrome of its own.
 */
const TYPE_TONE: Record<InsightType, InsightTone> = {
  context: { label: 'Context', rail: 'border-question', eyebrow: 'text-question' },
  rationale: { label: 'Praise', rail: 'border-praise', eyebrow: 'text-praise' },
  highlight: { label: 'Risk', rail: 'border-risk', eyebrow: 'text-risk' },
  reference: { label: 'Suggestion', rail: 'border-suggestion', eyebrow: 'text-suggestion' },
};

export function InsightCallout({ insight }: { insight: Insight }) {
  const tone = TYPE_TONE[insight.type] ?? TYPE_TONE.context;
  const hasTitle = typeof insight.title === 'string' && insight.title.trim().length > 0;
  return (
    <aside className={cn('flex flex-col gap-2 border-l-[3px] pr-2 pl-5', tone.rail)}>
      <span className={cn('text-[10.5px] font-semibold uppercase tracking-[0.14em]', tone.eyebrow)}>
        {tone.label}
      </span>
      {hasTitle && (
        <h3 className="text-[15px] font-semibold leading-snug text-foreground text-pretty">
          {insight.title}
        </h3>
      )}
      <p className="text-[13.5px] leading-[1.55] text-foreground/80 text-pretty">{insight.text}</p>
    </aside>
  );
}
