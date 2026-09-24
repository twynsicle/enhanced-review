import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { plural } from '../review/plural.ts';
import { loadQuery, permission, withSigninHint, type QueryFn } from './claude-run.ts';
import { pairFiles, type ChangedFile, type PairRequest } from './diff-files.ts';
import { argBatches } from './git-runner.ts';
import type { Shell } from './git.ts';
import { agentEnv } from './host-env.ts';
import { onInterrupt } from './interrupts.ts';
import type { RunFiles } from './run-folder.ts';
import { howItEnded, runSdkLoop } from './sdk-loop.ts';
import type { Target } from './targets.ts';
import { stage, warn } from './terminal.ts';

/**
 * `--find-copy-sources`: a short model run inside gather that names the file
 * each new file was built from, when git could not. Git finds a copy only at
 * 50% similarity, and a component cloned from a sibling and then reworked is
 * usually below that; the reviewer still wants it shown against its template,
 * where the attention belongs. The pair is then scored and diffed by git like
 * any other, so the model decides only which file, never what the diff says.
 *
 * It runs from the repository root with nothing but the read-only Bash gate:
 * a PR's worktree does not exist yet, and the checkout is not the change, so
 * both sides are read with `git show <sha>:<path>`.
 *
 * An answer that names a file it was not asked about, or a source that was not
 * there at the base, fails the run: it is the model misreading the task, and a
 * pair built from it would be drawn as a fact. A source sharing no line git can
 * match is only warned about — the file is reviewed as new, which is what it
 * would have been without the flag.
 */

export const COPY_SOURCE_MODEL = 'claude-haiku-4-5';
const MAX_TURNS = 40;
const TIMEOUT_MINUTES = 5;

export interface CopySourceDeps {
  query?: QueryFn;
}

export async function findCopySources(
  shell: Shell,
  target: Target,
  run: RunFiles,
  files: readonly ChangedFile[],
  unpaired: readonly string[],
  deps: CopySourceDeps = {},
): Promise<ChangedFile[]> {
  const started = performance.now();
  const answer = await askModel(copySourcePrompt(target, unpaired), shell.cwd, run, deps);
  const requests = parseCopySources(answer.text);
  const baseFiles = await filesAtBase(
    shell,
    target.baseSha,
    requests.map((r) => r.from),
  );
  checkCopySources(requests, unpaired, files, baseFiles);
  const paired = await pairFiles(
    shell.runners.git,
    shell.cwd,
    target.baseSha,
    target.headSha,
    files,
    requests,
  );
  for (const { from, to } of paired.unpaired) {
    warn(
      `the model named ${from} as the source of ${to}, but git finds no line in common; ` +
        `${to} is reviewed as a new file`,
    );
  }
  const found = requests.length - paired.unpaired.length;
  const cost = answer.costUsd === null ? '' : `, $${answer.costUsd.toFixed(2)}`;
  stage(
    'sources',
    `${plural(unpaired.length, 'new file')} checked, ${plural(found, 'source')} found${cost}`,
    performance.now() - started,
  );
  return paired.files;
}

const SYSTEM = `You find where new files came from. A developer often writes a new file by copying an existing one and changing it: a component cloned from a sibling, a handler modelled on another, a test copied from the one beside it. For each new file you are given, decide whether it was built that way, and if it was, from which file.

Name a source only when the new file visibly follows it: the same structure, and lines in common. A file that merely does something similar, or imports the other, was not built from it. Most new files have no source, and leaving one out is always a safe answer.`;

export function copySourcePrompt(target: Target, unpaired: readonly string[]): string {
  const { baseSha, headSha } = target;
  return `The change under review goes from ${baseSha} (the base) to ${headSha} (the head). These files are new in it, and git found no existing file they were copied from:

${unpaired.map((file) => `- ${file}`).join('\n')}

Your working directory is the repository, but its checkout is not the change: read both sides from git. With Bash you can run read-only git commands, among them:

- \`git show ${headSha}:<path>\` for a new file
- \`git ls-tree -r --name-only ${baseSha} -- <directory>\` for what existed beside it
- \`git show ${baseSha}:<path>\` for a candidate source

Look first at the files next to each new one and at files with similar names. A source must be a file that existed at the base.

Answer with this block and nothing after it, one entry per new file that has a source:

<copy_sources>[{"file": "<new file>", "source": "<path at the base>"}]</copy_sources>

An empty list is the right answer when none of them was built from another file.`;
}

