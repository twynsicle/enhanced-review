import type { Octokit } from 'octokit';
import { describe, expect, it } from 'vitest';
import { listRecentBranches } from './branches';
import { GithubAuthError } from './errors';

interface FakeBranchNode {
  name: string;
  target: { oid: string; committedDate: string; messageHeadline: string } | null;
}

function mockOctokit(graphqlHandler: (query: string, vars: unknown) => Promise<unknown>): Octokit {
  return { graphql: graphqlHandler } as unknown as Octokit;
}

function fakeResponse(
  defaultBranch: string | null,
  nodes: Array<FakeBranchNode | null>,
  defaultBranchSha = 'default-sha',
) {
  return {
    repository: {
      defaultBranchRef: defaultBranch
        ? { name: defaultBranch, target: { oid: defaultBranchSha } }
        : null,
      refs: { nodes },
    },
  };
}

const NOW = new Date('2026-04-25T12:00:00Z');
const TWO_WEEKS_AGO = '2026-04-11T12:00:00Z';
const THIRTY_FIVE_DAYS_AGO = '2026-03-21T12:00:00Z';
const FIFTY_DAYS_AGO = '2026-03-06T12:00:00Z';

describe('listRecentBranches', () => {
  it('returns only branches whose tip is within the 30-day window', async () => {
    const octokit = mockOctokit(async () =>
      fakeResponse('main', [
        {
          name: 'feature-recent',
          target: {
            oid: 'aaa',
            committedDate: TWO_WEEKS_AGO,
            messageHeadline: 'Recent work',
          },
        },
        {
          name: 'feature-stale',
          target: {
            oid: 'bbb',
            committedDate: THIRTY_FIVE_DAYS_AGO,
            messageHeadline: 'Stale work',
          },
        },
        {
          name: 'feature-ancient',
          target: {
            oid: 'ccc',
            committedDate: FIFTY_DAYS_AGO,
            messageHeadline: 'Ancient',
          },
        },
      ]),
    );

    const result = await listRecentBranches(octokit, 'o', 'r', { now: NOW });

    expect(result.defaultBranch).toBe('main');
    expect(result.defaultBranchSha).toBe('default-sha');
    expect(result.branches).toEqual([
      {
        ref: 'feature-recent',
        headSha: 'aaa',
        headCommitDate: TWO_WEEKS_AGO,
        headCommitMessage: 'Recent work',
      },
    ]);
  });

  it('respects a custom withinDays', async () => {
    const octokit = mockOctokit(async () =>
      fakeResponse('main', [
        {
          name: 'almost-stale',
          target: {
            oid: 'aaa',
            committedDate: THIRTY_FIVE_DAYS_AGO,
            messageHeadline: '35 days back',
          },
        },
      ]),
    );

    const result = await listRecentBranches(octokit, 'o', 'r', { now: NOW, withinDays: 60 });
    expect(result.branches.map((b) => b.ref)).toEqual(['almost-stale']);
  });

  it('falls back to "main" if defaultBranchRef is null', async () => {
    const octokit = mockOctokit(async () => fakeResponse(null, []));
    const result = await listRecentBranches(octokit, 'o', 'r', { now: NOW });
    expect(result.defaultBranch).toBe('main');
  });

  it('skips refs whose target is not a Commit', async () => {
    const octokit = mockOctokit(async () =>
      fakeResponse('main', [
        { name: 'tag-like', target: null },
        {
          name: 'real-commit',
          target: {
            oid: 'aaa',
            committedDate: TWO_WEEKS_AGO,
            messageHeadline: 'real',
          },
        },
      ]),
    );

    const result = await listRecentBranches(octokit, 'o', 'r', { now: NOW });
    expect(result.branches.map((b) => b.ref)).toEqual(['real-commit']);
  });

  it('throws when the repository is not found', async () => {
    const octokit = mockOctokit(async () => ({ repository: null }));
    await expect(listRecentBranches(octokit, 'o', 'missing', { now: NOW })).rejects.toThrow(
      /Repository not found/,
    );
  });

  it('translates GraphQL UNAUTHORIZED to GithubAuthError', async () => {
    const octokit = mockOctokit(async () => {
      throw { errors: [{ type: 'UNAUTHORIZED', message: 'Bad credentials' }] };
    });
    await expect(listRecentBranches(octokit, 'o', 'r', { now: NOW })).rejects.toBeInstanceOf(
      GithubAuthError,
    );
  });
});
