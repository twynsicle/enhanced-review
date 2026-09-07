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

/** mint → mint → amber → coral → coral; mirrors the design's `T` ramp. */
const RAMP: Record<ReviewRiskScore, string> = {
  1: 'var(--praise)',
  2: 'var(--praise)',
  3: 'var(--suggestion)',
  4: 'var(--risk)',
  5: 'var(--risk)',
};

/**
 * Compact 1–5 bar meter with caption. Mirrors the `RiskMeter` glyph
 * from the design. `size="lg"` is used in the summary hero panel; the
 * default is small enough to sit inline with row content.
 */
export function RiskScoreBars({
  score,
  size = 'md',
  className,
  hideLabel = false,
}: {
  score: number | null | undefined;
  size?: 'md' | 'lg';
  className?: string;
  /** Render only the bars — caller renders the label separately. */
  hideLabel?: boolean;
}) {
  const normalized = normalizeRiskScore(score);
  if (normalized === null) return null;
  const tint = RAMP[normalized];
  const isLg = size === 'lg';
  return (
    <div
      className={cn('flex items-center gap-2', className)}
      title={`Risk ${String(normalized)} of 5: ${riskLabel(normalized)}`}
    >
      <span aria-hidden className="flex items-end gap-0.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className="rounded-[1px]"
            style={{
              width: isLg ? 6 : 4,
              height: isLg ? 6 + i * 4 : 4 + i * 2,
              background: i <= normalized ? tint : 'var(--border)',
              opacity: i <= normalized ? 1 : 0.7,
            }}
          />
        ))}
      </span>
      {!hideLabel && (
        <span
          className={cn('font-medium', isLg ? 'text-[13px] font-semibold' : 'text-[11px]')}
          style={{ color: tint }}
        >
          Risk · {normalized}/5 · {riskLabel(normalized)}
        </span>
      )}
    </div>
  );
}

/**
 * Just the "3/5 · Moderate" caption, coloured by the same ramp.
 * Used inline next to other layout elements (e.g. sidebar risk card)
 * where the caller wants to control the surrounding structure.
 */
export function RiskInlineLabel({
  score,
  className,
}: {
  score: number | null | undefined;
  className?: string;
}) {
  const normalized = normalizeRiskScore(score);
  if (normalized === null) return null;
  return (
    <span
      className={cn('text-[12px] font-semibold', className)}
      style={{ color: RAMP[normalized] }}
    >
      {normalized}/5 · {riskLabel(normalized)}
    </span>
  );
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

export interface RiskSummaryStat {
  label: string;
  value: string | number;
  sub?: string;
}

export function RiskSummaryPanel({
  assessment,
  stats,
}: {
  assessment?: ReviewRiskAssessment;
  stats?: RiskSummaryStat[];
}) {
  if (!assessment) return null;

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-subtle">
          Risk rating
        </p>
        <span className="font-mono text-[10.5px] text-subtle">computed by reviewer</span>
      </div>

      <RiskScoreBars score={assessment.score} size="lg" />

      <h2 className="font-serif text-[18px] font-semibold leading-snug tracking-[-0.005em] text-pretty">
        {assessment.summary}
      </h2>

      {assessment.rationale.trim().length > 0 && (
        <p className="max-w-[82ch] text-[13.5px] leading-[1.6] text-muted-foreground text-pretty">
          {assessment.rationale}
        </p>
      )}

      {stats && stats.length > 0 && (
        <dl className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
          {stats.map((stat) => (
            <div key={stat.label} className="min-w-0">
              <dt className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-subtle">
                {stat.label}
              </dt>
              <dd className="mt-1 font-serif text-[28px] font-semibold leading-none">
                {stat.value}
              </dd>
              {stat.sub && <dd className="mt-1 text-[12px] text-muted-foreground">{stat.sub}</dd>}
            </div>
          ))}
        </dl>
      )}

      {assessment.factors.length > 0 && (
        <details className="group border-t border-border pt-4">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-[10.5px] font-medium uppercase tracking-[0.16em] text-subtle outline-none transition-colors hover:text-foreground focus-visible:text-foreground [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
              ▸
            </span>
            <span className="group-open:hidden">Show breakdown</span>
            <span className="hidden group-open:inline">Hide breakdown</span>
          </summary>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
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
        </details>
      )}
    </section>
  );
}

function riskTone(score: ReviewRiskScore): string {
  if (score <= 2) return 'border-praise/40 bg-praise-soft text-praise';
  if (score === 3) return 'border-suggestion/40 bg-suggestion-soft text-suggestion';
  return 'border-risk/40 bg-risk-soft text-risk';
}

function factorTone(impact: ReviewRiskFactorImpact): string {
  if (impact === 'raises') return 'bg-risk';
  if (impact === 'lowers') return 'bg-praise';
  return 'bg-muted-foreground';
}
