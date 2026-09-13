import type { ChangedFile } from './clone/diff-files.server.ts';
import { argBatches } from './clone/git-runner.server.ts';
import type { ReviewFile, ReviewFileSkipReason } from './narrative.ts';
import { binarySkipReason, builtInSkipReason } from './prompt/ai-file-filter.ts';

/**
 * One git command run in the repository under review: stdout, or a throw when
 * git exits non-zero. Injected because the two review paths reach git on
 * deliberately different terms — the hosted runner drives a fresh clone with
 * the host's own git configuration neutralised, while `er` drives the
 * engineer's repository and needs their configuration to reach it at all — and
 * which of those is right is not this module's call.
 */
export type RunGit = (args: readonly string[]) => Promise<string>;

const ATTRIBUTES = ['linguist-generated', 'linguist-vendored'] as const;

/**
 * Why each changed file is left out of the review, by path; a path the map has
 * no entry for goes to the model. This is the one decision, and both review
 * paths make it here: `buildNarrativePrompt` reviews exactly the files carrying
 * no reason, so what the reader dims and what the model is asked about cannot
 * disagree.
 *
 * Three layers, the first match winning: the built-in list, the reviewed
 * repository's own `.gitattributes`, then binary. The middle layer is the
 * repository saying which of its files are machine-written, and git resolves it
 * — for `a/b/c.ts` it reads `a/b/.gitattributes`, then `a/.gitattributes`, then
 * the root, the closest match winning — so a repository that keeps its marks
 * anywhere but the root needs nothing from us. Asking at `headSha` rather than
 * against the working tree is what lets a local review of a dirty tree agree
 * with a hosted review of the same commit.
 */
export async function skipReasons(
  files: readonly ChangedFile[],
  headSha: string,
  git: RunGit,
): Promise<Map<string, ReviewFileSkipReason>> {
  const reasons = new Map<string, ReviewFileSkipReason>();
  for (const file of files) {
    const builtIn = builtInSkipReason(file.filename);
    if (builtIn) reasons.set(file.filename, builtIn);
  }

  const unclassified = files.map((file) => file.filename).filter((name) => !reasons.has(name));
  for (const batch of argBatches(unclassified)) {
    const out = await git([
      'check-attr',
      `--source=${headSha}`,
      '-z',
      ...ATTRIBUTES,
      '--',
      ...batch,
    ]);
    // `<path>\0<attribute>\0<value>\0`, generated before vendored for each path.
    const fields = out.split('\0');
    for (let i = 0; i + 2 < fields.length; i += 3) {
      const [name, attribute, value] = [fields[i]!, fields[i + 1]!, fields[i + 2]!];
      if (reasons.has(name) || (value !== 'set' && value !== 'true')) continue;
      reasons.set(name, attribute === 'linguist-generated' ? 'generated' : 'vendored');
    }
  }

  for (const file of files) {
    const binary = binarySkipReason(file.binary);
    if (binary && !reasons.has(file.filename)) reasons.set(file.filename, binary);
  }
  return reasons;
}

/**
 * The changed files as a review records them, each one it leaves out carrying
 * why. The prompt drops those patches silently, so without the reason here the
 * stored file looks reviewed-but-unmentioned: the sidebar lists it undimmed,
 * and the coverage backstop counts a lockfile against the model's chapters.
 */
export function toReviewFiles(
  files: readonly ChangedFile[],
  reasons: ReadonlyMap<string, ReviewFileSkipReason>,
): ReviewFile[] {
  return files.map(({ filename, status, additions, deletions }) => {
    const skipped = reasons.get(filename);
    return { filename, status, additions, deletions, ...(skipped ? { skipped } : {}) };
  });
}
