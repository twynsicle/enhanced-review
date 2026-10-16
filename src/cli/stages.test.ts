import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUNDLE_PLACEHOLDER, readEmbeddedBundle } from '../review/bundle-html.ts';
import { withFileHunks } from '../review/coverage.ts';
import type { RunContext } from './context.ts';
import { Shell } from './git.ts';
import { parseRun, readFindings, readReview } from './parse.ts';
import { renderRun, reportShell } from './render.ts';
import { runFiles, type RunFiles } from './run-folder.ts';
import { writeStubRun } from './stub-run.ts';
import { SHELL_STAMP_FILE, shellSourceStamp } from './shell-stamp.ts';

vi.mock('./terminal.ts', () => ({ note: vi.fn() }));

/** The stub cites no excerpt, so nothing here may need git. */
const noGit = new Shell('.', {
  git: () => Promise.reject(new Error('these stages read no git')),
  gh: () => Promise.reject(new Error('these stages read no gh')),
});

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
  changedLines: 4,
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
      kind: 'branch',
      title: 'Staged changes on main',
      baseSha: 'a'.repeat(40),
      headSha: 'b'.repeat(40),
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
    await writeStubRun(context(), run, ['narrative']);
    const { review, findings } = await parseRun(context(), run, ['narrative'], noGit);

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
    // No model chose a brief, so the first chapter stands in for it.
    expect(review.readingPlan).toEqual({ brief: ['file-1'], standard: ['file-1', 'file-2'] });
    // The files come from context, each carrying its share of the catalog.
    expect(review.files).toEqual(withFileHunks(context().files, context().hunks));
    expect(review.files?.map((file) => file.hunks?.map((h) => h.id))).toEqual([
      ['H0001', 'H0002'],
      ['H0003'],
      undefined,
    ]);
    await expect(readReview(run)).resolves.toEqual(review);
  });

  it('skims a whitespace-only hunk and reads the rest, a move unchanged included', async () => {
    const tiered = context({
      hunks: [
        hunk('H0001', 'src/a.ts', 1),
        { ...hunk('H0002', 'src/a.ts', 2), whitespaceOnly: true },
        { ...hunk('H0003', 'src/b.ts', 1), movedFrom: { filename: 'src/a.ts', similarity: 100 } },
        { ...hunk('H0004', 'src/b.ts', 2), movedFrom: { filename: 'src/a.ts', similarity: 90 } },
      ],
    });
    await writeStubRun(tiered, run, ['narrative']);
    const { review, findings } = await parseRun(tiered, run, ['narrative'], noGit);

    expect(findings).toEqual([]);
    expect(
      review.chapters.flatMap((chapter) =>
        chapter.diffChunks.flatMap((chunk) => chunk.hunks.map((h) => [h.id, h.tier])),
      ),
    ).toEqual([
      ['H0001', 'read'],
      ['H0002', 'skim'],
      ['H0003', 'read'],
      ['H0004', 'read'],
    ]);
  });

  it('still writes a review when every file was skipped', async () => {
    const onlySkipped = context({ files: [context().files[2]!], hunks: [], contents: {} });
    await writeStubRun(onlySkipped, run, ['narrative']);
    const { review } = await parseRun(onlySkipped, run, ['narrative'], noGit);
    expect(review.chapters.map((chapter) => chapter.id)).toEqual(['nothing-reviewed']);
  });

  it("points at raw.txt when the model's answer does not parse", async () => {
    await writeStubRun(context(), run, ['narrative']);
    writeFileSync(run.raw, 'I could not finish the review.');
    await expect(parseRun(context(), run, ['narrative'], noGit)).rejects.toThrow(
      `The answer contains no complete <narrative_review> block. The model's answer is in ${run.raw}; ` +
        'fix it there and rerun with --from parse',
    );
  });

  it('writes the findings of a failed parse, and no review to render from', async () => {
    await writeStubRun(context(), run, ['narrative']);
    writeFileSync(run.raw, 'I could not finish the review.');
    await expect(parseRun(context(), run, ['narrative'], noGit)).rejects.toThrow(
      /no complete <narrative_review>/,
    );

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
    await writeStubRun(context(), run, ['narrative']);
    await parseRun(context(), run, ['narrative'], noGit);
    expect(existsSync(run.review)).toBe(true);
    expect(existsSync(run.excerpts)).toBe(true);

    writeFileSync(run.raw, 'I could not finish the review.');
    await expect(parseRun(context(), run, ['narrative'], noGit)).rejects.toThrow(
      /no complete <narrative_review>/,
    );

    // Left there, `--from render` would draw the earlier answer as this run's.
    expect(existsSync(run.review)).toBe(false);
    expect(existsSync(run.excerpts)).toBe(false);
  });

  it('reads what the run itself cost off events.jsonl, so --from parse reports it too', async () => {
    await writeStubRun(context(), run, ['narrative']);
    writeFileSync(
      run.events,
      [
        JSON.stringify({ ms: 1, type: 'denied', tool: 'Bash', detail: 'rm -rf .' }),
        JSON.stringify({ ms: 2, type: 'blocked', attempt: 1, reason: 'a hunk was uncited' }),
        JSON.stringify({ ms: 3, type: 'result', subtype: 'success', isError: false }),
        'half a line, from a run that was kill',
      ].join('\n'),
    );

    const { findings } = await parseRun(context(), run, ['narrative'], noGit);

    expect(findings.map((item) => [item.code, item.severity])).toEqual([
      ['commands-refused', 'warning'],
      ['passed-after-retry', 'warning'],
    ]);
    expect(findings[0]?.message).toContain('1 command');
    expect(findings[1]?.message).toContain('1 further attempt');
    expect(JSON.parse(readFileSync(run.findings, 'utf8'))).toEqual(findings);
  });

  it('fails the review when the run behind it did not finish cleanly', async () => {
    await writeStubRun(context(), run, ['narrative']);
    writeFileSync(
      run.events,
      `${JSON.stringify({ type: 'result', subtype: 'error_max_turns' })}\n`,
    );

    const failure = await parseRun(context(), run, ['narrative'], noGit).then(
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
    await writeStubRun(context(), run, ['narrative']);
    writeFileSync(run.events, `${JSON.stringify({ type: 'tool', tool: 'Read' })}\n`);

    await expect(parseRun(context(), run, ['narrative'], noGit)).rejects.toThrow(
      /did not finish cleanly \(no result\)/,
    );
  });

  /** An empty findings list and no record of the run are not the same thing. */
  it('fails the review when nothing recorded how the run ended', async () => {
    await writeStubRun(context(), run, ['narrative']);
    rmSync(run.events);

    await expect(parseRun(context(), run, ['narrative'], noGit)).rejects.toThrow(
      /no record of how the run ended.*Run again from the run stage/s,
    );
  });

  it('says which stage to run when a stage file is missing', async () => {
    await expect(parseRun(context(), run, ['narrative'], noGit)).rejects.toThrow(
      /no raw\.txt in .*earlier stage/,
    );
    await expect(readReview(run)).rejects.toThrow(/no review\.json in .*earlier stage/);
    await expect(readFindings(run)).rejects.toThrow(/no findings\.json in .*run from parse/);
  });

  it('refuses to hand a render stage the findings of a parse that failed', async () => {
    await writeStubRun(context(), run, ['narrative']);
    writeFileSync(run.raw, 'I could not finish the review.');
    await expect(parseRun(context(), run, ['narrative'], noGit)).rejects.toThrow(
      /no complete <narrative_review>/,
    );

    await expect(readFindings(run)).rejects.toThrow(
      /the last parse failed; run from parse\. The answer contains no complete/,
    );
  });

  it('says to run from parse when findings.json was cut off mid-write', async () => {
    writeFileSync(run.findings, '[{"code":"commands-refused","sev');
    await expect(readFindings(run)).rejects.toThrow(/was not fully written; run from parse/);
  });

  it('hands the render stage what the last parse recorded', async () => {
    await writeStubRun(context(), run, ['narrative']);
    writeFileSync(
      run.events,
      [
        JSON.stringify({ ms: 1, type: 'denied', tool: 'Bash', detail: 'rm -rf .' }),
        JSON.stringify({ ms: 3, type: 'result', subtype: 'success', isError: false }),
      ].join('\n'),
    );
    const { findings } = await parseRun(context(), run, ['narrative'], noGit);

    await expect(readFindings(run)).resolves.toEqual(findings);
  });
});

