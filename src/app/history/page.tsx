import Link from 'next/link';
import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { RiskScorePill } from '@/components/narrative/risk-score';
import { Topbar } from '@/components/topbar/topbar';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/auth/auth';
import { db } from '@/lib/db/client';
import { reviewJobs } from '@/lib/db/schema';
import { describeTarget, toJobRow, type ReviewJobRow } from '@/lib/jobs/types';
import { logger } from '@/lib/log';
import { cn } from '@/lib/utils';

/**
 * `/history` — workspace-wide list of review jobs (yours + every beta
 * member's). Reads via Drizzle; the displayed `github_login` and `target`
 * columns are denormalised on each row so we don't need joins here.
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

  const session = await auth();
  if (!session?.user) redirect('/login');

  let rows: ReviewJobRow[] = [];
  try {
    const where =
      status === 'all' ? undefined : eq(reviewJobs.status, status as Exclude<StatusFilter, 'all'>);
    const result = await db
      .select()
      .from(reviewJobs)
      .where(where)
      .orderBy(desc(reviewJobs.createdAt))
      .limit(PAGE_SIZE);
    rows = result.map(toJobRow);
  } catch (err) {
    logger.error({ err, user_id: session.user.id }, '[history] fetch failed');
  }

  const login = session.user.githubLogin ?? session.user.email ?? session.user.id;
  const avatarUrl = session.user.image ?? null;
  const fullName = session.user.name && session.user.name.length > 0 ? session.user.name : null;

  const isEmpty = rows.length === 0 && status === 'all';

  return (
    <>
      <Topbar user={{ login, fullName, avatarUrl }} />
      <main className="mx-auto flex min-h-full w-full max-w-4xl flex-col gap-8 px-7 py-12">
        {isEmpty ? (
          <EmptyLibrary />
        ) : (
          <>
            <header className="flex flex-col gap-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-iris">
                ❖&nbsp;&nbsp;Library
              </p>
              <h1 className="font-serif text-3xl font-semibold tracking-[-0.015em]">
                Every review, indexed.
              </h1>
            </header>

            <FilterChips current={status} />

            {rows.length === 0 ? (
              <FilteredEmpty status={status} />
            ) : (
              <ul className="flex flex-col">
                {rows.map((job, i) => (
                  <li key={job.id}>
                    <JobRow job={job} first={i === 0} />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>
    </>
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
            className={cn(
              'rounded-full px-3 py-1 text-[12px] transition-colors',
              active
                ? 'bg-iris-soft font-semibold text-iris'
                : 'border border-border bg-card text-muted-foreground hover:bg-muted/40',
            )}
          >
            {opt.label}
          </Link>
        );
      })}
    </div>
  );
}

function JobRow({ job, first }: { job: ReviewJobRow; first: boolean }) {
  const target = describeTarget(job.target);
  const href = job.status === 'done' ? `/reviews/${job.id}` : `/jobs/${job.id}`;
  return (
    <Link
      href={href}
      className={cn(
        'group grid items-center gap-4 py-3 transition-colors hover:bg-muted/40',
        !first && 'border-t border-border',
      )}
      style={{ gridTemplateColumns: '28px minmax(0,1fr) auto auto' }}
    >
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
          {target}
        </p>
        <p className="truncate text-[11.5px] text-muted-foreground">
          @{job.github_login} · {timeAgo(job.created)} · {job.head_sha.slice(0, 7)}
        </p>
      </div>
      {job.status === 'done' ? (
        <RiskScorePill score={job.risk_score} showLabel={false} />
      ) : (
        <span className="hidden font-mono text-[11px] text-subtle sm:inline" />
      )}
      <StatusBadge status={job.status} />
    </Link>
  );
}

function StatusBadge({ status }: { status: ReviewJobRow['status'] }) {
  const tone: Record<ReviewJobRow['status'], string> = {
    pending: 'bg-muted text-muted-foreground',
    running: 'bg-iris-soft text-iris',
    done: 'bg-iris-soft text-iris',
    error: 'bg-destructive/15 text-destructive',
    cancelled: 'bg-muted text-muted-foreground',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.1em]',
        tone[status],
      )}
    >
      {status}
    </span>
  );
}

function FilteredEmpty({ status }: { status: StatusFilter }) {
  return (
    <p className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
      No reviews with status <code className="rounded bg-muted px-1 py-0.5">{status}</code>.{' '}
      <Link href="/history" className="font-medium text-foreground hover:underline">
        Show all →
      </Link>
    </p>
  );
}

function EmptyLibrary() {
  return (
    <section className="mx-auto flex max-w-2xl flex-col items-center gap-6 py-24 text-center">
      <svg width="160" height="120" viewBox="0 0 160 120" aria-hidden className="text-iris">
        <rect
          x="20"
          y="10"
          width="120"
          height="92"
          rx="6"
          fill="var(--card)"
          stroke="var(--border)"
        />
        <rect x="32" y="22" width="40" height="6" rx="3" fill="currentColor" opacity="0.85" />
        <rect
          x="32"
          y="36"
          width="96"
          height="3"
          rx="1.5"
          fill="var(--muted-foreground)"
          opacity="0.45"
        />
        <rect
          x="32"
          y="44"
          width="84"
          height="3"
          rx="1.5"
          fill="var(--muted-foreground)"
          opacity="0.45"
        />
        <rect
          x="32"
          y="52"
          width="92"
          height="3"
          rx="1.5"
          fill="var(--muted-foreground)"
          opacity="0.45"
        />
        <rect x="32" y="68" width="96" height="20" rx="3" fill="var(--iris-soft)" />
        <path d="M32 68 L32 88" stroke="currentColor" strokeWidth="2" />
      </svg>
      <h2 className="font-serif text-3xl font-semibold tracking-[-0.015em]">
        The library is waiting.
      </h2>
      <p className="max-w-md text-[15px] text-muted-foreground text-pretty">
        When you start your first review, it lives here — every chapter, every insight, every diff,
        written and indexed.
      </p>
      <Button asChild className="h-9 rounded-full px-4">
        <Link href="/">Begin your first review →</Link>
      </Button>
    </section>
  );
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffMs = Date.now() - then;
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes.toString()}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours.toString()}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days.toString()}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months.toString()}mo ago`;
  return `${Math.round(months / 12).toString()}y ago`;
}
