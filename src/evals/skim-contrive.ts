import path from 'node:path';
import { latestRunFolder } from '../cli/run-folder.ts';
import { slugify } from '../cli/targets.ts';
import {
  listBranches,
  readBranchSpec,
  stubReview,
  withContrivedBranch,
  type ModelRepo,
} from './contrive.ts';
import { importCase } from './skim-import.ts';
import type { CaseFiles } from './skim-case.ts';

/**
 * A contrived skim case: a change written to show one kind of skim several
 * times over, beside ordinary read hunks and at least one trap that looks
 * like the kind but is not. Real pull requests carry each kind only as often
 * as it happens to occur, so a rule about a kind can only be measured on a
 * change made for it.
 *
 * Building one stands the branch up over the stock sync service, runs
 * `er review --stub` there (no model, so every seeded tier is `read`) and
 * imports the run as a case. The case is what is kept.
 */
export const CONTRIVED_DIR = 'evals/skims/contrived';

export function stocklineRepo(root: string): ModelRepo {
  return {
    base: path.join(root, CONTRIVED_DIR, 'base'),
    name: 'stockline',
    importSubject: 'Import the stock sync service',
    author: {
      name: 'Mara Lindqvist',
      email: 'mara@stockline.example',
      date: '2024-06-03T09:12:00Z',
    },
  };
}

/** Every contrived skim branch under the root, by name. */
export function listContrived(root: string): Promise<string[]> {
  return listBranches(path.join(root, CONTRIVED_DIR));
}

export interface ContriveDeps {
  /** Runs `er review --stub --no-open` in a repository; the real one spawns the bin. */
  stubReview?: (cwd: string) => Promise<void>;
}

export async function contriveCase(
  name: string,
  root: string,
  deps: ContriveDeps = {},
): Promise<CaseFiles> {
  const specDir = path.join(root, CONTRIVED_DIR, name);
  const spec = await readBranchSpec(specDir);
  return withContrivedBranch(stocklineRepo(root), specDir, spec, async (work) => {
    await (deps.stubReview ?? stubReview)(work);
    const run = await latestRunFolder(work, `branch-${slugify(spec.branch)}`);
    if (!run) throw new Error(`no run folder after the stub review of ${spec.branch}`);
    return importCase(run.folder, name, root, {
      title: spec.title,
      description: spec.description,
      folder: `${CONTRIVED_DIR}/${name}`,
    });
  });
}
