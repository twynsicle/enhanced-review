import type { Insight, InsightType } from '@enhanced-review/review-types';
import { cn } from '@/lib/utils';

interface InsightTone {
  label: string;
  classes: string;
}

const TYPE_TONE: Record<InsightType, InsightTone> = {
  context: {
    label: 'Context worth knowing',
    classes: 'border-iris bg-iris-soft text-iris',
  },
  rationale: {
    label: 'Why this matters',
    classes: 'border-add bg-add/10 text-add',
  },
  highlight: {
    label: 'Worth flagging',
    classes: 'border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  },
  reference: {
    label: 'For reference',
    classes: 'border-sky-500 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  },
};

/**
 * Compact insight callout. Colour carries the insight category while the
 * body stays small enough to sit near code without dominating the page.
 */
export function InsightCallout({ insight }: { insight: Insight }) {
  const tone = TYPE_TONE[insight.type] ?? TYPE_TONE.context;
  return (
    <aside className={cn('flex flex-col gap-2 rounded-lg border-l-2 px-4 py-3.5', tone.classes)}>
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em]">{tone.label}</span>
      <p className="text-[14px] leading-[1.5] text-foreground/85">{insight.text}</p>
    </aside>
  );
}
