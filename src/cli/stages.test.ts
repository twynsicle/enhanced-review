import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUNDLE_PLACEHOLDER, readEmbeddedBundle } from '../review/bundle-html.ts';
import { withFileHunks } from '../review/coverage.ts';
import type { RunContext } from './context.ts';
import { parseRun, readFindings, readReview } from './parse.ts';
import { renderRun, reportShell } from './render.ts';
import { runFiles, type RunFiles } from './run-folder.ts';
import { writeStubRun } from './stub-run.ts';
import { SHELL_STAMP_FILE, shellSourceStamp } from './shell-stamp.ts';

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
    diffLines: 0,
    ...overrides,
  };
}

describe('stub run → parse', () => {
  it('gives each reviewed file a chapter citing all its hunks', async () => {
    await writeStubRun(context(), run);
    const { review, findings } = await parseRun(context(), run);

    expect(review.prTitle).toBe('Staged changes on main');
    // The stub's own event log says the run ended cleanly, so nothing to report.
    expect(findings).toEqual([]);
    expect(JSON.parse(readFileSync(run.findings, 'utf8'))).toEqual([]);
    expect(
      review.chapters.map((chapter) => ({
        title: chapter.title,
        cited: chapter.diffChunks.flatMap((chunk) => chunk.hunks.map((h) => h.id)),
      })),
    ).toEqual([
      { title: 'a.ts', cited: ['H0001', 'H0002'] },
      { title: 'b.ts', cited: ['H0003'] },
    ]);
    // The files come from context, each carrying its share of the catalog.
    expect(review.files).toEqual(withFileHunks(context().files, context().hunks));
    expect(review.files?.map((file) => file.hunks?.map((h) => h.id))).toEqual([
      ['H0001', 'H0002'],
      ['H0003'],
      undefined,
    ]);
    await expect(readReview(run)).resolves.toEqual(review);
  });

  it('still writes a review when every file was skipped', async () => {
    const onlySkipped = context({ files: [context().files[2]!], hunks: [], contents: {} });
    await writeStubRun(onlySkipped, run);
    const { review } = await parseRun(onlySkipped, run);
    expect(review.chapters.map((chapter) => chapter.id)).toEqual(['nothing-reviewed']);
  });

  it("points at raw.txt when the model's answer does not parse", async () => {
    await writeStubRun(context(), run);
    writeFileSync(run.raw, 'I could not finish the review.');
    await expect(parseRun(context(), run)).rejects.toThrow(
      `The answer contains no complete <narrative_review> block. The model's answer is in ${run.raw}; ` +
        'fix it there and rerun with --from parse',
    );
  });

  it('writes the findings of a failed parse, and no review to render from', async () => {
    await writeStubRun(context(), run);
    writeFileSync(run.raw, 'I could not finish the review.');
    await expect(parseRun(context(), run)).rejects.toThrow(/no complete <narrative_review>/);

    expect(JSON.parse(readFileSync(run.findings, 'utf8'))).toEqual([
      {
        code: 'answer-missing-block',
        severity: 'fatal',
        message: 'The answer contains no complete <narrative_review> block.',
      },
    ]);
    expect(existsSync(run.review)).toBe(false);
  });

  it('takes the review an earlier parse wrote away with it when it fails', async () => {
    await writeStubRun(context(), run);
    await parseRun(context(), run);
    expect(existsSync(run.review)).toBe(true);

    writeFileSync(run.raw, 'I could not finish the review.');
    await expect(parseRun(context(), run)).rejects.toThrow(/no complete <narrative_review>/);

    // Left there, `--from render` would draw the earlier answer as this run's.
    expect(existsSync(run.review)).toBe(false);
  });

  it('reads what the run itself cost off events.jsonl, so --from parse reports it too', async () => {
    await writeStubRun(context(), run);
    writeFileSync(
      run.events,
      [
        JSON.stringify({ ms: 1, type: 'denied', tool: 'Bash', detail: 'rm -rf .' }),
        JSON.stringify({ ms: 2, type: 'blocked', attempt: 1, reason: 'a hunk was uncited' }),
        JSON.stringify({ ms: 3, type: 'result', subtype: 'success', isError: false }),
        'half a line, from a run that was kill',
      ].join('\n'),
    );

    const { findings } = await parseRun(context(), run);

    expect(findings.map((item) => [item.code, item.severity])).toEqual([
      ['commands-refused', 'warning'],
      ['passed-after-retry', 'warning'],
    ]);
    expect(findings[0]?.message).toContain('1 command');
    expect(findings[1]?.message).toContain('1 further attempt');
    expect(JSON.parse(readFileSync(run.findings, 'utf8'))).toEqual(findings);
  });

  it('fails the review when the run behind it did not finish cleanly', async () => {
    await writeStubRun(context(), run);
    writeFileSync(
      run.events,
      `${JSON.stringify({ type: 'result', subtype: 'error_max_turns' })}\n`,
    );

    const failure = await parseRun(context(), run).then(
      () => new Error('the parse did not fail'),
      (error: unknown) => error as Error,
    );
    expect(failure.message).toMatch(
      /did not finish cleanly \(error_max_turns\).*Raise --max-turns/s,
    );
    // Editing raw.txt cannot give the reviewer back the turns it never took,
    // so this failure does not offer it.
    expect(failure.message).not.toContain(run.raw);
  });

  it('fails the review when the run left no result at all', async () => {
    await writeStubRun(context(), run);
    writeFileSync(run.events, `${JSON.stringify({ type: 'tool', tool: 'Read' })}\n`);

    await expect(parseRun(context(), run)).rejects.toThrow(/did not finish cleanly \(no result\)/);
  });

  /** An empty findings list and no record of the run are not the same thing. */
  it('fails the review when nothing recorded how the run ended', async () => {
    await writeStubRun(context(), run);
    rmSync(run.events);

    await expect(parseRun(context(), run)).rejects.toThrow(
      /no record of how the run ended.*Run again from the run stage/s,
    );
  });

  it('says which stage to run when a stage file is missing', async () => {
    await expect(parseRun(context(), run)).rejects.toThrow(/no raw\.txt in .*earlier stage/);
    await expect(readReview(run)).rejects.toThrow(/no review\.json in .*earlier stage/);
    await expect(readFindings(run)).rejects.toThrow(/no findings\.json in .*run from parse/);
  });

  it('refuses to hand a render stage the findings of a parse that failed', async () => {
    await writeStubRun(context(), run);
    writeFileSync(run.raw, 'I could not finish the review.');
    await expect(parseRun(context(), run)).rejects.toThrow(/no complete <narrative_review>/);

    await expect(readFindings(run)).rejects.toThrow(
      /the last parse failed; run from parse\. The answer contains no complete/,
    );
  });

  it('says to run from parse when findings.json was cut off mid-write', async () => {
    writeFileSync(run.findings, '[{"code":"commands-refused","sev');
    await expect(readFindings(run)).rejects.toThrow(/was not fully written; run from parse/);
  });

  it('hands the render stage what the last parse recorded', async () => {
    await writeStubRun(context(), run);
    writeFileSync(
      run.events,
      [
        JSON.stringify({ ms: 1, type: 'denied', tool: 'Bash', detail: 'rm -rf .' }),
        JSON.stringify({ ms: 3, type: 'result', subtype: 'success', isError: false }),
      ].join('\n'),
    );
    const { findings } = await parseRun(context(), run);

    await expect(readFindings(run)).resolves.toEqual(findings);
  });
});

