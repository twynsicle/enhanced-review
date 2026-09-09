import {
  Box,
  Button,
  Code,
  Flex,
  Group,
  SegmentedControl,
  Stack,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconArrowRight, IconGitBranch, IconGitPullRequest, IconLock } from '@tabler/icons-react';
import { useEffect, useMemo, type ReactNode } from 'react';
import { Link, useFetcher } from 'react-router';
import type { BranchSummary, PullSummary, RepoSummary } from '@/domain/github/types';
import type { ReviewTarget } from '@/domain/review/target';
import { isActionError } from '@/web/lib/action-error';
import type { BranchesResponse, PullsResponse, ReposResponse } from '@/web/lib/github-api';
import {
  clearLastBranch,
  clearLastPull,
  clearLastTarget,
  readLastTarget,
  useLastTarget,
  writeLastBranch,
  writeLastKind,
  writeLastPull,
  writeLastRepo,
  type LastTarget,
} from '@/web/stores/last-target';
import { token } from '@/web/theme/tokens';
import { TargetCombobox } from './target-combobox';

type Kind = LastTarget['kind'];

const CHIP_STYLE = {
  borderRadius: 4,
  background: token('muted'),
  color: token('muted-foreground'),
  fontSize: 10,
  padding: '0 4px',
} as const;

/**
 * Repo → kind → PR/branch picker. The persisted last-target store *is* the
 * selection state: every pick writes to it and the current selection is
 * derived from it against the lists the three resource routes return, so a
 * refresh restores the composer without effects that set state. Stale picks
 * (a repo or PR that is no longer listed) are cleared from the store when the
 * list arrives.
 */
