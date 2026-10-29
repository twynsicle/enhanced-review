import { execFile } from 'node:child_process';
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { hostEnv } from '../cli/host-env.ts';
import { latestRunFolder } from '../cli/run-folder.ts';
import { slugify } from '../cli/targets.ts';
import { importCase } from './skim-import.ts';
import type { CaseFiles } from './skim-case.ts';

/**
 * A contrived case: a change written to show one kind of skim several times
 * over, beside ordinary read hunks and at least one trap that looks like the
 * kind but is not. Real pull requests carry each kind only as often as it
 * happens to occur, so a rule about a kind can only be measured on a change
 * made for it.
 *
 *   evals/skims/contrived/
 *     base/            one small service, the tree every branch starts from
 *     <name>/branch.json   the branch, its title and description, the commit
 *     <name>/files/        the files the branch changes or adds, whole
 *
 * Building one stands the base up as a repository in the temp directory with
 * a bare origin, commits the branch over it, runs `er review --stub` there
 * (no model, so every seeded tier is `read`) and imports the run as a case.
 * The repository is thrown away; the case is what is kept, and the source
 * here is how it is made again. The description goes into the case as a pull
 * request's would, since the model reads it, and nothing in it may say what
 * the branch is for.
 */
export const CONTRIVED_DIR = 'evals/skims/contrived';

export const BranchSpecSchema = z.object({
  branch: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  commit: z.object({ subject: z.string().min(1), body: z.string() }),
  /** Paths the branch deletes from the base. */
  removed: z.array(z.string()),
});
export type BranchSpec = z.infer<typeof BranchSpecSchema>;

const execFileAsync = promisify(execFile);

/** A fixed author, so two builds of one branch make the same commits. */
const IDENTITY = {
  GIT_AUTHOR_NAME: 'Mara Lindqvist',
  GIT_AUTHOR_EMAIL: 'mara@stockline.example',
  GIT_COMMITTER_NAME: 'Mara Lindqvist',
  GIT_COMMITTER_EMAIL: 'mara@stockline.example',
  GIT_AUTHOR_DATE: '2024-06-03T09:12:00Z',
  GIT_COMMITTER_DATE: '2024-06-03T09:12:00Z',
};

export async function readBranchSpec(specDir: string): Promise<BranchSpec> {
  const file = path.join(specDir, 'branch.json');
  const parsed = BranchSpecSchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
  if (!parsed.success) throw new Error(`${file} is not a branch spec: ${parsed.error.message}`);
  return parsed.data;
}

/** Every contrived branch under the root, by name. */
export async function listContrived(root: string): Promise<string[]> {
  const entries = await readdir(path.join(root, CONTRIVED_DIR), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name !== 'base')
    .map((entry) => entry.name)
    .toSorted();
}

/** The branch's files over the base: `files/` copied in whole, `removed` deleted. */
export async function layBranch(specDir: string, spec: BranchSpec, work: string): Promise<void> {
  await cp(path.join(specDir, 'files'), work, { recursive: true });
  for (const removed of spec.removed) {
    await rm(path.join(work, removed), { recursive: true, force: true });
  }
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
  const temp = await mkdtemp(path.join(tmpdir(), `er-contrived-${name}-`));
  try {
    const work = await standUpRepo(temp, path.join(root, CONTRIVED_DIR, 'base'));
    await git(work, 'switch', '--quiet', '-c', spec.branch);
    await layBranch(specDir, spec, work);
    await git(work, 'add', '--all');
    await git(work, 'commit', '--quiet', '-m', spec.commit.subject, '-m', spec.commit.body);

    await (deps.stubReview ?? stubReview)(work);
    const run = await latestRunFolder(work, `branch-${slugify(spec.branch)}`);
    if (!run) throw new Error(`no run folder after the stub review of ${spec.branch}`);
    return await importCase(run.folder, name, root, {
      title: spec.title,
      description: spec.description,
      folder: `${CONTRIVED_DIR}/${name}`,
    });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

/** The base tree as `main` of a working clone with a bare origin, origin's HEAD set. */
async function standUpRepo(temp: string, base: string): Promise<string> {
  const origin = path.join(temp, 'origin.git');
  const work = path.join(temp, 'stockline');
  await git(temp, 'init', '--quiet', '--bare', '--initial-branch=main', origin);
  await git(temp, 'init', '--quiet', '--initial-branch=main', work);
  for (const [key, value] of [
    ['commit.gpgsign', 'false'],
    ['core.autocrlf', 'false'],
    ['core.safecrlf', 'false'],
  ] as const) {
    await git(work, 'config', key, value);
  }
  await git(work, 'remote', 'add', 'origin', origin);
  await cp(base, work, { recursive: true });
  await git(work, 'add', '--all');
  await git(work, 'commit', '--quiet', '-m', 'Import the stock sync service');
  await git(work, 'push', '--quiet', 'origin', 'main');
  // A branch review measures from origin's default branch, which a clone
  // records and a fresh `remote add` does not.
  await git(work, 'remote', 'set-head', 'origin', 'main');
  return work;
}

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd, env: { ...hostEnv(), ...IDENTITY } });
}

/** `er review --stub --no-open` through this checkout's bin, in `cwd`. */
async function stubReview(cwd: string): Promise<void> {
  const bin = path.join(path.dirname(import.meta.dirname), 'cli', 'er.ts');
  await execFileAsync(process.execPath, [bin, 'review', '--stub', '--no-open'], {
    cwd,
    env: hostEnv(),
  });
}
