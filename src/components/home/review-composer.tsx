'use client';

import type {
  BranchSummary,
  PullSummary,
  RepoSummary,
  ReviewTarget,
} from '@enhanced-review/github-client';
import { ArrowRight, GitBranch, GitPullRequest, Lock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { toast } from '@/hooks/use-toast';
import { fetchGithub } from '@/lib/github/fetcher';
import {
  clearLastBranch,
  clearLastPull,
  clearLastTarget,
  readLastTarget,
  writeLastBranch,
  writeLastKind,
  writeLastPull,
  writeLastRepo,
} from '@/lib/jobs/last-target';
import { JobInFlightError, startReview } from '@/lib/jobs/start-review';
import { cn } from '@/lib/utils';

type Kind = 'pr' | 'branch';

interface ReposResponse {
  repos: RepoSummary[];
}
interface PullsResponse {
  pulls: PullSummary[];
}
interface BranchesResponse {
  defaultBranch: string;
  defaultBranchSha: string;
  branches: BranchSummary[];
  truncatedToCount: number;
}

export function ReviewComposer({ userId }: { userId: string }) {
  const router = useRouter();

  const [repos, setRepos] = React.useState<RepoSummary[] | null>(null);
  const [reposError, setReposError] = React.useState<string | null>(null);
  const [repo, setRepo] = React.useState<RepoSummary | null>(null);

  const [kind, setKind] = React.useState<Kind>('pr');

  const [pulls, setPulls] = React.useState<PullSummary[] | null>(null);
  const [pull, setPull] = React.useState<PullSummary | null>(null);
  const [branchData, setBranchData] = React.useState<BranchesResponse | null>(null);
  const [branch, setBranch] = React.useState<BranchSummary | null>(null);

  const [submitting, setSubmitting] = React.useState(false);
  const [inFlightJobId, setInFlightJobId] = React.useState<string | null>(null);

  // Fetch the repo list once on mount and restore the last selection
  // (if any) inline once the response is in. Doing the restore inside
  // the promise — rather than a second effect — avoids a setState chain.
  React.useEffect(() => {
    let cancelled = false;
    fetchGithub<ReposResponse>('/api/github/repos')
      .then((data) => {
        if (cancelled) return;
        setRepos(data.repos);
        const last = readLastTarget(userId);
        if (!last) return;
        const found = data.repos.find((r) => r.fullName === last.repoFullName);
        if (!found) {
          clearLastTarget(userId);
          return;
        }
        setRepo(found);
        setKind(last.kind);
        // The target itself is restored after the dependent pulls/branches
        // fetch completes — see the next two effects.
      })
      .catch((err) => {
        if (cancelled || (err && (err as { status?: number }).status === 401)) return;
        setReposError(err instanceof Error ? err.message : 'Failed to load repos');
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Fetch pulls the first time PRs become the active kind for a repo. The
  // `pulls === null` guard means switching tabs back and forth doesn't
  // re-fetch; `onChangeRepo` resets pulls to null on repo change.
  React.useEffect(() => {
    if (!repo || kind !== 'pr' || pulls !== null) return;
    let cancelled = false;
    fetchGithub<PullsResponse>(`/api/github/repos/${repo.owner}/${repo.name}/pulls`)
      .then((data) => {
        if (cancelled) return;
        setPulls(data.pulls);
        const last = readLastTarget(userId);
        if (last && last.repoFullName === repo.fullName && last.prNumber !== undefined) {
          const found = data.pulls.find((p) => p.number === last.prNumber);
          if (found) setPull(found);
          else clearLastPull(userId);
        }
      })
      .catch((err) => {
        if (cancelled || (err && (err as { status?: number }).status === 401)) return;
        toast({
          title: 'Could not load PRs',
          description: err instanceof Error ? err.message : 'GitHub returned an error.',
          variant: 'destructive',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [repo, kind, pulls, userId]);

  // Fetch branches under the same lazy-once-per-repo discipline.
  React.useEffect(() => {
    if (!repo || kind !== 'branch' || branchData !== null) return;
    let cancelled = false;
    fetchGithub<BranchesResponse>(`/api/github/repos/${repo.owner}/${repo.name}/branches`)
      .then((data) => {
        if (cancelled) return;
        setBranchData(data);
        const last = readLastTarget(userId);
        if (last && last.repoFullName === repo.fullName && last.branchRef !== undefined) {
          const found = data.branches.find((b) => b.ref === last.branchRef);
          if (found) setBranch(found);
          else clearLastBranch(userId);
        }
      })
      .catch((err) => {
        if (cancelled || (err && (err as { status?: number }).status === 401)) return;
        toast({
          title: 'Could not load branches',
          description: err instanceof Error ? err.message : 'GitHub returned an error.',
          variant: 'destructive',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [repo, kind, branchData, userId]);

  // Build the ReviewTarget that will get submitted, when fully selected.
  const target = React.useMemo<ReviewTarget | null>(() => {
    if (!repo) return null;
    if (kind === 'pr' && pull) {
      return {
        kind: 'pr',
        owner: repo.owner,
        repo: repo.name,
        number: pull.number,
        headSha: pull.headSha,
        baseSha: pull.baseSha,
        title: pull.title,
      };
    }
    if (kind === 'branch' && branch && branchData) {
      return {
        kind: 'branch',
        owner: repo.owner,
        repo: repo.name,
        ref: branch.ref,
        headSha: branch.headSha,
        baseRef: branchData.defaultBranch,
        baseSha: branchData.defaultBranchSha,
      };
    }
    return null;
  }, [repo, kind, pull, branch, branchData]);

  const onChangeRepo = (next: RepoSummary) => {
    if (next.fullName === repo?.fullName) return;
    setRepo(next);
    setPull(null);
    setBranch(null);
    setPulls(null);
    setBranchData(null);
    writeLastRepo(userId, next.fullName);
  };

  const onChangeKind = (next: Kind) => {
    if (next === kind) return;
    setKind(next);
    writeLastKind(userId, next);
  };

  const onChangePull = (next: PullSummary) => {
    setPull(next);
    writeLastPull(userId, next.number);
  };

  const onChangeBranch = (next: BranchSummary) => {
    setBranch(next);
    writeLastBranch(userId, next.ref);
  };

  const onSubmit = async () => {
    if (!target || !repo || submitting) return;
    setSubmitting(true);
    setInFlightJobId(null);
    try {
      const { id } = await startReview(target);
      router.push(`/jobs/${id}`);
    } catch (err) {
      if (err instanceof JobInFlightError) {
        setInFlightJobId(err.activeJobId);
        toast({
          title: 'Review already running',
          description: err.message,
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Could not start review',
          description: err instanceof Error ? err.message : 'Unknown error',
          variant: 'destructive',
        });
      }
      setSubmitting(false);
    }
  };

  return (
    <section
      aria-label="Start a review"
      className="relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[0_1px_0_rgba(140,100,255,0.04),0_18px_50px_-28px_rgba(140,100,255,0.55)]"
    >
      <div className="grid gap-5 p-6 sm:grid-cols-[1.3fr_auto_1.2fr] sm:items-end sm:gap-6">
        <Field label="Repository">
          {reposError ? (
            <div className="flex h-10 items-center rounded-lg border border-destructive/40 bg-destructive/10 px-3 text-sm text-destructive">
              <span className="truncate">{reposError}</span>
            </div>
          ) : (
            <Combobox<RepoSummary>
              items={repos}
              value={repo}
              onChange={onChangeRepo}
              getKey={(r) => r.fullName}
              getSearchValue={(r) => `${r.fullName} ${r.description ?? ''}`.toLowerCase()}
              renderItem={(r) => (
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate font-medium">{r.fullName}</span>
                  {r.private && (
                    <Lock className="size-3 shrink-0 text-muted-foreground" aria-label="private" />
                  )}
                  {r.archived && (
                    <span className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                      archived
                    </span>
                  )}
                </div>
              )}
              renderTrigger={(r) => (
                <span className="flex items-center gap-2">
                  <span className="truncate font-medium">{r.fullName}</span>
                  {r.private && <Lock className="size-3 shrink-0 text-muted-foreground" />}
                </span>
              )}
              placeholder="Choose a repository"
              searchPlaceholder="Filter repos…"
              emptyMessage="No repos match."
            />
          )}
        </Field>

        <Field label="Type">
          <KindToggle value={kind} onChange={onChangeKind} disabled={!repo} />
        </Field>

        <Field label={kind === 'pr' ? 'Pull request' : 'Branch'}>
          {kind === 'pr' ? (
            <Combobox<PullSummary>
              items={repo ? pulls : []}
              value={pull}
              onChange={onChangePull}
              getKey={(p) => String(p.number)}
              getSearchValue={(p) =>
                `#${p.number} ${p.title} ${p.headRef} ${p.authorLogin ?? ''}`.toLowerCase()
              }
              renderItem={(p) => (
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="text-muted-foreground tabular-nums">#{p.number}</span>
                    <span className="truncate font-medium">{p.title}</span>
                    {p.draft && (
                      <span className="rounded bg-muted px-1 py-0 text-[10px] text-muted-foreground">
                        draft
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {p.authorLogin ?? 'unknown'} · {p.headRef} → {p.baseRef}
                  </p>
                </div>
              )}
              renderTrigger={(p) => (
                <span className="flex items-center gap-1.5 truncate">
                  <GitPullRequest className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="text-muted-foreground tabular-nums">#{p.number}</span>
                  <span className="truncate">{p.title}</span>
                </span>
              )}
              placeholder={repo ? 'Choose a pull request' : 'Pick a repo first'}
              searchPlaceholder="Filter PRs…"
              emptyMessage={repo && pulls && pulls.length === 0 ? 'No open PRs.' : 'No matches.'}
              disabled={!repo}
            />
          ) : (
            <Combobox<BranchSummary>
              items={repo ? (branchData?.branches ?? null) : []}
              value={branch}
              onChange={onChangeBranch}
              getKey={(b) => b.ref}
              getSearchValue={(b) => `${b.ref} ${b.headCommitMessage}`.toLowerCase()}
              renderItem={(b) => (
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-mono text-sm">{b.ref}</span>
                  <p className="truncate text-xs text-muted-foreground">{b.headCommitMessage}</p>
                </div>
              )}
              renderTrigger={(b) => (
                <span className="flex items-center gap-1.5 truncate">
                  <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate font-mono text-sm">{b.ref}</span>
                </span>
              )}
              placeholder={repo ? 'Choose a branch' : 'Pick a repo first'}
              searchPlaceholder="Filter branches…"
              emptyMessage={
                repo && branchData && branchData.branches.length === 0
                  ? 'No branches active in last 30 days.'
                  : 'No matches.'
              }
              disabled={!repo}
            />
          )}
        </Field>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-4">
        <p className="text-[12.5px] text-muted-foreground">
          {target ? (
            <SelectionHint target={target} />
          ) : (
            <>
              Average review takes <span className="text-foreground">32 seconds</span>.
            </>
          )}
        </p>
        <div className="flex items-center gap-2">
          {inFlightJobId && (
            <Button asChild variant="ghost" size="sm">
              <a href={`/jobs/${inFlightJobId}`}>View running review →</a>
            </Button>
          )}
          <Button
            onClick={onSubmit}
            disabled={!target || submitting}
            aria-busy={submitting}
            className="h-9 rounded-full px-4"
          >
            {submitting ? 'Starting…' : 'Start review'}
            <ArrowRight className="size-4" data-icon="inline-end" />
          </Button>
        </div>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-subtle">
        {label}
      </span>
      {children}
    </label>
  );
}

function KindToggle({
  value,
  onChange,
  disabled,
}: {
  value: Kind;
  onChange: (next: Kind) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="tablist"
      aria-label="Target type"
      className={cn(
        'inline-flex h-9 items-center rounded-full bg-iris-soft p-1',
        disabled && 'opacity-60',
      )}
    >
      <KindButton active={value === 'pr'} onClick={() => onChange('pr')} disabled={disabled}>
        <GitPullRequest className="size-3.5" /> PR
      </KindButton>
      <KindButton
        active={value === 'branch'}
        onClick={() => onChange('branch')}
        disabled={disabled}
      >
        <GitBranch className="size-3.5" /> Branch
      </KindButton>
    </div>
  );
}

function KindButton({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-full items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-colors',
        active
          ? 'bg-surface-2 text-iris shadow-[0_1px_2px_rgba(0,0,0,0.4)]'
          : 'text-muted-foreground hover:text-foreground',
        disabled && 'cursor-not-allowed',
      )}
    >
      {children}
    </button>
  );
}

function SelectionHint({ target }: { target: ReviewTarget }) {
  if (target.kind === 'pr') {
    return (
      <span>
        Ready to review{' '}
        <span className="font-medium text-foreground">
          PR #{target.number} · {target.title}
        </span>
      </span>
    );
  }
  return (
    <span>
      Ready to review{' '}
      <span className="font-medium text-foreground font-mono">
        {target.ref} → {target.baseRef}
      </span>
    </span>
  );
}
