import type { Octokit } from 'octokit';
import { rethrowAuth } from './errors';
import type { BranchSummary } from './types';

const DEFAULT_WITHIN_DAYS = 30;
const GRAPHQL_PAGE_SIZE = 100;

interface RecentBranchesResult {
  defaultBranch: string;
  defaultBranchSha: string;
  branches: BranchSummary[];
  truncatedToCount: number;
}

interface GraphqlBranchesResponse {
  repository: {
    defaultBranchRef: {
      name: string;
      target: { oid: string } | null;
    } | null;
    refs: {
      nodes: Array<{
        name: string;
        target:
          | {
              oid: string;
              committedDate: string;
              messageHeadline: string;
            }
          | null
          | { __typename?: string };
      } | null>;
    };
  } | null;
}

// `RefOrderField` only accepts ALPHABETICAL or TAG_COMMIT_DATE, and the
// latter only orders correctly for `refs/tags/`. We have to fetch branches
// alphabetically and sort by `committedDate` ourselves below.
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

/**
 * List branches whose tip commit is within the active window (default
 * 30 days), sorted newest-first.
 *
 * REST `/repos/{owner}/{repo}/branches` returns alphabetically with no
 * date metadata. GraphQL pulls the commit metadata in the same round-trip
 * but can only order branch refs alphabetically (see {@link BRANCHES_QUERY}),
 * so we fetch a page alphabetically and sort/filter by `committedDate`
 * locally. Repos with more than {@link GRAPHQL_PAGE_SIZE} branches may have
 * recent activity outside this window — acceptable for the picker's intent.
 */
export async function listRecentBranches(
  octokit: Octokit,
  owner: string,
  repo: string,
  options: { withinDays?: number; now?: Date } = {},
): Promise<RecentBranchesResult> {
  const withinDays = options.withinDays ?? DEFAULT_WITHIN_DAYS;
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - withinDays * 24 * 60 * 60 * 1000);

  let response: GraphqlBranchesResponse;
  try {
    response = await octokit.graphql<GraphqlBranchesResponse>(BRANCHES_QUERY, {
      owner,
      name: repo,
      first: GRAPHQL_PAGE_SIZE,
    });
  } catch (error) {
    rethrowAuth(error);
  }

  const repository = response.repository;
  if (!repository) {
    throw new Error(`Repository not found: ${owner}/${repo}`);
  }

  const defaultBranch = repository.defaultBranchRef?.name ?? 'main';
  const defaultBranchSha = repository.defaultBranchRef?.target?.oid ?? '';

  const branches: BranchSummary[] = [];
  for (const node of repository.refs.nodes) {
    if (!node) continue;
    const target = node.target;
    if (!target || !('oid' in target)) continue;
    const commitDate = new Date(target.committedDate);
    if (commitDate < cutoff) continue;
    branches.push({
      ref: node.name,
      headSha: target.oid,
      headCommitDate: target.committedDate,
      headCommitMessage: target.messageHeadline,
    });
  }

  branches.sort((a, b) => b.headCommitDate.localeCompare(a.headCommitDate));

  return {
    defaultBranch,
    defaultBranchSha,
    branches,
    truncatedToCount: GRAPHQL_PAGE_SIZE,
  };
}
