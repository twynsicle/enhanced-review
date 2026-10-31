import { execFile } from 'node:child_process';
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { hostEnv } from '../cli/host-env.ts';

/**
 * A contrived change: a branch written to show one thing, laid over a model
 * system kept in this repository, so that a rule can be measured on a change
 * made to exercise it rather than on whatever a real pull request happened
 * to carry. Each eval keeps its own model system and its own branches:
 *
 *   evals/<eval>/contrived/
 *     base/                the model system, the tree every branch starts from
 *     <name>/branch.json   the branch, its title and description, the commit
 *     <name>/files/        the files the branch changes or adds, whole
 *
 * Standing one up puts the base in a temp directory as `main` of a working
 * clone with a bare origin, commits the branch over it, and hands the tree to
 * the caller for as long as it needs it. The repository is thrown away; the
 * source here is how it is made again. The description goes to the model as
 * a pull request's would, so nothing in it may say what the branch is for.
 */
export const BranchSpecSchema = z.object({
  branch: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  commit: z.object({ subject: z.string().min(1), body: z.string() }),
  /** Paths the branch deletes from the base. */
  removed: z.array(z.string()),
});
export type BranchSpec = z.infer<typeof BranchSpecSchema>;

/** The model system a set of branches is laid over. */
export interface ModelRepo {
  /** The base tree. */
  base: string;
  /** The working clone's directory name, which the model sees as the repository's. */
  name: string;
  /** The one commit the base is imported as. */
  importSubject: string;
  /** A fixed author and date, so two builds of one branch make the same commits. */
  author: { name: string; email: string; date: string };
}

const execFileAsync = promisify(execFile);

export async function readBranchSpec(specDir: string): Promise<BranchSpec> {
  return parseBranchSpec(path.join(specDir, 'branch.json'), BranchSpecSchema);
}

/** `branch.json` under a spec directory, through whichever spec schema the eval keeps. */
export async function parseBranchSpec<T>(file: string, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(JSON.parse(await readFile(file, 'utf8')));
  if (!parsed.success) throw new Error(`${file} is not a branch spec: ${parsed.error.message}`);
  return parsed.data;
}

/** Every branch under a contrived directory, by name, the base left out. */
export async function listBranches(contrivedDir: string): Promise<string[]> {
  const entries = await readdir(contrivedDir, { withFileTypes: true });
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

/**
 * The branch stood up in a throwaway repository for the length of `run`, and
 * removed after it however `run` ends.
 */
export async function withContrivedBranch<T>(
  repo: ModelRepo,
  specDir: string,
  spec: BranchSpec,
  run: (work: string) => Promise<T>,
): Promise<T> {
  const temp = await mkdtemp(path.join(tmpdir(), `er-contrived-${path.basename(specDir)}-`));
  try {
    const work = await standUpRepo(temp, repo);
    await git(work, repo, 'switch', '--quiet', '-c', spec.branch);
    await layBranch(specDir, spec, work);
    await git(work, repo, 'add', '--all');
    await git(work, repo, 'commit', '--quiet', '-m', spec.commit.subject, '-m', spec.commit.body);
    return await run(work);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

/** The base tree as `main` of a working clone with a bare origin, origin's HEAD set. */
async function standUpRepo(temp: string, repo: ModelRepo): Promise<string> {
  const origin = path.join(temp, 'origin.git');
  const work = path.join(temp, repo.name);
  await git(temp, repo, 'init', '--quiet', '--bare', '--initial-branch=main', origin);
  await git(temp, repo, 'init', '--quiet', '--initial-branch=main', work);
  for (const [key, value] of [
    ['commit.gpgsign', 'false'],
    ['core.autocrlf', 'false'],
    ['core.safecrlf', 'false'],
  ] as const) {
    await git(work, repo, 'config', key, value);
  }
  await git(work, repo, 'remote', 'add', 'origin', origin);
  await cp(repo.base, work, { recursive: true });
  await git(work, repo, 'add', '--all');
  await git(work, repo, 'commit', '--quiet', '-m', repo.importSubject);
  await git(work, repo, 'push', '--quiet', 'origin', 'main');
  // A branch review measures from origin's default branch, which a clone
  // records and a fresh `remote add` does not.
  await git(work, repo, 'remote', 'set-head', 'origin', 'main');
  return work;
}

async function git(cwd: string, repo: ModelRepo, ...args: string[]): Promise<void> {
  const { name, email, date } = repo.author;
  const identity = {
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  };
  await execFileAsync('git', args, { cwd, env: { ...hostEnv(), ...identity } });
}

/** `er review --stub --no-open` through this checkout's bin, in `cwd`. */
export async function stubReview(cwd: string): Promise<void> {
  const bin = path.join(path.dirname(import.meta.dirname), 'cli', 'er.ts');
  await execFileAsync(process.execPath, [bin, 'review', '--stub', '--no-open'], {
    cwd,
    env: hostEnv(),
  });
}
