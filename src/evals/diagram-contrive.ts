import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { readContext, type RunContext } from '../cli/context.ts';
import { hostEnv } from '../cli/host-env.ts';
import { latestRunFolder, runFiles } from '../cli/run-folder.ts';
import { slugify } from '../cli/targets.ts';
import { stubReview, withContrivedBranch } from './contrive.ts';
import {
  DIAGRAM_CONTRIVED_DIR,
  giveaways,
  packhouseRepo,
  readDiagramSpec,
  type DiagramBranchSpec,
} from './diagram-case.ts';

/**
 * Proves a diagram branch is a change an engineer could have opened: stood
 * up over the order service, its tests pass on the tree, a stub review runs,
 * and the change is a size a reviewer would meet. Nothing is kept — the
 * branch is the case — so this is what `contrive` has to show for itself,
 * and what a sweep repeats before it spends money on a branch.
 */
export interface ChangeSize {
  files: number;
  hunks: number;
  added: number;
  removed: number;
}

export interface ContrivedBranch {
  name: string;
  spec: DiagramBranchSpec;
  size: ChangeSize;
}

export interface DiagramContriveDeps {
  stubReview?: (cwd: string) => Promise<void>;
  runTests?: (cwd: string) => Promise<void>;
}

const execFileAsync = promisify(execFile);

export async function contriveDiagramBranch(
  name: string,
  root: string,
  deps: DiagramContriveDeps = {},
): Promise<ContrivedBranch> {
  const specDir = path.join(root, DIAGRAM_CONTRIVED_DIR, name);
  const spec = await readDiagramSpec(specDir);
  const told = await giveaways(specDir, spec);
  if (told.length > 0) {
    throw new Error(`${name} says what it is for:\n  ${told.join('\n  ')}`);
  }
  return withContrivedBranch(packhouseRepo(root), specDir, spec, async (work) => {
    await (deps.runTests ?? runTests)(work);
    await (deps.stubReview ?? stubReview)(work);
    const run = await latestRunFolder(work, `branch-${slugify(spec.branch)}`);
    if (!run) throw new Error(`no run folder after the stub review of ${spec.branch}`);
    const files = runFiles(run.folder);
    const size = changeSize(await readContext(files), await readFile(files.diff, 'utf8'));
    return { name, spec, size };
  });
}

/** The change as the prompt shows it: reviewed files and hunks, and the diff's own line counts. */
export function changeSize(context: RunContext, diff: string): ChangeSize {
  let added = 0;
  let removed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) removed += 1;
  }
  return {
    files: context.files.filter((file) => !file.skipped).length,
    hunks: context.hunks.length,
    added,
    removed,
  };
}

/**
 * The model system's own tests, on the base or on a branch's tree. Node's
 * test runner expands the pattern itself, so no shell is involved, and the
 * tree needs no install: the service has no dependencies.
 */
export async function runTests(cwd: string): Promise<void> {
  try {
    await execFileAsync(process.execPath, ['--test', 'src/**/*.test.ts'], {
      cwd,
      env: hostEnv(),
    });
  } catch (error) {
    const { stdout, stderr } = error as { stdout?: string; stderr?: string };
    throw new Error(`tests failed in ${cwd}\n${stdout ?? ''}${stderr ?? ''}`, { cause: error });
  }
}