function excerpt(startLine: number, endLine: number, filename = 'src/runner.ts') {
  return { filename, startLine, endLine, reason: 'Reads it.' };
}

describe('render', () => {
  const shellHtml = `<!doctype html><title>r</title>${BUNDLE_PLACEHOLDER}<div id="root"></div>`;

  it('packs the review, header and file contents into the report shell', async () => {
    await writeStubRun(context(), run, ['narrative']);
    const { review } = await parseRun(context(), run, ['narrative'], noGit);
    const at = new Date('2026-09-11T10:00:00.000Z');

    await renderRun(context(), review, run, { reportShell: async () => shellHtml }, at);

    const html = readFileSync(run.html, 'utf8');
    expect(html).not.toContain('</script>\n');
    const text = html.slice(html.indexOf('application/json">') + 18, html.lastIndexOf('</script>'));
    expect(readEmbeddedBundle(text)).toMatchObject({
      ok: true,
      bundle: {
        generatedAt: at.toISOString(),
        meta: { title: 'Staged changes on main', baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40) },
        review: { chapters: [{ title: 'a.ts' }, { title: 'b.ts' }] },
        files: { 'src/b.ts': { head: { kind: 'content', content: '</script>\n' } } },
      },
    });
  });

  it.each([
    ['an excerpt excerpts.json does not have', 'src/runner.ts', {}],
    ['an excerpt of a changed file', 'src/a.ts', { 'src/a.ts': 'a' }],
    ['an excerpt named after an object member excerpts.json does not have', 'toString', {}],
    [
      'an excerpt past the end of the text excerpts.json holds',
      'src/runner.ts',
      { 'src/runner.ts': '' },
    ],
  ])(
    'refuses %s, since review.json and excerpts.json came from different parses',
    async (_, filename, excerpts) => {
      await writeStubRun(context(), run, ['narrative']);
      const { review } = await parseRun(context(), run, ['narrative'], noGit);
      writeFileSync(run.excerpts, JSON.stringify(excerpts));
      const [first, ...rest] = review.chapters;
      const excerpted = {
        ...review,
        chapters: [
          {
            ...first!,
            contextExcerpts: [{ filename, startLine: 1, endLine: 1, reason: 'Reads it.' }],
          },
          ...rest,
        ],
      };

      await expect(
        renderRun(context(), excerpted, run, { reportShell: async () => shellHtml }),
      ).rejects.toThrow(
        `the review's excerpt of ${filename} does not match the parse that wrote it; run from parse`,
      );
      expect(existsSync(run.html)).toBe(false);
    },
  );

  it('embeds an excerpted file as its head side alone, blank but for the lines excerpts show', async () => {
    await writeStubRun(context(), run, ['narrative']);
    const { review } = await parseRun(context(), run, ['narrative'], noGit);
    const lines = Array.from({ length: 10 }, (_, at) => `line ${String(at + 1)}`);
    writeFileSync(run.excerpts, JSON.stringify({ 'src/runner.ts': `${lines.join('\n')}\n` }));
    const [first, second] = review.chapters;
    const excerpted = {
      ...review,
      chapters: [
        { ...first!, contextExcerpts: [excerpt(2, 3)] },
        { ...second!, contextExcerpts: [excerpt(6, 6)] },
      ],
    };

    await renderRun(context(), excerpted, run, { reportShell: async () => shellHtml });

    const html = readFileSync(run.html, 'utf8');
    const text = html.slice(html.indexOf('application/json">') + 18, html.lastIndexOf('</script>'));
    const embedded = readEmbeddedBundle(text);
    if (!embedded.ok) throw new Error(`no bundle: ${embedded.reason}`);
    expect(embedded.bundle.files['src/runner.ts']).toEqual({
      base: { kind: 'absent' },
      head: { kind: 'content', content: ['', 'line 2', 'line 3', '', '', 'line 6'].join('\n') },
    });
  });

  it('embeds a root file named after an object member like any other', async () => {
    await writeStubRun(context(), run, ['narrative']);
    const { review } = await parseRun(context(), run, ['narrative'], noGit);
    writeFileSync(run.excerpts, JSON.stringify({ constructor: 'one\ntwo\n' }));
    const [first, ...rest] = review.chapters;
    const excerpted = {
      ...review,
      chapters: [{ ...first!, contextExcerpts: [excerpt(2, 2, 'constructor')] }, ...rest],
    };

    await renderRun(context(), excerpted, run, { reportShell: async () => shellHtml });

    const html = readFileSync(run.html, 'utf8');
    const text = html.slice(html.indexOf('application/json">') + 18, html.lastIndexOf('</script>'));
    const embedded = readEmbeddedBundle(text);
    if (!embedded.ok) throw new Error(`no bundle: ${embedded.reason}`);
    expect(Object.hasOwn(embedded.bundle.files, 'constructor')).toBe(true);
    expect(embedded.bundle.files['constructor']?.head).toEqual({
      kind: 'content',
      content: '\ntwo',
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
