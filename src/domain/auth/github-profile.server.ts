import { z } from 'zod';

/**
 * `GET https://api.github.com/user` for the token we just received from the
 * OAuth exchange. This is the only place the GitHub identity is read; the
 * result feeds `users.upsertUserFromGithub`.
 */
const GITHUB_USER_URL = 'https://api.github.com/user';

const viewerSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1).max(100),
  name: z.string().nullish(),
  avatar_url: z.url().nullish(),
});

export interface GithubProfile {
  githubId: bigint;
  githubLogin: string;
  name: string | null;
  avatarUrl: string | null;
}

export class GithubProfileError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'GithubProfileError';
    this.status = status;
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function fetchGithubProfile(
  accessToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<GithubProfile> {
  const response = await fetchImpl(GITHUB_USER_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'enhanced-review',
    },
  });
  if (!response.ok) {
    throw new GithubProfileError(
      `GitHub /user returned ${response.status.toString()}`,
      response.status,
    );
  }

  const parsed = viewerSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new GithubProfileError('GitHub /user returned an unexpected payload');
  }
  const viewer = parsed.data;
  return {
    githubId: BigInt(viewer.id),
    githubLogin: viewer.login,
    name: viewer.name ?? null,
    avatarUrl: viewer.avatar_url ?? null,
  };
}
