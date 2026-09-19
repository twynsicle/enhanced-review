import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { EmbeddedFileSchema, type EmbeddedFile, type EmbeddedSide } from '../review/bundle.ts';
import { listChangedFileDetails, type ChangedFile } from './diff-files.ts';
import { argBatches } from './git-runner.ts';
import { DiffLineSpanSchema, ReviewFileSchema } from '../review/narrative.ts';
import { buildDiffHunkIndex, type DiffHunk } from '../review/prompt/diff-hunk-catalog.ts';
import { ReviewMetaSchema, type ReviewMeta } from '../review/review-meta.ts';
import { skipReasons, toReviewFiles } from './skip-reasons.ts';
import type { Shell } from './git.ts';
import { RUNS_DIR, type RunFiles } from './run-folder.ts';
import { TargetSchema, type Target } from './targets.ts';

/**
 * The gather stage: everything later stages need, read from git once and
 * written to `context.json`, so the prompt, parse and render stages (and a
 * `--from` rerun) never touch git again. Beside it, one diff file carrying
 * every reviewed file's patch for the agent to read, and the PR description
 * when there is one.
 */
export const DiffHunkSchema = z.object({
  id: z.string(),
  filename: z.string(),
  header: z.string(),
  fileOrder: z.number().int(),
  original: DiffLineSpanSchema,
  modified: DiffLineSpanSchema,
});

export const CommitSchema = z.object({
  sha: z.string(),
  subject: z.string(),
  body: z.string(),
});
export type Commit = z.infer<typeof CommitSchema>;

export const RunContextSchema = z.object({
  target: TargetSchema,
  meta: ReviewMetaSchema,
  /** Every changed file; the ones left out of the review carry `skipped`. */
  files: z.array(ReviewFileSchema),
  /** The path each renamed or copied file came from, by its new path. */
  renamedFrom: z.record(z.string(), z.string()),
  /** The reviewed files' hunks, numbered across the whole change. */
  hunks: z.array(DiffHunkSchema),
  /** Both sides of every reviewed file, in the report bundle's own shape. */
  contents: z.record(z.string(), EmbeddedFileSchema),
  /** The commits under review, oldest first; none for a staged review. */
  commits: z.array(CommitSchema),
  /** Working-tree changes that are not part of the review. */
  dirty: z.array(z.string()),
  /** Lines in `context/diff.patch`, so the prompt can ask for it in one `Read`. */
  diffLines: z.number().int().nonnegative(),
});
export type RunContext = z.infer<typeof RunContextSchema>;

/** Either side of a file over this is embedded as `too-large`, and the report says so instead of a diff. */
export const MAX_EMBED_BYTES = 1_000_000;

const MAX_COMMITS = 200;
const PARALLEL_GIT = 8;
const LITERAL = '--literal-pathspecs';

export async function gather(
  target: Target,
  meta: ReviewMeta,
  shell: Shell,
  run: RunFiles,
): Promise<RunContext> {
  const { baseSha, headSha } = target;
  const changed = await listChangedFileDetails(shell.runners.git, shell.cwd, baseSha, headSha);
  const reasons = await skipReasons(changed, headSha, (args) => shell.git(args));
  const files = toReviewFiles(changed, reasons);
  const reviewed = changed.filter((file) => !reasons.has(file.filename));

  const diffs = await mapLimit(reviewed, PARALLEL_GIT, (file) => fileDiff(shell, target, file));
  const hunks = numberHunks(reviewed, diffs);
  const diffFile = annotatedDiffFile(reviewed, diffs, hunks);
  const contents = await embedContents(shell, target, reviewed);
  const renamedFrom = Object.fromEntries(
    changed.flatMap((file) =>
      file.previousFilename ? [[file.filename, file.previousFilename]] : [],
    ),
  );

  const context: RunContext = {
    target,
    meta: {
      ...meta,
      stats: {
        changedFiles: files.length,
        additions: files.reduce((sum, file) => sum + file.additions, 0),
        deletions: files.reduce((sum, file) => sum + file.deletions, 0),
      },
    },
    files,
    renamedFrom,
    hunks,
    contents,
    commits: target.kind === 'staged' ? [] : await listCommits(shell, baseSha, headSha),
    dirty: target.kind === 'pr' ? [] : await dirtyPaths(shell, target.kind),
    diffLines: diffFile.split('\n').length,
  };

  await writeFile(run.context, `${JSON.stringify(context, null, 2)}\n`);
  await mkdir(path.dirname(run.diff), { recursive: true });
  await writeFile(run.diff, diffFile);
  if (meta.description) {
    await mkdir(path.dirname(run.pr), { recursive: true });
    await writeFile(run.pr, `# ${meta.title}\n\n${meta.description}\n`);
  }
  return context;
}

export async function readContext(run: RunFiles): Promise<RunContext> {
  let raw: string;
  try {
    raw = await readFile(run.context, 'utf8');
  } catch {
    throw new Error(`no context.json in ${run.folder}; run without --from first`);
  }
  const parsed = RunContextSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(`${run.context} is not a context this version of er wrote; run without --from`);
  }
  return parsed.data;
}

/** One file's patch, as git prints it for the whole range. */
function fileDiff(shell: Shell, target: Target, file: ChangedFile): Promise<string> {
  const paths = file.previousFilename ? [file.previousFilename, file.filename] : [file.filename];
  return shell.git([
    LITERAL,
    'diff',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    '--unified=3',
    '--find-renames',
    target.baseSha,
    target.headSha,
    '--',
    ...paths,
  ]);
}