export function ReviewComposer({ userId }: { userId: string }) {
  const repos = useFetcher<ReposResponse>();
  const pulls = useFetcher<PullsResponse>();
  const branches = useFetcher<BranchesResponse>();
  const submit = useFetcher();

  // The store is not hydrated during SSR/hydration (skipHydration); pull it in
  // after mount so server and client agree on the empty composer first.
  useEffect(() => {
    void useLastTarget.persist.rehydrate();
  }, []);
  useLastTarget((state) => state.byUser[userId]); // subscribe to changes
  const last = readLastTarget(userId);

  const loadRepos = repos.load;
  useEffect(() => {
    void loadRepos('/api/github/repos');
  }, [loadRepos]);

  const repoList = repos.data?.ok ? repos.data.repos : null;
  // Hidden again while a retry is in flight, so the field shows one state at a time.
  const reposError =
    repos.state === 'idle' && repos.data && !repos.data.ok ? repos.data.message : null;
  const repo = useMemo(
    () =>
      last && repoList ? (repoList.find((r) => r.fullName === last.repoFullName) ?? null) : null,
    [last, repoList],
  );
  const kind: Kind = repo ? (last?.kind ?? 'pr') : 'pr';

  // A stored repo that is no longer listed resets the whole target.
  useEffect(() => {
    if (last && repoList && !repoList.some((r) => r.fullName === last.repoFullName)) {
      clearLastTarget(userId);
    }
  }, [last, repoList, userId]);

  // Lazy, once per repo: *both* outcomes echo `fullName`, so any settled body
  // for this repo — success or failure — reads as "loaded" and stops the
  // effect, while a body for another repo reads as "not loaded" and reloads on
  // a repo switch. The echo on the failure body is what closes the loop: it
  // carried no repo once, so a failure read as "never asked" and the effect
  // re-fired forever. After a failure the only way back is the Retry below.
  const pullsFor = pulls.data ? pulls.data.fullName : null;
  const branchesFor = branches.data ? branches.data.fullName : null;
  const pullsUrl = repo ? `/api/github/repos/${repo.owner}/${repo.name}/pulls` : null;
  const branchesUrl = repo ? `/api/github/repos/${repo.owner}/${repo.name}/branches` : null;
  const loadPulls = pulls.load;
  const loadBranches = branches.load;
  useEffect(() => {
    if (!repo || !pullsUrl || kind !== 'pr' || pulls.state !== 'idle') return;
    if (pullsFor === repo.fullName) return;
    void loadPulls(pullsUrl);
  }, [repo, pullsUrl, kind, pulls.state, pullsFor, loadPulls]);
  useEffect(() => {
    if (!repo || !branchesUrl || kind !== 'branch' || branches.state !== 'idle') return;
    if (branchesFor === repo.fullName) return;
    void loadBranches(branchesUrl);
  }, [repo, branchesUrl, kind, branches.state, branchesFor, loadBranches]);

  // Shown in place of the dropdown, so a list that failed never masquerades as
  // one still loading. Only once nothing newer is in flight, which is also what
  // hides it again while a retry runs.
  const listFailure =
    kind === 'pr'
      ? pulls.state === 'idle' && pulls.data && !pulls.data.ok
        ? pulls.data
        : null
      : branches.state === 'idle' && branches.data && !branches.data.ok
        ? branches.data
        : null;
  const listError =
    repo && listFailure && listFailure.fullName === repo.fullName ? listFailure.message : null;
  const retryList = () => {
    if (kind === 'pr') {
      if (pullsUrl) void loadPulls(pullsUrl);
    } else if (branchesUrl) {
      void loadBranches(branchesUrl);
    }
  };

  const pullList = repo && pulls.data?.ok && pullsFor === repo.fullName ? pulls.data.pulls : null;
  const branchData =
    repo && branches.data?.ok && branchesFor === repo.fullName ? branches.data : null;
  const pull =
    pullList && last?.prNumber !== undefined
      ? (pullList.find((p) => p.number === last.prNumber) ?? null)
      : null;
  const branch =
    branchData && last?.branchRef !== undefined
      ? (branchData.branches.find((b) => b.ref === last.branchRef) ?? null)
      : null;

  // Stale picks are dropped from the store once the list says so.
  useEffect(() => {
    if (pullList && last?.prNumber !== undefined && !pull) clearLastPull(userId);
  }, [pullList, last, pull, userId]);
  useEffect(() => {
    if (branchData && last?.branchRef !== undefined && !branch) clearLastBranch(userId);
  }, [branchData, last, branch, userId]);

  // Load failures for the dependent lists surface as notifications, as on main.
  useEffect(() => {
    if (pulls.data && !pulls.data.ok) {
      notifications.show({
        // A stable id keeps a repeat from stacking a second toast.
        id: 'pulls-error',
        title: 'Could not load PRs',
        message: pulls.data.message,
        color: 'risk',
      });
    }
  }, [pulls.data]);
  useEffect(() => {
    if (branches.data && !branches.data.ok) {
      notifications.show({
        id: 'branches-error',
        title: 'Could not load branches',
        message: branches.data.message,
        color: 'risk',
      });
    }
  }, [branches.data]);

  const target = useMemo<ReviewTarget | null>(() => {
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

  const submitting = submit.state !== 'idle';
  const submitError = isActionError(submit.data) ? submit.data : null;
  const inFlightJobId =
    submitError?.reason === 'job_in_flight' ? submitError.activeJobId : undefined;
  useEffect(() => {
    if (!submitError) return;
    notifications.show({
      title:
        submitError.reason === 'job_in_flight'
          ? 'Review already running'
          : 'Could not start review',
      message: submitError.message,
      color: 'risk',
    });
  }, [submitError]);

  const onSubmit = () => {
    if (!target || submitting) return;
    // `?index` targets the index route's action; a bare `/` would post to the layout.
    void submit.submit({ target: JSON.stringify(target) }, { method: 'post', action: '/?index' });
  };

  return (
    <Box
      component="section"
      aria-label="Start a review"
      pos="relative"
      style={{
        overflow: 'hidden',
        borderRadius: 16,
        border: `1px solid ${token('border')}`,
        background: token('card'),
        boxShadow: '0 1px 0 rgba(140,200,255,0.04), 0 18px 50px -28px rgba(80,200,200,0.45)',
      }}
    >
      <Box
        aria-hidden
        pos="absolute"
        top={0}
        left={24}
        right={24}
        h={1}
        style={{
          pointerEvents: 'none',
          background: `linear-gradient(90deg, ${token('before')}, ${token('after')})`,
        }}
      />
      <Flex
        direction={{ base: 'column', sm: 'row' }}
        align={{ sm: 'flex-end' }}
        gap={{ base: 20, sm: 24 }}
        p={24}
      >
        <Field label="Repository" grow={1.3}>
          {reposError ? (
            <FieldError
              message={reposError}
              onRetry={() => {
                void loadRepos('/api/github/repos');
              }}
            />
          ) : (
            <TargetCombobox<RepoSummary>
              items={repoList}
              value={repo}
              onChange={(next) => writeLastRepo(userId, next.fullName)}
              getKey={(r) => r.fullName}
              getSearchValue={(r) => `${r.fullName} ${r.description ?? ''}`.toLowerCase()}
              renderItem={(r) => (
                <Group gap={8} wrap="nowrap" miw={0}>
                  <Text component="span" fz="inherit" fw={500} truncate>
                    {r.fullName}
                  </Text>
                  {r.private && (
                    <IconLock
                      size={12}
                      aria-label="private"
                      style={{ flexShrink: 0, color: token('muted-foreground') }}
                    />
                  )}
                  {r.archived && (
                    <Box component="span" style={CHIP_STYLE}>
                      archived
                    </Box>
                  )}
                </Group>
              )}
              renderTrigger={(r) => (
                <Group gap={8} wrap="nowrap" miw={0}>
                  <Text component="span" fw={500} truncate>
                    {r.fullName}
                  </Text>
                  {r.private && (
                    <IconLock
                      size={12}
                      style={{ flexShrink: 0, color: token('muted-foreground') }}
                    />
                  )}
                </Group>
              )}
              placeholder="Choose a repository"
              searchPlaceholder="Filter repos…"
              emptyMessage="No repos match."
            />
          )}
        </Field>

        <Field label="Type">
          <KindToggle
            value={kind}
            onChange={(next) => writeLastKind(userId, next)}
            disabled={!repo}
          />
        </Field>

        <Field label={kind === 'pr' ? 'Pull request' : 'Branch'} grow={1.2}>
          {listError ? (
            <FieldError message={listError} onRetry={retryList} />
          ) : kind === 'pr' ? (
            <TargetCombobox<PullSummary>
              items={repo ? pullList : []}
              value={pull}
              onChange={(next) => writeLastPull(userId, next.number)}
              getKey={(p) => String(p.number)}
              getSearchValue={(p) =>
                `#${p.number} ${p.title} ${p.headRef} ${p.authorLogin ?? ''}`.toLowerCase()
              }
              renderItem={(p) => (
                <Stack gap={2} miw={0}>
                  <Group gap={6} wrap="nowrap" miw={0}>
                    <Text
                      component="span"
                      fz="inherit"
                      c="dimmed"
                      style={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      #{p.number}
                    </Text>
                    <Text component="span" fz="inherit" fw={500} truncate>
                      {p.title}
                    </Text>
                    {p.draft && (
                      <Box component="span" style={CHIP_STYLE}>
                        draft
                      </Box>
                    )}
                  </Group>
                  <Text fz="xs" c="dimmed" truncate>
                    {p.authorLogin ?? 'unknown'} · {p.headRef} → {p.baseRef}
                  </Text>
                </Stack>
              )}
              renderTrigger={(p) => (
                <Group gap={6} wrap="nowrap" miw={0}>
                  <IconGitPullRequest
                    size={14}
                    style={{ flexShrink: 0, color: token('muted-foreground') }}
                  />
                  <Text component="span" c="dimmed" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    #{p.number}
                  </Text>
                  <Text component="span" truncate>
                    {p.title}
                  </Text>
                </Group>
              )}
              placeholder={repo ? 'Choose a pull request' : 'Pick a repo first'}
              searchPlaceholder="Filter PRs…"
              emptyMessage={
                repo && pullList && pullList.length === 0 ? 'No open PRs.' : 'No matches.'
              }
              disabled={!repo}
            />
          ) : (
            <TargetCombobox<BranchSummary>
              items={repo ? (branchData?.branches ?? null) : []}
              value={branch}
              onChange={(next) => writeLastBranch(userId, next.ref)}
              getKey={(b) => b.ref}
              getSearchValue={(b) => `${b.ref} ${b.headCommitMessage}`.toLowerCase()}
              renderItem={(b) => (
                <Stack gap={2} miw={0}>
                  <Text component="span" ff="monospace" fz="inherit" truncate>
                    {b.ref}
                  </Text>
                  <Text fz="xs" c="dimmed" truncate>
                    {b.headCommitMessage}
                  </Text>
                </Stack>
              )}
              renderTrigger={(b) => (
                <Group gap={6} wrap="nowrap" miw={0}>
                  <IconGitBranch
                    size={14}
                    style={{ flexShrink: 0, color: token('muted-foreground') }}
                  />
                  <Text component="span" ff="monospace" fz="sm" truncate>
                    {b.ref}
                  </Text>
                </Group>
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
      </Flex>

      <Group
        justify="space-between"
        gap={12}
        px={24}
        py={16}
        wrap="nowrap"
        style={{ borderTop: `1px solid ${token('border')}` }}
      >
        <Text fz={12.5} c="dimmed" miw={0} truncate style={{ flex: 1 }}>
          {target ? (
            <SelectionHint target={target} />
          ) : (
            <>
              Average review takes{' '}
              <Text component="span" fz="inherit" c={token('foreground')}>
                32 seconds
              </Text>
              .
            </>
          )}
        </Text>
        <Group gap={8} wrap="nowrap" style={{ flexShrink: 0 }}>
          {inFlightJobId && (
            <Button
              component={Link}
              to={`/jobs/${inFlightJobId}`}
              variant="subtle"
              color="gray"
              size="sm"
            >
              View running review →
            </Button>
          )}
          <Button
            onClick={onSubmit}
            disabled={!target || submitting}
            aria-busy={submitting}
            radius="xl"
            h={36}
            px={16}
            rightSection={<IconArrowRight size={16} />}
            style={{
              background:
                target && !submitting
                  ? `linear-gradient(135deg, ${token('before')}, ${token('after')})`
                  : undefined,
              color: target && !submitting ? token('background') : undefined,
            }}
          >
            {submitting ? 'Starting…' : 'Start review'}
          </Button>
        </Group>
      </Group>
    </Box>
  );
}

function Field({ label, grow, children }: { label: string; grow?: number; children: ReactNode }) {
  return (
    <Stack component="label" gap={6} miw={0} style={{ flex: grow ? `${grow} 1 0` : '0 0 auto' }}>
      <Text
        component="span"
        fz={10.5}
        fw={500}
        tt="uppercase"
        c={token('subtle')}
        style={{ letterSpacing: '0.14em' }}
      >
        {label}
      </Text>
      {children}
    </Stack>
  );
}

/**
 * A field that could not load, in the dropdown's own place and shape: the
 * reason plus the way out. Every list here is loaded at most once per repo, so
 * without the retry a single transient GitHub error would strand that field
 * until the page is reloaded.
 */
function FieldError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Group
      role="alert"
      h={40}
      px={12}
      gap={8}
      fz="sm"
      wrap="nowrap"
      justify="space-between"
      style={{
        borderRadius: 8,
        border: `1px solid color-mix(in oklab, ${token('destructive')} 40%, transparent)`,
        background: `color-mix(in oklab, ${token('destructive')} 10%, transparent)`,
        color: token('destructive'),
      }}
    >
      <Text component="span" truncate>
        {message}
      </Text>
      <UnstyledButton
        type="button"
        // The field's `<label>` wraps this button, so without an explicit name
        // it would be announced as the whole label + message.
        aria-label="Retry"
        onClick={onRetry}
        fz="xs"
        fw={500}
        style={{
          flexShrink: 0,
          color: 'inherit',
          textDecoration: 'underline',
          textUnderlineOffset: 2,
        }}
      >
        Retry
      </UnstyledButton>
    </Group>
  );
}

function kindItem(icon: ReactNode, label: string) {
  return (
    <Group component="span" gap={6} wrap="nowrap" fz={12} fw={500}>
      {icon}
      {label}
    </Group>
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
    <SegmentedControl
      aria-label="Target type"
      value={value}
      onChange={(next) => onChange(next as Kind)}
      disabled={disabled}
      radius="xl"
      h={36}
      withItemsBorders={false}
      data={[
        { value: 'pr', label: kindItem(<IconGitPullRequest size={14} />, 'PR') },
        { value: 'branch', label: kindItem(<IconGitBranch size={14} />, 'Branch') },
      ]}
      styles={{
        root: {
          background: token('before-soft'),
          padding: 4,
          opacity: disabled ? 0.6 : 1,
          '--sc-label-color': token('before'),
        },
        indicator: { background: token('surface-2'), boxShadow: '0 1px 2px rgba(0,0,0,0.4)' },
        label: {
          padding: '0 12px',
          height: 28,
          lineHeight: '28px',
          color: token('muted-foreground'),
        },
        control: { border: 'none' },
      }}
    />
  );
}

function SelectionHint({ target }: { target: ReviewTarget }) {
  if (target.kind === 'pr') {
    return (
      <span>
        Ready to review{' '}
        <Text component="span" fz="inherit" fw={500} c={token('foreground')}>
          PR #{target.number} · {target.title}
        </Text>
      </span>
    );
  }
  return (
    <span>
      Ready to review{' '}
      <Code fw={500} c={token('foreground')} bg="transparent" p={0} fz="inherit">
        {target.ref} → {target.baseRef}
      </Code>
    </span>
  );
}
