'use client';

import type { BranchSummary, PullSummary, ReviewTarget } from '@enhanced-review/github-client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { fetchGithub } from '@/lib/github/fetcher';
import { startReview } from '@/lib/jobs/start-review';

type Tab = 'prs' | 'branches';

interface PullsResponse {
  pulls: PullSummary[];
}

interface BranchesResponse {
  defaultBranch: string;
  defaultBranchSha: string;
  branches: BranchSummary[];
  truncatedToCount: number;
}

const PR_TARGET_PREFIX = 'pr:';
const BRANCH_TARGET_PREFIX = 'branch:';

export function RepoDetail({ owner, repo }: { owner: string; repo: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const tab: Tab = searchParams.get('tab') === 'branches' ? 'branches' : 'prs';
  const targetParam = searchParams.get('target');

  const [pulls, setPulls] = useState<PullSummary[] | null>(null);
  const [pullsError, setPullsError] = useState<string | null>(null);
  const [branchesData, setBranchesData] = useState<BranchesResponse | null>(null);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [pullsFilter, setPullsFilter] = useState('');
  const [branchesFilter, setBranchesFilter] = useState('');

  // Lazy-load each tab's data the first time it's viewed.
  useEffect(() => {
    if (tab !== 'prs' || pulls !== null || pullsError !== null) return;
    let cancelled = false;
    fetchGithub<PullsResponse>(`/api/github/repos/${owner}/${repo}/pulls`)
      .then((data) => {
        if (!cancelled) setPulls(data.pulls);
      })
      .catch((err) => {
        if (!cancelled && err?.status !== 401) {
          setPullsError(err instanceof Error ? err.message : 'Failed to load PRs');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tab, owner, repo, pulls, pullsError]);

  useEffect(() => {
    if (tab !== 'branches' || branchesData !== null || branchesError !== null) return;
    let cancelled = false;
    fetchGithub<BranchesResponse>(`/api/github/repos/${owner}/${repo}/branches`)
      .then((data) => {
        if (!cancelled) setBranchesData(data);
      })
      .catch((err) => {
        if (!cancelled && err?.status !== 401) {
          setBranchesError(err instanceof Error ? err.message : 'Failed to load branches');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tab, owner, repo, branchesData, branchesError]);

  const writeQuery = useCallback(
    (next: { tab?: Tab; target?: string | null }) => {
      const sp = new URLSearchParams(searchParams.toString());
      if (next.tab) sp.set('tab', next.tab);
      if ('target' in next) {
        if (next.target === null) sp.delete('target');
        else if (next.target !== undefined) sp.set('target', next.target);
      }
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const switchTab = useCallback(
    (next: Tab) => {
      // Clear `target` if it doesn't belong to the new tab to keep URL honest.
      const isPrTarget = targetParam?.startsWith(PR_TARGET_PREFIX);
      const isBranchTarget = targetParam?.startsWith(BRANCH_TARGET_PREFIX);
      const keep =
        (next === 'prs' && isPrTarget) || (next === 'branches' && isBranchTarget)
          ? targetParam
          : null;
      writeQuery({ tab: next, target: keep });
    },
    [targetParam, writeQuery],
  );

  // Resolve URL target → full ReviewTarget, contingent on the relevant
  // list having loaded.
  const selectedTarget = useMemo<ReviewTarget | null>(() => {
    if (!targetParam) return null;
    if (targetParam.startsWith(PR_TARGET_PREFIX)) {
      const number = Number(targetParam.slice(PR_TARGET_PREFIX.length));
      const pr = pulls?.find((p) => p.number === number);
      if (!pr) return null;
      return {
        kind: 'pr',
        owner,
        repo,
        number: pr.number,
        headSha: pr.headSha,
        baseSha: pr.baseSha,
        title: pr.title,
      };
    }
    if (targetParam.startsWith(BRANCH_TARGET_PREFIX)) {
      const ref = targetParam.slice(BRANCH_TARGET_PREFIX.length);
      const branch = branchesData?.branches.find((b) => b.ref === ref);
      if (!branch || !branchesData) return null;
      return {
        kind: 'branch',
        owner,
        repo,
        ref: branch.ref,
        headSha: branch.headSha,
        baseRef: branchesData.defaultBranch,
        baseSha: branchesData.defaultBranchSha,
      };
    }
    return null;
  }, [targetParam, pulls, branchesData, owner, repo]);

  return (
    <>
      <TabBar tab={tab} onChange={switchTab} />

      {tab === 'prs' ? (
        <PullsPane
          pulls={pulls}
          error={pullsError}
          filter={pullsFilter}
          setFilter={setPullsFilter}
          selectedNumber={
            targetParam?.startsWith(PR_TARGET_PREFIX)
              ? Number(targetParam.slice(PR_TARGET_PREFIX.length))
              : null
          }
          onSelect={(pr) => writeQuery({ target: `${PR_TARGET_PREFIX}${pr.number}` })}
        />
      ) : (
        <BranchesPane
          data={branchesData}
          error={branchesError}
          filter={branchesFilter}
          setFilter={setBranchesFilter}
          selectedRef={
            targetParam?.startsWith(BRANCH_TARGET_PREFIX)
              ? targetParam.slice(BRANCH_TARGET_PREFIX.length)
              : null
          }
          onSelect={(branch) => writeQuery({ target: `${BRANCH_TARGET_PREFIX}${branch.ref}` })}
        />
      )}

      <ReviewFooter target={selectedTarget} />
    </>
  );
}

function TabBar({ tab, onChange }: { tab: Tab; onChange: (next: Tab) => void }) {
  return (
    <div className="inline-flex rounded-lg ring-1 ring-foreground/10 bg-card p-1">
      <TabButton active={tab === 'prs'} onClick={() => onChange('prs')}>
        Open PRs
      </TabButton>
      <TabButton active={tab === 'branches'} onClick={() => onChange('branches')}>
        Branches
      </TabButton>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? 'rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground'
          : 'rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted'
      }
    >
      {children}
    </button>
  );
}

function PullsPane({
  pulls,
  error,
  filter,
  setFilter,
  selectedNumber,
  onSelect,
}: {
  pulls: PullSummary[] | null;
  error: string | null;
  filter: string;
  setFilter: (next: string) => void;
  selectedNumber: number | null;
  onSelect: (pr: PullSummary) => void;
}) {
  const filtered = useMemo(() => {
    if (!pulls) return null;
    const q = filter.trim().toLowerCase();
    if (!q) return pulls;
    return pulls.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.headRef.toLowerCase().includes(q) ||
        p.authorLogin?.toLowerCase().includes(q),
    );
  }, [pulls, filter]);

  if (error) return <ErrorCard message={error} />;
  if (!pulls || !filtered) return <SkeletonRows />;

  return (
    <div className="flex flex-col gap-3">
      <SearchInput
        value={filter}
        onChange={setFilter}
        placeholder="Filter open PRs by title, branch, or author"
        ariaLabel="Filter PRs"
        count={filtered.length}
        total={pulls.length}
      />
      {pulls.length === 0 ? (
        <Empty>No open PRs in this repo.</Empty>
      ) : filtered.length === 0 ? (
        <Empty>No open PRs match &ldquo;{filter}&rdquo;.</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((pr) => (
            <li key={pr.number}>
              <PullRow
                pr={pr}
                selected={pr.number === selectedNumber}
                onSelect={() => onSelect(pr)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PullRow({
  pr,
  selected,
  onSelect,
}: {
  pr: PullSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={
        'w-full rounded-lg ring-1 px-4 py-3 text-left transition-colors ' +
        (selected ? 'ring-primary bg-primary/10' : 'ring-foreground/10 bg-card hover:bg-muted/50')
      }
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">
          <span className="text-muted-foreground tabular-nums">#{pr.number}</span> {pr.title}
        </span>
        {pr.draft && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            draft
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {pr.authorLogin ?? 'unknown'} · {pr.headRef} → {pr.baseRef}
      </p>
    </button>
  );
}

function BranchesPane({
  data,
  error,
  filter,
  setFilter,
  selectedRef,
  onSelect,
}: {
  data: BranchesResponse | null;
  error: string | null;
  filter: string;
  setFilter: (next: string) => void;
  selectedRef: string | null;
  onSelect: (branch: BranchSummary) => void;
}) {
  const filtered = useMemo(() => {
    if (!data) return null;
    const q = filter.trim().toLowerCase();
    if (!q) return data.branches;
    return data.branches.filter(
      (b) => b.ref.toLowerCase().includes(q) || b.headCommitMessage.toLowerCase().includes(q),
    );
  }, [data, filter]);

  if (error) return <ErrorCard message={error} />;
  if (!data || !filtered) return <SkeletonRows />;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Showing branches with a commit in the last 30 days · base branch{' '}
        <code className="rounded bg-muted px-1 py-0.5">{data.defaultBranch}</code>
      </p>
      <SearchInput
        value={filter}
        onChange={setFilter}
        placeholder="Filter branches by name or commit message"
        ariaLabel="Filter branches"
        count={filtered.length}
        total={data.branches.length}
      />
      {data.branches.length === 0 ? (
        <Empty>No branches active in the last 30 days.</Empty>
      ) : filtered.length === 0 ? (
        <Empty>No branches match &ldquo;{filter}&rdquo;.</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((branch) => (
            <li key={branch.ref}>
              <BranchRow
                branch={branch}
                selected={branch.ref === selectedRef}
                onSelect={() => onSelect(branch)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BranchRow({
  branch,
  selected,
  onSelect,
}: {
  branch: BranchSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={
        'w-full rounded-lg ring-1 px-4 py-3 text-left transition-colors ' +
        (selected ? 'ring-primary bg-primary/10' : 'ring-foreground/10 bg-card hover:bg-muted/50')
      }
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium font-mono text-sm">{branch.ref}</span>
        <span className="text-xs text-muted-foreground">{timeAgo(branch.headCommitDate)}</span>
      </div>
      <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{branch.headCommitMessage}</p>
    </button>
  );
}

function ReviewFooter({ target }: { target: ReviewTarget | null }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = useCallback(async () => {
    if (!target || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { id } = await startReview(target);
      router.push(`/jobs/${id}`);
    } catch (err) {
      // 401 redirects to /relink inside startReview; anything else surfaces here.
      setError(err instanceof Error ? err.message : 'Failed to start review');
      setSubmitting(false);
    }
  }, [target, submitting, router]);

  return (
    <div className="fixed inset-x-0 bottom-0 border-t bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-3">
        <div className="text-sm text-muted-foreground">
          {error ? (
            <span className="text-destructive">{error}</span>
          ) : target ? (
            <TargetSummary target={target} />
          ) : (
            'Select a PR or branch to review.'
          )}
        </div>
        <Button disabled={!target || submitting} onClick={onClick} aria-busy={submitting}>
          {submitting ? 'Starting…' : 'Review'}
        </Button>
      </div>
    </div>
  );
}

function TargetSummary({ target }: { target: ReviewTarget }) {
  if (target.kind === 'pr') {
    return (
      <span>
        Selected:{' '}
        <span className="font-medium text-foreground">
          PR #{target.number} · {target.title}
        </span>
      </span>
    );
  }
  return (
    <span>
      Selected:{' '}
      <span className="font-medium text-foreground font-mono">
        {target.ref} → {target.baseRef}
      </span>
    </span>
  );
}

function SearchInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  count,
  total,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  ariaLabel: string;
  count: number;
  total: number;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {count}/{total}
      </span>
    </div>
  );
}

function SkeletonRows() {
  return (
    <ul className="flex flex-col gap-2" aria-busy="true">
      {Array.from({ length: 5 }).map((_, i) => (
        <li key={i} className="h-[58px] rounded-lg ring-1 ring-foreground/10 bg-card" aria-hidden />
      ))}
    </ul>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="py-8 text-center text-sm text-muted-foreground">
        {children}
      </CardContent>
    </Card>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="py-6 text-sm text-destructive">{message}</CardContent>
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
  return `${days}d ago`;
}
