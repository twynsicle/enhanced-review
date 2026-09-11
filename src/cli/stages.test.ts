import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUNDLE_PLACEHOLDER, readEmbeddedBundle } from '../domain/review/bundle-html.ts';
import type { RunContext } from './context.ts';
import { parseRun, readReview } from './parse.ts';
import { renderRun, viewerShell } from './render.ts';
import { runFiles, type RunFiles } from './run-folder.ts';
import { writeStubRun } from './stub-run.ts';
import { VIEWER_STAMP_FILE, viewerSourceStamp } from './viewer-stamp.ts';

vi.mock('./terminal.ts', () => ({ note: vi.fn() }));

let root: string;
let run: RunFiles;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'cli-test-stages-'));
  run = runFiles(root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const hunk = (id: string, filename: string, fileOrder: number) => ({
  id,
  filename,
  header: `@@ -${String(fileOrder * 10)},3 +${String(fileOrder * 10)},4 @@`,
  fileOrder,
  original: { startLine: fileOrder * 10, lineCount: 3 },
  modified: { startLine: fileOrder * 10, lineCount: 4 },
});

function context(overrides: Partial<RunContext> = {}): RunContext {
  return {
    target: {
      kind: 'staged',
      slug: 'staged',
      repoRoot: root,
      baseSha: 'a'.repeat(40),
      headSha: 'b'.repeat(40),
      baseLabel: 'HEAD',
      headLabel: 'the index',
    },
    meta: {
      repo: 'acme/widgets',
      title: 'Staged changes on main',
      prNumber: null,
      baseRefName: 'main',
      headRefName: 'staged',
      authorLogin: null,
      description: null,
      stats: { changedFiles: 3, additions: 3, deletions: 0 },
    },
    files: [
      { filename: 'src/a.ts', status: 'modified', additions: 2, deletions: 0 },
      { filename: 'src/b.ts', status: 'added', additions: 1, deletions: 0 },
      {
        filename: 'yarn.lock',
        status: 'modified',
        additions: 9,
        deletions: 9,
        skipped: 'built-in',
      },
    ],
    renamedFrom: {},
    hunks: [
      hunk('H0001', 'src/a.ts', 1),
      hunk('H0002', 'src/a.ts', 2),
      hunk('H0003', 'src/b.ts', 1),
    ],
    contents: {
      'src/a.ts': {
        base: { kind: 'content', content: 'a\n'.repeat(30) },
        head: { kind: 'content', content: 'a\n'.repeat(32) },
      },
      'src/b.ts': { base: { kind: 'absent' }, head: { kind: 'content', content: '</script>\n' } },
    },
    commits: [],
    dirty: [],
    ...overrides,
  };
}

describe('stub run → parse', () => {
  it('gives each reviewed file a chapter citing all its hunks', async () => {
    await writeStubRun(context(), run);
    const review = await parseRun(context(), run);

    expect(review.prTitle).toBe('Staged changes on main');
    expect(
      review.chapters.map((chapter) => ({
        title: chapter.title,
        cited: chapter.diffChunks.flatMap((chunk) => chunk.hunks.map((h) => h.id)),
      })),
    ).toEqual([
      { title: 'a.ts', cited: ['H0001', 'H0002'] },
      { title: 'b.ts', cited: ['H0003'] },
    ]);
    expect(review.files).toEqual(context().files);
    await expect(readReview(run)).resolves.toEqual(review);
  });

  it('still writes a review when every file was skipped', async () => {
    const onlySkipped = context({ files: [context().files[2]!], hunks: [], contents: {} });
    await writeStubRun(onlySkipped, run);
    const review = await parseRun(onlySkipped, run);
    expect(review.chapters.map((chapter) => chapter.id)).toEqual(['nothing-reviewed']);
  });

  it("points at raw.txt when the model's answer does not parse", async () => {
    writeFileSync(run.raw, 'I could not finish the review.');
    await expect(parseRun(context(), run)).rejects.toThrow(
      `did not contain expected <narrative_review> tags (the model's answer is in ${run.raw})`,
    );
  });

  it('says which stage to run when a stage file is missing', async () => {
    await expect(parseRun(context(), run)).rejects.toThrow(/no raw\.txt in .*earlier stage/);
    await expect(readReview(run)).rejects.toThrow(/no review\.json in .*earlier stage/);
  });
});

describe('render', () => {
  const shellHtml = `<!doctype html><title>r</title>${BUNDLE_PLACEHOLDER}<div id="root"></div>`;

  it('packs the review, header and file contents into the viewer page', async () => {
    await writeStubRun(context(), run);
    const review = await parseRun(context(), run);
    const at = new Date('2026-09-11T10:00:00.000Z');

    await renderRun(context(), review, run, { viewerShell: async () => shellHtml }, at);

    const html = readFileSync(run.html, 'utf8');
    expect(html).not.toContain('</script>\n');
    const text = html.slice(html.indexOf('application/json">') + 18, html.lastIndexOf('</script>'));
    expect(readEmbeddedBundle(text)).toMatchObject({
      ok: true,
      bundle: {
        generatedAt: at.toISOString(),
        meta: { title: 'Staged changes on main' },
        review: { chapters: [{ title: 'a.ts' }, { title: 'b.ts' }] },
        files: { 'src/b.ts': { head: { kind: 'content', content: '</script>\n' } } },
      },
    });
  });
});

/** What a viewer build leaves in a tool clone: the page and its stamp. */
function built(clone: string, html: string): void {
  const dir = path.join(clone, 'build', 'viewer');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'viewer.html'), html);
  writeFileSync(path.join(dir, VIEWER_STAMP_FILE), viewerSourceStamp(clone));
}

describe('the viewer shell', () => {
  function toolClone(): string {
    const clone = path.join(root, 'tool');
    mkdirSync(path.join(clone, 'src', 'web'), { recursive: true });
    writeFileSync(path.join(clone, 'src', 'web', 'page.tsx'), 'export {};\n');
    return clone;
  }

  it('uses the built page while its stamp matches the sources', async () => {
    const clone = toolClone();
    built(clone, 'fresh');
    const build = vi.fn(async () => undefined);
    await expect(viewerShell(clone, build)).resolves.toBe('fresh');
    expect(build).not.toHaveBeenCalled();
  });

  it('rebuilds when the page is missing or its sources changed', async () => {
    const clone = toolClone();
    const build = vi.fn(async (at: string) => built(at, 'rebuilt'));
    await expect(viewerShell(clone, build)).resolves.toBe('rebuilt');

    writeFileSync(path.join(clone, 'src', 'web', 'page.tsx'), 'export const changed = 1;\n');
    await expect(viewerShell(clone, build)).resolves.toBe('rebuilt');
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('ignores test files when stamping', () => {
    const clone = toolClone();
    const before = viewerSourceStamp(clone);
    writeFileSync(path.join(clone, 'src', 'web', 'page.test.tsx'), 'test\n');
    expect(viewerSourceStamp(clone)).toBe(before);
  });
});
