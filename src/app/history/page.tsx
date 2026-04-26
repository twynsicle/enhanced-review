import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { describeTarget, type ReviewJobRow } from '@/lib/jobs/types';
import { logger } from '@/lib/log';
import { getCurrentUser, pbServer } from '@/lib/pb';

/**
 * `/history` — workspace-wide list of review jobs (yours + every beta
 * member's). PB collection rules allow any authenticated user to list
 * `review_jobs`, so the page reads through the user-scoped client; the
 * displayed `github_login` and `target` columns are denormalised on
 * each row so we don't need joins here.
 */
export const dynamic = 'force-dynamic';

const ALL_STATUSES = ['pending', 'running', 'done', 'cancelled', 'error'] as const;
type StatusFilter = (typeof ALL_STATUSES)[number] | 'all';

const PAGE_SIZE = 100;

function parseStatus(raw: string | string[] | undefined): StatusFilter {
  if (typeof raw !== 'string') return 'all';
  return (ALL_STATUSES as readonly string[]).includes(raw) ? (raw as StatusFilter) : 'all';
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const status = parseStatus(params.status);

  const user = await getCurrentUser();
  if (!user) redirect('/login');

  let rows: ReviewJobRow[] = [];
  try {
    const pb = await pbServer();
    const result = await pb.collection('review_jobs').getList<ReviewJobRow>(1, PAGE_SIZE, {
      filter: status === 'all' ? '' : `status = "${status}"`,
      sort: '-created',
    });
    rows = result.items;
  } catch (err) {
    logger.error({ err, user_id: user.id }, '[history] fetch failed');
  }

  return (
    <main className="mx-auto flex min-h-full w-full max-w-4xl flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-2">
        <div className="text-xs text-muted-foreground">
          <Link href="/" className="hover:underline">
            ← Start a review
          </Link>
        </div>
        <h1 className="text-xl font-semibold">Review history</h1>
      </header>

      <FilterChips current={status} />

      {rows.length === 0 ? (
        <EmptyState status={status} />
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((job) => (
            <li key={job.id}>
              <JobRow job={job} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function FilterChips({ current }: { current: StatusFilter }) {
  const options: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'all' },
    ...ALL_STATUSES.map((s) => ({ value: s, label: s })),
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = current === opt.value;
        const href = opt.value === 'all' ? '/history' : `/history?status=${opt.value}`;
        return (
          <Link
            key={opt.value}
            href={href}
            aria-pressed={active}
            className={
              'rounded-full px-3 py-1 text-xs ring-1 transition-colors ' +
              (active
                ? 'ring-primary bg-primary/15 text-primary'
                : 'ring-foreground/10 bg-card text-muted-foreground hover:bg-muted/50')
            }
          >
            {opt.label}
          </Link>
        );
      })}
    </div>
  );
}

function JobRow({ job }: { job: ReviewJobRow }) {
  const target = describeTarget(job.target);
  // Done jobs link straight to the rendered reader; anything else lands
  // on the live job view (which itself has a "View rendered review →"
  // CTA when status flips).
  const href = job.status === 'done' ? `/reviews/${job.id}` : `/jobs/${job.id}`;
  return (
    <Link
      href={href}
      className="block rounded-lg ring-1 ring-foreground/10 bg-card px-4 py-3 transition-colors hover:bg-muted/50"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-sm break-all">{target}</span>
        <StatusBadge status={job.status} />
      </div>
      <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          {/* Avatar via github.com/{login}.png — public, browser-cached, no API call. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://github.com/${job.github_login}.png?size=32`}
            alt=""
            width={16}
            height={16}
            className="size-4 rounded-full"
            loading="lazy"
          />
          <span>@{job.github_login}</span>
        </span>
        <span>·</span>
        <span>{timeAgo(job.created)}</span>
        <span>·</span>
        <code className="rounded bg-muted px-1 py-0.5">{job.head_sha.slice(0, 7)}</code>
      </div>
    </Link>
  );
}

function StatusBadge({ status }: { status: ReviewJobRow['status'] }) {
  const styles: Record<ReviewJobRow['status'], string> = {
    pending: 'bg-muted text-muted-foreground',
    running: 'bg-primary/15 text-primary',
    done: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    error: 'bg-destructive/15 text-destructive',
    cancelled: 'bg-muted text-muted-foreground',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${styles[status]}`}
    >
      {status}
    </span>
  );
}

function EmptyState({ status }: { status: StatusFilter }) {
  if (status !== 'all') {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No reviews with status <code className="rounded bg-muted px-1 py-0.5">{status}</code>.{' '}
          <Link href="/history" className="font-medium text-foreground hover:underline">
            Show all →
          </Link>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <div
          aria-hidden
          className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-2xl"
        >
          📝
        </div>
        <div className="space-y-1">
          <p className="text-base font-medium">No reviews yet</p>
          <p className="text-sm text-muted-foreground">
            Pick a repo, choose a PR or branch, and we&apos;ll generate a narrative review.
          </p>
        </div>
        <Link
          href="/"
          className="mt-1 inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Start a review →
        </Link>
      </CardContent>
    </Card>
  );
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffMs = Date.now() - then;
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}
