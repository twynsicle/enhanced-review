'use client';

import type { RepoSummary } from '@enhanced-review/github-client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { fetchGithub } from '@/lib/github/fetcher';

const PAGE_SIZE = 100;

interface ApiResponse {
  repos: RepoSummary[];
}

export function RepoList() {
  const [repos, setRepos] = useState<RepoSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchGithub<ApiResponse>('/api/github/repos')
      .then((data) => {
        if (!cancelled) setRepos(data.repos);
      })
      .catch((err) => {
        if (!cancelled && err?.status !== 401) {
          setError(err instanceof Error ? err.message : 'Failed to load repos');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!repos) return null;
    const q = filter.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) || (r.description?.toLowerCase().includes(q) ?? false),
    );
  }, [repos, filter]);

  if (error) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive">{error}</CardContent>
      </Card>
    );
  }

  if (!repos || !filtered) {
    return <SkeletonList />;
  }

  return (
    <div className="flex flex-col gap-4">
      <FilterInput
        value={filter}
        onChange={setFilter}
        count={filtered.length}
        total={repos.length}
      />
      {repos.length === 0 ? (
        <Empty>No repos accessible to your GitHub account.</Empty>
      ) : filtered.length === 0 ? (
        <Empty>No repos match &ldquo;{filter}&rdquo;.</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((repo) => (
            <li key={repo.fullName}>
              <RepoRow repo={repo} />
            </li>
          ))}
        </ul>
      )}
      {repos.length === PAGE_SIZE && (
        <p className="text-xs text-muted-foreground">
          Showing the first {PAGE_SIZE} most-recently-pushed repos. Refine with the filter above if
          yours isn&apos;t here.
        </p>
      )}
    </div>
  );
}

function FilterInput({
  value,
  onChange,
  count,
  total,
}: {
  value: string;
  onChange: (next: string) => void;
  count: number;
  total: number;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Filter by name or description"
        aria-label="Filter repos"
        className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {count}/{total}
      </span>
    </div>
  );
}

function RepoRow({ repo }: { repo: RepoSummary }) {
  return (
    <Link
      href={`/picker/${repo.owner}/${repo.name}`}
      className="block rounded-lg ring-1 ring-foreground/10 bg-card px-4 py-3 transition-colors hover:bg-muted/50"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">{repo.fullName}</span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {repo.private && <span className="rounded bg-muted px-1.5 py-0.5">private</span>}
          {repo.fork && <span className="rounded bg-muted px-1.5 py-0.5">fork</span>}
          {repo.archived && <span className="rounded bg-muted px-1.5 py-0.5">archived</span>}
          {repo.pushedAt && <span>pushed {timeAgo(repo.pushedAt)}</span>}
        </span>
      </div>
      {repo.description && (
        <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{repo.description}</p>
      )}
    </Link>
  );
}

function SkeletonList() {
  return (
    <ul className="flex flex-col gap-2" aria-busy="true">
      {Array.from({ length: 6 }).map((_, i) => (
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

/**
 * Coarse "x ago" formatter. Good enough for a list view; the detail
 * page shows full timestamps when needed.
 */
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
