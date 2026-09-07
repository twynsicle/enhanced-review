import type { PullReviewer, ReviewerState } from '@/lib/github/view-time';
import { BrandMark } from '@/components/topbar/brand-mark';
import { cn } from '@/lib/utils';

export interface AuthorRowData {
  login: string;
  avatarUrl: string;
}

export interface AiReviewerData {
  durationMs: number | null;
  insightCount: number;
}

interface PeopleCardProps {
  author: AuthorRowData;
  reviewers: PullReviewer[];
  aiReviewer: AiReviewerData;
}

export function PeopleCard({ author, reviewers, aiReviewer }: PeopleCardProps) {
  const showAiReviewer = aiReviewer.durationMs !== null || aiReviewer.insightCount > 0;
  const sortedReviewers = [...reviewers].sort(reviewerSort);

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
      <p className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-subtle">People</p>

      <dl className="flex flex-col gap-3 text-[13px]">
        <Row label="Author">
          <Person
            avatarUrl={author.avatarUrl}
            primary={`@${author.login}`}
            primaryAlt={author.login}
          />
        </Row>

        {sortedReviewers.length > 0 && (
          <Row label="Reviewers" align="start">
            <ul className="flex min-w-0 flex-col gap-2">
              {sortedReviewers.map((reviewer) => (
                <li key={reviewer.login}>
                  <Person
                    avatarUrl={reviewer.avatarUrl}
                    primary={`@${reviewer.login}`}
                    primaryAlt={reviewer.login}
                    secondary={
                      <span className="inline-flex items-center gap-1.5">
                        <span className={cn('font-medium', reviewerStateTone(reviewer.state))}>
                          {reviewerStateLabel(reviewer.state)}
                        </span>
                        {reviewer.submittedAt && (
                          <>
                            <span aria-hidden className="text-subtle">
                              ·
                            </span>
                            <span>{formatRelativeTime(reviewer.submittedAt)}</span>
                          </>
                        )}
                      </span>
                    }
                  />
                </li>
              ))}
            </ul>
          </Row>
        )}

        {showAiReviewer && (
          <Row label="AI reviewer">
            <div className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-background"
              >
                <BrandMark size={14} />
              </span>
              <div className="flex min-w-0 flex-col leading-tight">
                <span className="truncate font-medium text-foreground">@enhanced-review</span>
                <span className="truncate text-[12px] text-muted-foreground">
                  {formatAiSubLine(aiReviewer)}
                </span>
              </div>
            </div>
          </Row>
        )}
      </dl>
    </section>
  );
}

function Row({
  label,
  children,
  align = 'center',
}: {
  label: string;
  children: React.ReactNode;
  align?: 'center' | 'start';
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3',
        align === 'start' ? 'items-start' : 'items-center',
      )}
    >
      <dt
        className={cn(
          'text-[10.5px] font-medium uppercase tracking-[0.16em] text-subtle',
          align === 'start' && 'pt-1',
        )}
      >
        {label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function Person({
  avatarUrl,
  primary,
  primaryAlt,
  secondary,
}: {
  avatarUrl: string | null;
  primary: string;
  primaryAlt: string;
  secondary?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt=""
          className="size-6 shrink-0 rounded-full"
          width={24}
          height={24}
          loading="lazy"
        />
      ) : (
        <span
          aria-hidden
          className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-[10px] font-semibold uppercase text-muted-foreground"
        >
          {primaryAlt.slice(0, 1)}
        </span>
      )}
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="truncate font-medium text-foreground">{primary}</span>
        {secondary && (
          <span className="truncate text-[12px] text-muted-foreground">{secondary}</span>
        )}
      </div>
    </div>
  );
}

function reviewerStateLabel(state: ReviewerState): string {
  switch (state) {
    case 'approved':
      return 'approved';
    case 'changes_requested':
      return 'requested changes';
    case 'commented':
      return 'commented';
    case 'pending':
      return 'requested';
  }
}

function reviewerStateTone(state: ReviewerState): string {
  switch (state) {
    case 'approved':
      return 'text-praise';
    case 'changes_requested':
      return 'text-risk';
    case 'commented':
      return 'text-muted-foreground';
    case 'pending':
      return 'text-suggestion';
  }
}

const STATE_ORDER: Record<ReviewerState, number> = {
  changes_requested: 0,
  pending: 1,
  commented: 2,
  approved: 3,
};

function reviewerSort(a: PullReviewer, b: PullReviewer): number {
  const order = STATE_ORDER[a.state] - STATE_ORDER[b.state];
  if (order !== 0) return order;
  return a.login.localeCompare(b.login);
}

const RELATIVE_THRESHOLDS: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: 'week', ms: 7 * 24 * 60 * 60 * 1000 },
  { unit: 'day', ms: 24 * 60 * 60 * 1000 },
  { unit: 'hour', ms: 60 * 60 * 1000 },
  { unit: 'minute', ms: 60 * 1000 },
];

function formatRelativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const diffMs = then - Date.now();
  const absMs = Math.abs(diffMs);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const { unit, ms } of RELATIVE_THRESHOLDS) {
    if (absMs >= ms) {
      const value = Math.round(diffMs / ms);
      return formatter.format(value, unit);
    }
  }
  return 'just now';
}

function formatAiSubLine({ durationMs, insightCount }: AiReviewerData): string {
  const insightWord = insightCount === 1 ? 'insight' : 'insights';
  const insightStr = `${String(insightCount)} ${insightWord}`;
  if (durationMs === null || durationMs <= 0) return insightStr;
  return `finished in ${formatDuration(durationMs)} · ${insightStr}`;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${String(totalSeconds)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (seconds === 0) return `${String(minutes)}m`;
  return `${String(minutes)}m ${String(seconds)}s`;
}
