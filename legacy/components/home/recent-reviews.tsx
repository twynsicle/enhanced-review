import Link from 'next/link';
import { RiskScorePill } from '@/components/narrative/risk-score';
import { Sparkline } from '@/components/ui/sparkline';
import type { ReviewJobRow } from '@/lib/jobs/types';
import { logger } from '@/lib/log';
import { getCurrentUser, pbServer } from '@/lib/pb';
import { timeAgo } from '@/lib/time-ago';
import { cn } from '@/lib/utils';

const RECENT_LIMIT = 5;

/**
 * 14-day review activity, used by the sparkline. We bucket each row's
 * `created` timestamp into one of 14 day-buckets ending today.
 */
function buildSparklineBuckets(rows: ReviewJobRow[]): number[] {
  const buckets = new Array<number>(14).fill(0);
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  for (const row of rows) {
    const t = new Date(row.created).getTime();
    if (Number.isNaN(t)) continue;
    const daysAgo = Math.floor((now - t) / dayMs);
    if (daysAgo < 0 || daysAgo > 13) continue;
    buckets[13 - daysAgo] += 1;
  }
  return buckets;
}

export async function RecentReviews() {
  const user = await getCurrentUser();
  if (!user) return null;

  let jobs: ReviewJobRow[] = [];
  let activity: ReviewJobRow[] = [];
  try {
    const pb = await pbServer();
    const [recent, twoWeeks] = await Promise.all([
      pb.collection('review_jobs').getList<ReviewJobRow>(1, RECENT_LIMIT, {
        sort: '-created',
      }),
      pb.collection('review_jobs').getList<ReviewJobRow>(1, 200, {
        sort: '-created',
        // Keep payload small — only the timestamp matters for the sparkline.
        fields: 'id,created',
      }),
    ]);
    jobs = recent.items;
    activity = twoWeeks.items;
  } catch (err) {
    logger.error({ err, user_id: user.id }, '[recent-reviews] fetch failed');
  }

  const sparklineData = buildSparklineBuckets(activity);

  return (
    <section aria-label="Recent reviews" className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-[20px] font-semibold tracking-[-0.01em]">Recent</h2>
        <span className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
          <Sparkline
            data={sparklineData}
            color="var(--iris)"
            width={64}
            height={20}
            fill
            ariaLabel="Past 14 days of review activity"
          />
          <span>past 14 days</span>
        </span>
      </div>
      {jobs.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          No reviews yet — pick a target above and start your first one.
        </p>
      ) : (
        <ul className="flex flex-col">
          {jobs.map((job, i) => (
            <li key={job.id}>
              <RecentRow job={job} first={i === 0} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RecentRow({ job, first }: { job: ReviewJobRow; first: boolean }) {
  const target = job.target;
  const href = job.status === 'done' ? `/reviews/${job.id}` : `/jobs/${job.id}`;
  const title = target.kind === 'pr' ? target.title : target.ref;
  const sub = `${target.owner}/${target.repo} · @${job.github_login} · ${job.head_sha.slice(0, 7)} · ${timeAgo(job.created)}`;

  return (
    <Link
      href={href}
      className={cn(
        'group grid items-center gap-4 py-3 transition-colors hover:bg-muted/40',
        !first && 'border-t border-border',
      )}
      style={{ gridTemplateColumns: '28px minmax(0,1fr) auto auto' }}
    >
      {/* Avatar via github.com/{login}.png — public, browser-cached, no API call. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://github.com/${job.github_login}.png?size=64`}
        alt=""
        width={26}
        height={26}
        className="size-[26px] rounded-full"
        loading="lazy"
      />
      <div className="min-w-0">
        <p className="truncate font-serif text-[15px] font-medium tracking-[-0.005em] group-hover:text-iris">
          {title}
        </p>
        <p className="truncate text-[11.5px] text-muted-foreground">{sub}</p>
      </div>
      {job.status === 'done' ? (
        <RiskScorePill score={job.risk_score} showLabel={false} />
      ) : (
        <span className="hidden font-mono text-[11px] text-subtle sm:inline">
          {describeStatus(job.status)}
        </span>
      )}
      <StatusPill status={job.status} />
    </Link>
  );
}

const STATUS_TONE: Record<ReviewJobRow['status'], string> = {
  pending: 'bg-muted text-muted-foreground',
  running: 'bg-iris-soft text-iris',
  done: 'bg-iris-soft text-iris',
  error: 'bg-destructive/15 text-destructive',
  cancelled: 'bg-muted text-muted-foreground',
};

function StatusPill({ status }: { status: ReviewJobRow['status'] }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.1em]',
        STATUS_TONE[status],
      )}
    >
      {status}
    </span>
  );
}

function describeStatus(status: ReviewJobRow['status']): string {
  if (status === 'running' || status === 'pending') return 'in progress';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'error') return 'errored';
  return '';
}
