import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { EmbeddedFileSchema, type EmbeddedFile, type EmbeddedSide } from '../review/bundle.ts';
import { listChangedFileDetails, type ChangedFile } from './diff-files.ts';
import { argBatches, mapLimit, PARALLEL_GIT } from './git-runner.ts';
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
const LITERAL = '--literal-pathspecs';

/**
 * Pairs added files git found no origin for with sources found some other
 * way, and returns the file list with those pairs in it.
 */
export type FindSources = (
  files: readonly ChangedFile[],
  unpaired: readonly string[],
) => Promise<ChangedFile[]>;

export interface GatherOptions {
  /**
   * Sees how many files will be reviewed before any of them is diffed or
   * embedded, so a change too big to run is refused before gather reads every
   * blob in it.
   */
  checkReviewed?: (count: number) => void;
  findSources?: FindSources;
}

export async function gather(
  target: Target,
  meta: ReviewMeta,
  shell: Shell,
  run: RunFiles,
  { checkReviewed, findSources }: GatherOptions = {},
): Promise<RunContext> {
  const { baseSha, headSha } = target;
  let changed = await listChangedFileDetails(shell.runners.git, shell.cwd, baseSha, headSha);
  const reasons = await skipReasons(changed, headSha, (args) => shell.git(args));
  checkReviewed?.(changed.filter((file) => !reasons.has(file.filename)).length);
  if (findSources) {
    const unpaired = changed
      .filter((file) => file.status === 'added' && !reasons.has(file.filename))
      .map((file) => file.filename);
    if (unpaired.length > 0) changed = await findSources(changed, unpaired);
  }
  const reviewable = changed.filter((file) => !reasons.has(file.filename));
  const diffs = await mapLimit(reviewable, PARALLEL_GIT, (file) => fileDiff(shell, target, file));
  const reviewed = reviewable.map((file, index) =>
    identicalCopy(file) ? countedAsNew(file, diffs[index]!) : file,
  );
  const counted = new Map(reviewed.map((file) => [file.filename, file]));
  const files = toReviewFiles(
    changed.map((file) => counted.get(file.filename) ?? file),
    reasons,
  );

  const hunks = numberHunks(reviewed, diffs);
  const diffFile = annotatedDiffFile(reviewed, diffs, hunks);
  const contents = await embedContents(shell, target, reviewed);

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

/**
 * One file's patch, as git prints it for the whole range. A rename is diffed
 * over just its two paths, where the 1% threshold can only pair those two: it
 * is what keeps a pair that the file list matched through the branch's history
 * (below git's usual 50%) a rename here too, rather than a delete and an add.
 *
 * The file list decided that pairing with its own git call, so this checks the
 * patch agrees: two file sections would have `numberHunks` catalogue the old
 * file's deletions under the new name, a review that looks whole and is wrong.
 *
 * A copy is diffed blob against blob instead. Its source is still there at the
 * head, and when the branch changed it too, a diff over the two paths prints
 * that change as a second section.
 */
async function fileDiff(shell: Shell, target: Target, file: ChangedFile): Promise<string> {
  const pins = ['--no-color', '--no-ext-diff', '--no-textconv', '--unified=3'];
  if (identicalCopy(file)) {
    return shell.git([
      LITERAL,
      'diff',
      ...pins,
      '--no-renames',
      target.baseSha,
      target.headSha,
      '--',
      file.filename,
    ]);
  }
  if (file.status === 'copied' && file.origin) {
    return shell.git([
      'diff',
      ...pins,
      `${target.baseSha}:${file.origin.filename}`,
      `${target.headSha}:${file.filename}`,
    ]);
  }
  const paths = file.origin ? [file.origin.filename, file.filename] : [file.filename];
  const patch = await shell.git([
    LITERAL,
    'diff',
    ...pins,
    '--find-renames=1%',
    target.baseSha,
    target.headSha,
    '--',
    ...paths,
  ]);
  const sections = patch.split('\n').filter((line) => line.startsWith('diff --git ')).length;
  if (sections > 1) {
    throw new Error(
      `git diffed ${paths.join(' and ')} as ${String(sections)} files where the file list paired them as one`,
    );
  }
  return patch;
}

/**
 * A copy identical to its source is shown as the new file it is. Diffed
 * against the source it would have no hunk at all, leaving nothing a chapter
 * could cite for a file the reviewer may well want to question.
 */
function identicalCopy(file: ChangedFile): boolean {
  return file.status === 'copied' && file.origin?.identical === true;
}

/**
 * Git counts an identical copy's lines against its source, where nothing
 * changed; the review shows every one as added, as its one hunk's header says.
 */
function countedAsNew(file: ChangedFile, patch: string): ChangedFile {
  const header = /^@@ -0,0 \+1(?:,(\d+))? @@/m.exec(patch);
  const additions = header ? Number(header[1] ?? '1') : 0;
  return { ...file, additions, deletions: 0 };
}

/** The path a file had at the base, or null when the review shows it as new. */
function basePath(file: ChangedFile): string | null {
  if (file.status === 'added' || identicalCopy(file)) return null;
  return file.origin?.filename ?? file.filename;
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
  const basePaths = files.flatMap((f) => basePath(f) ?? []);
  const headPaths = files.filter((f) => f.status !== 'removed').map((f) => f.filename);
  const [baseTree, headTree] = await Promise.all([
    treeEntries(shell, target.baseSha, basePaths),
    treeEntries(shell, target.headSha, headPaths),
  ]);
  const sides = await mapLimit(files, PARALLEL_GIT, async (file) => {
    const from = basePath(file);
    const base = from === null ? undefined : baseTree.get(from);
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
export async function treeEntries(
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
