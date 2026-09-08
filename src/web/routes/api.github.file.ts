import { z } from 'zod';
import { GithubAuthError } from '@/domain/github/client.server';
import type { FileAtRef, GithubResult } from '@/domain/github/types';
import { getFileAtRef } from '@/domain/github/view-time.server';
import { withGithub } from '@/web/lib/github.server';
import type { FileResponse } from '@/web/lib/github-api';
import { parseSearchParams } from '@/web/lib/parse.server';
import type { Route } from './+types/api.github.file';

const SearchSchema = z.object({
  owner: z.string().min(1).max(100),
  repo: z.string().min(1).max(200),
  path: z.string().min(1).max(1000),
  base: z.string().min(1).max(255),
  head: z.string().min(1).max(255),
});

const isUnauthorized = (result: GithubResult<FileAtRef>) =>
  !result.ok && result.error.kind === 'unauthorized';

/**
 * GET /api/github/file?owner&repo&path&base&head — both blobs of one file
 * for the inline diff, fetched in parallel with the viewer's token
 * (phase-4-plan P4-D8). Per-side failures (`not-found`, `too-large`,
 * `no-access`, …) come back inside the body for the component to fold; a
 * rejected token on either side is the relink redirect (P4-D7).
 */
export function loader({ request }: Route.LoaderArgs) {
  const { owner, repo, path, base, head } = parseSearchParams(SearchSchema, request);
  return withGithub(request, async (client) => {
    const [baseFile, headFile] = await Promise.all([
      getFileAtRef(client, { owner, repo, path, ref: base }),
      getFileAtRef(client, { owner, repo, path, ref: head }),
    ]);
    if (isUnauthorized(baseFile) || isUnauthorized(headFile)) throw new GithubAuthError();
    const body: FileResponse = { ok: true, base: baseFile, head: headFile };
    return body;
  });
}
