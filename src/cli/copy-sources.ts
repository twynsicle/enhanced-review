import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import type { HookCallbackMatcher, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { plural } from '../review/plural.ts';
import { loadQuery, permission, runDeadline, withSigninHint, type QueryFn } from './claude-run.ts';
import { treeEntries } from './context.ts';
import { pairFiles, type ChangedFile, type PairRequest } from './diff-files.ts';
import type { Shell } from './git.ts';
import { agentEnv } from './host-env.ts';
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
 * A malformed answer, or one naming a file it was not asked about, is a
 * defect the model can still fix with the diff and its own answer in
 * context, so the Stop hook (`copySourceStopHook`) sends it back for a redo
 * rather than spending the whole run. A source that was not there at the
 * base only surfaces once the run ends, since that needs a git lookup, and
 * still fails the run: a pair built from it would be drawn as a fact. A
 * source sharing no line git can match is only warned about — the file is
 * reviewed as new, which is what it would have been without the flag.
 */

export const COPY_SOURCE_MODEL = 'claude-haiku-4-5';

/**
 * The work grows with the files asked about — a look at each, a candidate or
 * two read beside it — so the allowance does too. A fixed one would fail a
 * change adding a hundred files every time, and the review with it.
 */
export function copySourceLimits(files: number): { maxTurns: number; timeoutMs: number } {
  return { maxTurns: 20 + 3 * files, timeoutMs: (3 * 60 + 20 * files) * 1000 };
}

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
  const answer = await askModel(copySourcePrompt(target, unpaired), shell.cwd, run, unpaired, {
    ...deps,
    ...copySourceLimits(unpaired.length),
  });
  let requests: PairRequest[];
  try {
    requests = parseCopySources(answer.text);
    const baseTree = await treeEntries(
      shell,
      target.baseSha,
      requests.map((r) => r.from),
    );
    checkCopySources(requests, unpaired, files, new Set(baseTree.keys()));
  } catch (error) {
    // A failed gather takes the run folder, and copy-sources.txt with it.
    throw new Error(`${(error as Error).message}; the model answered:\n${tail(answer.text)}`, {
      cause: error,
    });
  }
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

const SYSTEM = `You find where new files came from. A developer often writes a new file by copying an existing one and changing it: a component cloned from a sibling, a handler modelled on another, a test copied from the one beside it. For each new file you are given, decide whether it was built that way, and if it was, from which file. Decide about exactly the files you are given — exploring the tree around them will turn up others that look similar, but a file you were not given is not yours to report on, however alike it looks.

Name a source only when the new file visibly follows it: the same structure, and lines in common. A file that merely does something similar, or imports the other, was not built from it. Most new files have no source, and leaving one out is always a safe answer.`;

export function copySourcePrompt(target: Target, unpaired: readonly string[]): string {
  const { baseSha, headSha } = target;
  return `The change under review goes from ${baseSha} (the base) to ${headSha} (the head). These are the only files you are deciding about — git found no existing file they were copied from:

${unpaired.map((file) => `- ${file}`).join('\n')}

Your working directory is the repository, but its checkout is not the change: read both sides from git. With Bash you can run read-only git commands, among them:

- \`git show ${headSha}:<path>\` for a new file
- \`git ls-tree -r --name-only ${baseSha} -- <directory>\` for what existed beside it
- \`git show ${baseSha}:<path>\` for a candidate source

Look first at the files next to each new one and at files with similar names. A source must be a file that existed at the base.

Answer with this block and nothing after it, one entry per file above that has a source. Copy each "file" exactly as listed above, never a file you only came across while exploring; use exactly the keys "file" and "source", both strings:

<copy_sources>[{"file": "<new file, from the list above>", "source": "<path at the base>"}]</copy_sources>

An empty list is the right answer when none of them was built from another file.`;
}

/** The end of an answer, where its block is: enough to see what went wrong without the whole run. */
function tail(text: string): string {
  return text.length <= 2000 ? text : `…${text.slice(-2000)}`;
}

async function askModel(
  prompt: string,
  cwd: string,
  run: RunFiles,
  unpaired: readonly string[],
  deps: CopySourceDeps & { maxTurns: number; timeoutMs: number },
): Promise<{ text: string; costUsd: number | null }> {
  const { controller, release } = runDeadline(deps.timeoutMs);
  // The Stop hook grades everything said so far, which spans several
  // assistant messages once a redo has happened.
  const said: string[] = [];
  try {
    const queryFn = deps.query ?? (await loadQuery());
    const outcome = await runSdkLoop(
      queryFn,
      {
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
          maxTurns: deps.maxTurns,
          // A missing or malformed block is a defect the model can still fix
          // with the diff in context, so it is caught here rather than
          // failing the whole gather over an answer given the wrong shape.
          hooks: {
            Stop: [
              copySourceStopHook({
                maxRetries: MAX_COPY_SOURCE_RETRIES,
                unpaired,
                text: () => said.join(''),
                onBlock: (attempt, _reason, defect) => {
                  warn(
                    `the copy-source answer needed a redo (attempt ${String(attempt)}): ${defect}`,
                  );
                },
                onError: (error) => {
                  warn(`the copy-source retry check failed: ${error.message}`);
                },
              }),
            ],
          },
        },
      },
      {
        onText: (text) => {
          said.push(text);
        },
      },
    );
    await writeFile(run.copySources, outcome.raw);
    if (controller.signal.aborted) {
      const minutes = Math.round(deps.timeoutMs / 60_000);
      throw new Error(`finding copy sources stopped after ${String(minutes)} minutes`);
    }
    if (outcome.sdkError) throw withSigninHint(outcome.sdkError);
    const ended = howItEnded(outcome.result);
    if (ended !== null) throw new Error(`finding copy sources ended ${ended}`);
    return { text: outcome.raw, costUsd: outcome.result?.costUsd ?? null };
  } finally {
    release();
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
  return parsed.data.map(({ file, source }) => ({ from: repoPath(source), to: repoPath(file) }));
}

/** Two: naming a file's source is a much smaller answer than a narrative review to get wrong twice. */
export const MAX_COPY_SOURCE_RETRIES = 2;

/**
 * Deliberately does not spell the tag pair: the model quoting its own
 * instructions back would leave an empty block at the end of the transcript
 * for the parser to find.
 */
const REDO =
  'Write out the block again as a JSON list of {file, source} pairs, and nothing after it.';

export interface CopySourceStopHookOptions {
  maxRetries: number;
  /** What the model was asked about, so a file outside that is caught here too. */
  unpaired: readonly string[];
  text: () => string;
  onBlock: (attempt: number, reason: string, defect: string) => void;
  onError: (error: Error) => void;
}

/**
 * The retry loop for a copy-source answer, as a Stop hook: a model that
 * answers in its own shape (thinking-aloud tags, a summary, a code block)
 * instead of the `<copy_sources>` block asked for, or that names a file
 * outside the list it was given, still has the diff and its own answer in
 * context, so asking it to try again costs a turn rather than failing the
 * whole gather. Only what `checkAskedAbout` can tell without reading the
 * base is checked here; a source that turns out not to be a file there is
 * still a fatal answer, found only after the run ends.
 */
export function copySourceStopHook(options: CopySourceStopHookOptions): HookCallbackMatcher {
  let blocks = 0;

  const hook = (): Promise<HookJSONOutput> => {
    try {
      const text = options.text();
      let defect: string | null = null;
      try {
        checkAskedAbout(parseCopySources(text), options.unpaired);
      } catch (error) {
        defect = (error as Error).message;
      }
      if (defect === null || blocks >= options.maxRetries) {
        return Promise.resolve({ continue: true });
      }

      blocks += 1;
      const reason = `${defect} ${REDO}`;
      options.onBlock(blocks, reason, defect);
      return Promise.resolve({ decision: 'block', reason });
    } catch (error) {
      try {
        options.onError(error instanceof Error ? error : new Error(String(error)));
      } catch {
        // Reporting the failure must not become the failure: an `onError`
        // that throws would strand the run exactly as an ungraded stop does.
      }
      return Promise.resolve({ continue: true });
    }
  };

  return { hooks: [hook] };
}

/**
 * Leniency toward the model, which writes a path the way a person would: a
 * `./` in front or Windows separators name the same file, and refusing them
 * would fail a review over nothing.
 */
function repoPath(path: string): string {
  return path
    .trim()
    .replaceAll('\\', '/')
    .replace(/^(?:\.\/)+/, '');
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
  checkAskedAbout(requests, unpaired);
  const removed = new Set(files.filter((f) => f.status === 'removed').map((f) => f.filename));
  const renamedFrom = new Set(
    files.flatMap((f) => (f.status === 'renamed' && f.origin ? [f.origin.filename] : [])),
  );
  const claimed = new Set<string>();
  for (const { from, to } of requests) {
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

/**
 * The part of `checkCopySources` that needs nothing from the base: whether
 * the model stayed inside the files it was asked about. Split out so the
 * Stop hook can catch it too, before the run pays for a git lookup it
 * would only throw away.
 */
export function checkAskedAbout(
  requests: readonly PairRequest[],
  unpaired: readonly string[],
): void {
  const asked = new Set(unpaired);
  const named = new Set<string>();
  for (const { from, to } of requests) {
    if (!asked.has(to))
      throw new Error(`the model named a source for ${to}, which it was not asked about`);
    if (named.has(to)) throw new Error(`the model named more than one source for ${to}`);
    named.add(to);
    if (from === to) throw new Error(`the model named ${to} as its own source`);
  }
}
