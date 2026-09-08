// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GithubAuthError, type GithubClient } from '@/domain/github/client.server';
import type { FileAtRef, GithubResult } from '@/domain/github/types';

const client = { request: vi.fn(), graphql: vi.fn() } as unknown as GithubClient;
const github = {
  withGithub: vi.fn((_request: Request, fn: (c: GithubClient, token: string) => Promise<unknown>) =>
    fn(client, 'tok'),
  ),
};
const viewTime = {
  getFileAtRef:
    vi.fn<(c: GithubClient, args: { ref: string }) => Promise<GithubResult<FileAtRef>>>(),
};
vi.mock('@/web/lib/github.server', () => github);
vi.mock('@/domain/github/view-time.server', () => viewTime);

const { loader } = await import('./api.github.file');

const FILE: FileAtRef = { content: 'hi', language: 'typescript', lineCount: 1 };
const query = 'owner=acme&repo=widgets&path=src%2Fmain.ts&base=aaa&head=bbb';
const args = (search = query) =>
  ({ request: new Request(`http://localhost/api/github/file?${search}`), params: {} }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  viewTime.getFileAtRef.mockResolvedValue({ ok: true, data: FILE });
});

describe('/api/github/file loader', () => {
  it('fetches both refs in parallel and returns them side by side', async () => {
    await expect(loader(args())).resolves.toEqual({
      ok: true,
      base: { ok: true, data: FILE },
      head: { ok: true, data: FILE },
    });
    expect(viewTime.getFileAtRef).toHaveBeenCalledTimes(2);
    expect(viewTime.getFileAtRef).toHaveBeenCalledWith(client, {
      owner: 'acme',
      repo: 'widgets',
      path: 'src/main.ts',
      ref: 'aaa',
    });
    expect(viewTime.getFileAtRef).toHaveBeenCalledWith(client, {
      owner: 'acme',
      repo: 'widgets',
      path: 'src/main.ts',
      ref: 'bbb',
    });
  });

  it('passes per-side failures through in the body', async () => {
    viewTime.getFileAtRef.mockImplementation((_c, { ref }) =>
      Promise.resolve(
        ref === 'aaa'
          ? { ok: false, error: { kind: 'not-found', status: 404 } }
          : { ok: true, data: FILE },
      ),
    );
    await expect(loader(args())).resolves.toEqual({
      ok: true,
      base: { ok: false, error: { kind: 'not-found', status: 404 } },
      head: { ok: true, data: FILE },
    });
  });

  it('a rejected token on either side becomes the auth error (→ /relink)', async () => {
    viewTime.getFileAtRef.mockImplementation((_c, { ref }) =>
      Promise.resolve(
        ref === 'bbb'
          ? { ok: false, error: { kind: 'unauthorized', status: 401 } }
          : { ok: true, data: FILE },
      ),
    );
    await expect(loader(args())).rejects.toBeInstanceOf(GithubAuthError);
  });

  it('rejects missing query params with 400 before touching GitHub', async () => {
    const thrown = (await Promise.resolve()
      .then(() => loader(args('owner=acme')))
      .catch((e: unknown) => e)) as { init?: { status?: number } };
    expect(thrown.init?.status).toBe(400);
    expect(github.withGithub).not.toHaveBeenCalled();
  });
});
