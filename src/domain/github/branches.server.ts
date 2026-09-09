import { z } from 'zod';
import { type GithubClient, rethrowAuth } from './client.server.ts';
import type { BranchSummary, RecentBranchesResult } from './types.ts';

const DEFAULT_WITHIN_DAYS = 30;
const GRAPHQL_PAGE_SIZE = 100;

// `RefOrderField` only accepts ALPHABETICAL or TAG_COMMIT_DATE, and the latter
// only orders `refs/tags/`. Branches are fetched alphabetically and sorted by
// `committedDate` locally.
const BRANCHES_QUERY = `
  query Branches($owner: String!, $name: String!, $first: Int!) {
    repository(owner: $owner, name: $name) {
      defaultBranchRef {
        name
        target { ... on Commit { oid } }
      }
      refs(refPrefix: "refs/heads/", orderBy: { field: ALPHABETICAL, direction: ASC }, first: $first) {
        nodes {
          name
          target {
            ... on Commit {
              oid
              committedDate
              messageHeadline
            }
          }
        }
      }
    }
  }
`;

const CommitTargetSchema = z.object({
  oid: z.string(),
  committedDate: z.string(),
  messageHeadline: z.string(),
});

const BranchesResponseSchema = z.object({
  repository: z
    .object({
      defaultBranchRef: z
        .object({ name: z.string(), target: z.object({ oid: z.string() }).nullable() })
        .nullable(),
      refs: z.object({
        // A ref whose target is not a Commit comes back without the fragment's fields.
        nodes: z.array(z.object({ name: z.string(), target: z.unknown() }).nullable()),
      }),
    })
    .nullable(),
});

export interface RecentBranchesOptions {
  withinDays?: number;
  now?: Date;
}

/**
 * Branches whose tip commit is within the window (default 30 days), newest
 * first, plus the default branch (the base for branch targets). Repos with
 * more than 100 branches may have recent activity outside the page; fine for
 * the picker's intent.
 */
export async function listRecentBranches(
  octokit: GithubClient,
  owner: string,
  repo: string,
  options: RecentBranchesOptions = {},
): Promise<RecentBranchesResult> {
  const withinDays = options.withinDays ?? DEFAULT_WITHIN_DAYS;
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - withinDays * 24 * 60 * 60 * 1000);

  let raw: unknown;
  try {
    raw = await octokit.graphql(BRANCHES_QUERY, { owner, name: repo, first: GRAPHQL_PAGE_SIZE });
  } catch (error) {
    rethrowAuth(error);
  }

  const { repository } = BranchesResponseSchema.parse(raw);
  if (!repository) throw new Error(`Repository not found: ${owner}/${repo}`);

  const branches: BranchSummary[] = [];
  for (const node of repository.refs.nodes) {
    if (!node) continue;
    const target = CommitTargetSchema.safeParse(node.target);
    if (!target.success) continue;
    if (new Date(target.data.committedDate) < cutoff) continue;
    branches.push({
      ref: node.name,
      headSha: target.data.oid,
      headCommitDate: target.data.committedDate,
      headCommitMessage: target.data.messageHeadline,
    });
  }
  branches.sort((a, b) => b.headCommitDate.localeCompare(a.headCommitDate));

  return {
    defaultBranch: repository.defaultBranchRef?.name ?? 'main',
    defaultBranchSha: repository.defaultBranchRef?.target?.oid ?? '',
    branches,
    truncatedToCount: GRAPHQL_PAGE_SIZE,
  };
}