describe('render', () => {
  const shellHtml = `<!doctype html><title>r</title>${BUNDLE_PLACEHOLDER}<div id="root"></div>`;

  it('packs the review, header and file contents into the report shell', async () => {
    await writeStubRun(context(), run);
    const { review } = await parseRun(context(), run);
    const at = new Date('2026-09-11T10:00:00.000Z');

    await renderRun(context(), review, run, { reportShell: async () => shellHtml }, at);

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

/** What a shell build leaves in a tool clone: the page and its stamp. */
function built(clone: string, html: string): void {
  const dir = path.join(clone, 'build', 'report');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'shell.html'), html);
  writeFileSync(path.join(dir, SHELL_STAMP_FILE), shellSourceStamp(clone));
}

describe('the report shell', () => {
  function toolClone(): string {
    const clone = path.join(root, 'tool');
    mkdirSync(path.join(clone, 'src', 'report'), { recursive: true });
    writeFileSync(path.join(clone, 'src', 'report', 'page.tsx'), 'export {};\n');
    return clone;
  }

  it('uses the built page while its stamp matches the sources', async () => {
    const clone = toolClone();
    built(clone, 'fresh');
    const build = vi.fn(async () => undefined);
    await expect(reportShell(clone, build)).resolves.toBe('fresh');
    expect(build).not.toHaveBeenCalled();
  });

  it('rebuilds when the page is missing or its sources changed', async () => {
    const clone = toolClone();
    const build = vi.fn(async (at: string) => built(at, 'rebuilt'));
    await expect(reportShell(clone, build)).resolves.toBe('rebuilt');

    writeFileSync(path.join(clone, 'src', 'report', 'page.tsx'), 'export const changed = 1;\n');
    await expect(reportShell(clone, build)).resolves.toBe('rebuilt');
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('ignores test files when stamping', () => {
    const clone = toolClone();
    const before = shellSourceStamp(clone);
    writeFileSync(path.join(clone, 'src', 'report', 'page.test.tsx'), 'test\n');
    expect(shellSourceStamp(clone)).toBe(before);
  });
});
