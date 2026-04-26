import type {
  ReviewRiskAssessment,
  ReviewRiskFactorImpact,
  ReviewRiskScore,
} from '@enhanced-review/review-types';
import { cn } from '@/lib/utils';

export function normalizeRiskScore(score: number | null | undefined): ReviewRiskScore | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  const rounded = Math.round(score);
  if (rounded < 1 || rounded > 5) return null;
  return rounded as ReviewRiskScore;
}

export function riskLabel(score: ReviewRiskScore): string {
  switch (score) {
    case 1:
      return 'Minimal';
    case 2:
      return 'Low';
    case 3:
      return 'Moderate';
    case 4:
      return 'High';
    case 5:
      return 'Critical';
  }
}

export function RiskScorePill({
  score,
  className,
  showLabel = true,
}: {
  score: number | null | undefined;
  className?: string;
  showLabel?: boolean;
}) {
  const normalized = normalizeRiskScore(score);
  if (normalized === null) return null;

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.1em]',
        riskTone(normalized),
        className,
      )}
      title={`Risk ${String(normalized)} of 5: ${riskLabel(normalized)}`}
    >
      R{normalized}
      {showLabel && (
        <span className="ml-1.5 font-sans normal-case tracking-normal">
          {riskLabel(normalized)}
        </span>
      )}
    </span>
  );
}

export function RiskSummaryPanel({ assessment }: { assessment?: ReviewRiskAssessment }) {
  if (!assessment) return null;

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-card/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-subtle">
            Risk assessment
          </p>
          <h2 className="font-serif text-[22px] font-semibold leading-tight tracking-[-0.01em]">
            {assessment.summary}
          </h2>
        </div>
        <RiskScorePill score={assessment.score} className="mt-1" />
      </div>

      {assessment.rationale.trim().length > 0 && (
        <p className="max-w-[82ch] text-[14px] leading-[1.6] text-muted-foreground text-pretty">
          {assessment.rationale}
        </p>
      )}

      {assessment.factors.length > 0 && (
        <dl className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
          {assessment.factors.map((factor, index) => (
            <div key={`${factor.name}-${index.toString()}`} className="min-w-0">
              <dt className="flex items-center gap-2 text-[12px] font-semibold text-foreground">
                <span className={cn('size-1.5 rounded-full', factorTone(factor.impact))} />
                <span className="truncate">{factor.name}</span>
              </dt>
              <dd className="mt-1 text-[12.5px] leading-[1.5] text-muted-foreground">
                {factor.detail}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function riskTone(score: ReviewRiskScore): string {
  if (score <= 2)
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (score === 3) return 'border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-300';
  if (score === 4)
    return 'border-orange-500/35 bg-orange-500/10 text-orange-800 dark:text-orange-300';
  return 'border-destructive/35 bg-destructive/10 text-destructive';
}

function factorTone(impact: ReviewRiskFactorImpact): string {
  if (impact === 'raises') return 'bg-orange-500';
  if (impact === 'lowers') return 'bg-emerald-500';
  return 'bg-muted-foreground';
}
