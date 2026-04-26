import type { Insight, InsightType } from '@enhanced-review/review-types';

const TYPE_LABELS: Record<InsightType, string> = {
  context: 'CONTEXT',
  rationale: 'RATIONALE',
  highlight: 'HIGHLIGHT',
  reference: 'REFERENCE',
};

const TYPE_STYLES: Record<InsightType, string> = {
  context: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-sky-500/30',
  rationale: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/30',
  highlight: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30',
  reference: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-violet-500/30',
};

export function InsightCallout({ insight }: { insight: Insight }) {
  return (
    <aside
      className={`rounded-md p-3 ring-1 ring-inset text-sm leading-relaxed ${TYPE_STYLES[insight.type]}`}
    >
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide opacity-80">
        {TYPE_LABELS[insight.type]}
      </div>
      <div className="text-foreground">{insight.text}</div>
    </aside>
  );
}
