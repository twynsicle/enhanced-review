import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { readContext, type RunContext } from '../cli/context.ts';
import { runFiles } from '../cli/run-folder.ts';
import type { DiffHunk } from '../review/prompt/diff-hunk-catalog.ts';
import { provenSkim } from '../review/narrative.ts';
import { caseFiles, writeCase, type CaseFiles, type Label, type SkimCase } from './skim-case.ts';
import type { TierAnswer } from './skim-answer.ts';
import { citedTiers, readReviewTiers, type ReviewTiers } from './skim-review.ts';

/**
 * A case is cut from a run folder: the gather stage's `context.json` holds
 * what the prompt showed, `context/diff.patch` is the change, and the run's
 * own `review.json`, when the run reached one, seeds each label with the tier
 * the model gave. Correcting a seeded tier is far quicker than labelling from
 * nothing, and the seed is also the first sample of how the model does.
 *
 * A `--stub` run seeds every hunk `read`, which is how a contrived change
 * becomes a case without paying for a model: write the branch, stub it,
 * import it, label it. A contrived run has no pull request, so its title and
 * description, and the folder the case is kept as coming from, are given by
 * the caller.
 */
export interface ImportOverrides {
  title?: string;
  description?: string | null;
  folder?: string;
}

export async function importCase(
  runFolder: string,
  name: string,
  root: string,
  overrides: ImportOverrides = {},
): Promise<CaseFiles> {
  const files = caseFiles(root, name);
  if (await exists(files.labels)) {
    throw new Error(
      `${files.folder} already exists; its labels are hand work, so pick another name`,
    );
  }
  const run = runFiles(runFolder);
  const context = await readContext(run);
  const diff = await readFile(run.diff, 'utf8');
  const review = await readReviewTiers(run.review);
  const skimCase = trimCase(name, runFolder, context, overrides);
  await writeCase(files, { case: skimCase, diff, labels: seedLabels(skimCase.hunks, review) });
  return files;
}

/** What the prompt shows of a run, without the embedded file contents. */
export function trimCase(
  name: string,
  folder: string,
  context: RunContext,
  overrides: ImportOverrides = {},
): SkimCase {
  return {
    name,
    source: {
      folder: overrides.folder ?? folder,
      repo: context.meta.repo,
      kind: context.target.kind,
    },
    title: overrides.title ?? context.meta.title,
    description:
      overrides.description === undefined ? context.meta.description : overrides.description,
    commits: context.commits,
    files: context.files,
    hunks: context.hunks,
  };
}

/**
 * One label per catalog hunk, in catalog order: `proven` where the tool
 * settles the tier, else the review's tier for it, `read` winning over `skim`
 * when chapters disagree (as the parser merges them), and `read` where no
 * review cited it. The model's own skim reason rides along as the note.
 */
export function seedLabels(hunks: readonly DiffHunk[], review: ReviewTiers | null): Label[] {
  const cited = review ? citedTiers(review) : new Map<string, TierAnswer>();
  return hunks.map((hunk) => {
    const base = { id: hunk.id, file: hunk.filename, header: hunk.header };
    if (provenSkim(hunk)) return { ...base, tier: 'proven' as const };
    const seed = cited.get(hunk.id);
    if (!seed) return { ...base, tier: 'read' as const };
    return { ...base, tier: seed.tier, ...(seed.skimReason ? { note: seed.skimReason } : {}) };
  });
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/** The run folder's slug (`pr-38`, `branch-feat-x`), the default case name. */
export function defaultCaseName(runFolder: string): string {
  return path.basename(path.dirname(path.resolve(runFolder)));
}