/**
 * Hunk ids across the whole change, in file order. Each patch is catalogued
 * under a plain `diff --git` line naming the file, so user diff settings
 * (prefixes, quoting) cannot hide its hunks from the catalog.
 */
function numberHunks(files: readonly ChangedFile[], diffs: readonly string[]): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  files.forEach((file, index) => {
    const body = diffs[index]!.split('\n').slice(1).join('\n');
    const header = `diff --git a/${file.filename} b/${file.filename}`;
    for (const hunk of buildDiffHunkIndex(`${header}\n${body}`).hunks) {
      hunks.push({ ...hunk, id: `H${String(hunks.length + 1).padStart(4, '0')}` });
    }
  });
  return hunks;
}

/** `context/diff.patch`'s text: every reviewed file's patch, in file order, each hunk's id on the line above its header. */
function annotatedDiffFile(
  files: readonly ChangedFile[],
  diffs: readonly string[],
  hunks: readonly DiffHunk[],
): string {
  const idsByFile = new Map<string, string[]>();
  for (const hunk of hunks)
    idsByFile.set(hunk.filename, [...(idsByFile.get(hunk.filename) ?? []), hunk.id]);
  const patches = files.map((file, index) => {
    const ids = idsByFile.get(file.filename) ?? [];
    let next = 0;
    return diffs[index]!.split('\n')
      .flatMap((line) =>
        line.startsWith('@@ ') && next < ids.length ? [`# ${ids[next++]!}`, line] : [line],
      )
      .join('\n');
  });
  return patches.join('\n');
}

interface TreeEntry {
  type: string;
  oid: string;
  size: number;
}

async function embedContents(
  shell: Shell,
  target: Target,
  files: readonly ChangedFile[],
): Promise<Record<string, EmbeddedFile>> {
  const basePaths = files
    .filter((f) => f.status !== 'added')
    .map((f) => f.previousFilename ?? f.filename);
  const headPaths = files.filter((f) => f.status !== 'removed').map((f) => f.filename);
  const [baseTree, headTree] = await Promise.all([
    treeEntries(shell, target.baseSha, basePaths),
    treeEntries(shell, target.headSha, headPaths),
  ]);
  const sides = await mapLimit(files, PARALLEL_GIT, async (file) => {
    const base =
      file.status === 'added' ? undefined : baseTree.get(file.previousFilename ?? file.filename);
    const head = file.status === 'removed' ? undefined : headTree.get(file.filename);
    return [
      file.filename,
      { base: await embedSide(shell, base), head: await embedSide(shell, head) },
    ] as const;
  });
  return Object.fromEntries(sides);
}

async function embedSide(shell: Shell, entry: TreeEntry | undefined): Promise<EmbeddedSide> {
  if (!entry) return { kind: 'absent' };
  // A submodule is a commit, not a blob: show it the way git's diff does.
  if (entry.type === 'commit')
    return { kind: 'content', content: `Subproject commit ${entry.oid}\n` };
  if (entry.size > MAX_EMBED_BYTES) return { kind: 'too-large' };
  return { kind: 'content', content: await shell.git(['cat-file', 'blob', entry.oid]) };
}

/** `git ls-tree -l` for just these paths: type, object id and size. */
async function treeEntries(
  shell: Shell,
  commit: string,
  paths: readonly string[],
): Promise<Map<string, TreeEntry>> {
  const entries = new Map<string, TreeEntry>();
  for (const batch of argBatches(paths)) {
    const out = await shell.git([
      LITERAL,
      'ls-tree',
      '-r',
      '-l',
      '-z',
      '--full-tree',
      commit,
      '--',
      ...batch,
    ]);
    // `<mode> <type> <object> <size>\t<path>\0`; a submodule's size is `-`.
    for (const record of out.split('\0')) {
      const tab = record.indexOf('\t');
      if (tab === -1) continue;
      const [, type = '', oid = '', size = '0'] = record.slice(0, tab).split(/\s+/);
      entries.set(record.slice(tab + 1), { type, oid, size: Number(size) || 0 });
    }
  }
  return entries;
}

async function listCommits(shell: Shell, baseSha: string, headSha: string): Promise<Commit[]> {
  const out = await shell.git([
    'log',
    '-z',
    '--reverse',
    `--max-count=${String(MAX_COMMITS)}`,
    '--format=%H%n%s%n%b',
    `${baseSha}..${headSha}`,
  ]);
  return out
    .split('\0')
    .filter((record) => record.trim() !== '')
    .map((record) => {
      const [sha = '', subject = '', ...body] = record.split('\n');
      return { sha, subject, body: body.join('\n').trim() };
    });
}

/**
 * `git status` entries the review does not contain: anything uncommitted for
 * a branch review; unstaged and untracked changes for a staged one.
 */
async function dirtyPaths(shell: Shell, kind: 'branch' | 'staged'): Promise<string[]> {
  const out = await shell.git(['status', '--porcelain=v1', '-z']);
  const paths: string[] = [];
  const fields = out.split('\0');
  for (let i = 0; i < fields.length; i += 1) {
    const entry = fields[i]!;
    if (entry.length < 4) continue;
    const [index, worktree, name] = [entry[0]!, entry[1]!, entry.slice(3)];
    // A rename or copy in the index is followed by its source path.
    if (index === 'R' || index === 'C') i += 1;
    if (name === RUNS_DIR || name.startsWith(`${RUNS_DIR}/`)) continue;
    if (kind === 'branch' || worktree !== ' ') paths.push(name);
  }
  return paths;
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
