const GH_API = 'https://api.github.com';

export interface PullMetadata {
  title: string;
  body: string;
  authorLogin: string;
}

interface PullApiResponse {
  title?: string | null;
  body?: string | null;
  user?: { login?: string | null } | null;
}

export class GithubFetchError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'GithubFetchError';
    this.status = status;
  }
}

export async function fetchPullMetadata(opts: {
  token: string;
  owner: string;
  repo: string;
  number: number;
  signal?: AbortSignal;
}): Promise<PullMetadata> {
  const res = await fetch(
    `${GH_API}/repos/${encodeURIComponent(opts.owner)}/${encodeURIComponent(opts.repo)}/pulls/${String(opts.number)}`,
    {
      headers: {
        Authorization: `Bearer ${opts.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'enhanced-review/0.1',
      },
      signal: opts.signal,
    },
  );
  if (!res.ok) {
    throw new GithubFetchError(
      `GET /repos/${opts.owner}/${opts.repo}/pulls/${String(opts.number)} returned ${String(res.status)}`,
      res.status,
    );
  }
  const data = (await res.json()) as PullApiResponse;
  return {
    title: data.title ?? '',
    body: data.body ?? '',
    authorLogin: data.user?.login ?? 'unknown',
  };
}