async function askModel(
  prompt: string,
  cwd: string,
  run: RunFiles,
  deps: CopySourceDeps,
): Promise<{ text: string; costUsd: number | null }> {
  const controller = new AbortController();
  const unregister = onInterrupt(() => {
    controller.abort();
  });
  const timer = setTimeout(() => {
    controller.abort();
  }, TIMEOUT_MINUTES * 60_000);
  try {
    const queryFn = deps.query ?? (await loadQuery());
    const outcome = await runSdkLoop(queryFn, {
      prompt,
      options: {
        cwd,
        model: COPY_SOURCE_MODEL,
        systemPrompt: SYSTEM,
        tools: ['Bash'],
        allowedTools: [],
        canUseTool: (tool, input) => Promise.resolve(permission(tool, input)),
        // The engineer's own settings only: this is a lookup, not a review,
        // and a repository's hooks have no part in it.
        settingSources: ['user'],
        env: agentEnv(),
        persistSession: false,
        abortController: controller,
        maxTurns: MAX_TURNS,
      },
    });
    await writeFile(run.copySources, outcome.raw);
    if (controller.signal.aborted) {
      throw new Error(`finding copy sources stopped after ${String(TIMEOUT_MINUTES)} minutes`);
    }
    if (outcome.sdkError) throw withSigninHint(outcome.sdkError);
    const ended = howItEnded(outcome.result);
    if (ended !== null) throw new Error(`finding copy sources ended ${ended}`);
    return { text: outcome.raw, costUsd: outcome.result?.costUsd ?? null };
  } finally {
    clearTimeout(timer);
    unregister();
  }
}

const AnswerSchema = z.array(z.object({ file: z.string(), source: z.string() }));

/** The last `<copy_sources>` block: a model that thinks aloud first may name the tag earlier. */
export function parseCopySources(text: string): PairRequest[] {
  const blocks = [...text.matchAll(/<copy_sources>([\s\S]*?)<\/copy_sources>/g)];
  const body = blocks.at(-1)?.[1];
  if (body === undefined) throw new Error('the copy-source answer has no <copy_sources> block');
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch (error) {
    throw new Error(`the copy-source answer is not JSON: ${(error as Error).message}`, {
      cause: error,
    });
  }
  const parsed = AnswerSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `the copy-source answer is not a list of {file, source}: ${parsed.error.message}`,
    );
  }
  return parsed.data.map(({ file, source }) => ({ from: source, to: file }));
}

/**
 * A pair the model may name: a file it was asked about, once, from a path that
 * was a file at the base. A source the branch removed is paired as a rename and
 * leaves the list, so it can be named once, and not at all when it is already
 * the origin of another rename.
 */
export function checkCopySources(
  requests: readonly PairRequest[],
  unpaired: readonly string[],
  files: readonly ChangedFile[],
  baseFiles: ReadonlySet<string>,
): void {
  const asked = new Set(unpaired);
  const removed = new Set(files.filter((f) => f.status === 'removed').map((f) => f.filename));
  const renamedFrom = new Set(
    files.flatMap((f) => (f.status === 'renamed' && f.origin ? [f.origin.filename] : [])),
  );
  const named = new Set<string>();
  const claimed = new Set<string>();
  for (const { from, to } of requests) {
    if (!asked.has(to))
      throw new Error(`the model named a source for ${to}, which it was not asked about`);
    if (named.has(to)) throw new Error(`the model named more than one source for ${to}`);
    named.add(to);
    if (from === to) throw new Error(`the model named ${to} as its own source`);
    if (!baseFiles.has(from)) {
      throw new Error(
        `the model named ${from} as the source of ${to}, but it is not a file at the base`,
      );
    }
    if (renamedFrom.has(from)) {
      throw new Error(
        `the model named ${from} as the source of ${to}, but it was renamed on the branch`,
      );
    }
    if (removed.has(from)) {
      if (claimed.has(from)) {
        throw new Error(
          `the model named ${from}, which the branch removed, as the source of two files`,
        );
      }
      claimed.add(from);
    }
  }
}

/** Which of these paths were files (not directories) at the base. */
async function filesAtBase(
  shell: Shell,
  baseSha: string,
  paths: readonly string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  for (const batch of argBatches([...new Set(paths)])) {
    const out = await shell.git([
      '--literal-pathspecs',
      'ls-tree',
      '-r',
      '-z',
      '--name-only',
      '--full-tree',
      baseSha,
      '--',
      ...batch,
    ]);
    for (const path of out.split('\0')) if (path !== '') found.add(path);
  }
  return found;
}
