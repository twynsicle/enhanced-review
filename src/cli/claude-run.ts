import { createWriteStream, type WriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { howItEnded, runSdkLoop, type SdkQueryFn, type SdkUsage } from './sdk-loop.ts';
import { MAX_VALIDATION_RETRIES, validationStopHook } from './validation-stop-hook.ts';
import type { PromptGrounding } from '../review/prompt/diff-hunk-catalog.ts';
import { reviewBashCommand } from './bash-gate.ts';
import { onInterrupt } from './interrupts.ts';
import type { RunFiles } from './run-folder.ts';

/**
 * The run stage: the Agent SDK, in the review's working directory, with the
 * prompt stage's `system.md` and `prompt.md` as its input. Everything the
 * model says lands in `raw.txt` as it arrives, so an interrupted run still
 * leaves something for `--from parse`, and every SDK message is summarised in
 * `events.jsonl`.
 *
 * The engineer's own environment is what authenticates: the SDK subprocess
 * inherits it, and this CLI reads none of it itself, so it needs no
 * configuration of its own. The reviewed repository's own Claude
 * configuration loads as it would in a normal session: it is the engineer's
 * own repository, so its hooks and settings are theirs to trust.
 */

/**
 * Spelled out here because `er` has no configuration of its own.
 * The `[1m]` suffix asks for the 1M-token context window explicitly: without
 * it, a large review can autocompact mid-run, and autocompact repeatedly
 * refilling the context within a few turns of the previous compact aborts
 * the run outright.
 */
export const DEFAULT_MODEL = 'claude-sonnet-5[1m]';
/**
 * Measured: an 88-file, 138-hunk review took 32 turns and 7m 36s. The turn
 * limit is set well above that because the cost of hitting it is not "try
 * again with more room" — it is the whole run's effort thrown away, so the
 * cap is meant to catch a run that has genuinely gone wrong, not one that is
 * merely a large but ordinary review. A review that runs out says so and
 * keeps what it wrote, and `--max-turns` / `--timeout` raise them for the
 * change that needs it.
 */
export const DEFAULT_MAX_TURNS = 120;
export const DEFAULT_TIMEOUT_MINUTES = 15;

/** Read-only. Read, Glob and Grep run without asking; Bash is gated. */
const TOOLS = ['Read', 'Glob', 'Grep', 'Bash'] as const;
const PRE_APPROVED = ['Read', 'Glob', 'Grep'] as const;

export type QueryFn = SdkQueryFn;

export interface ClaudeRunOptions {
  /** The agent's working directory: a PR's worktree, or the repository. */
  cwd: string;
  model: string;
  maxTurns: number;
  timeoutMs: number;
  /** What the answer is held against before the model is allowed to stop. */
  grounding: PromptGrounding;
}

export interface ClaudeRunDeps {
  query?: QueryFn;
  /** One line per tool use, for the terminal. */
  onActivity?: (activity: string) => void;
  /** Each block of the answer as it arrives, for the terminal. */
  onText?: (chunk: string) => void;
  /** A disqualified answer the model was asked to write again: what was wrong with it. */
  onBlocked?: (attempt: number, defects: string) => void;
  /** The validation hook itself threw; the run carried on ungraded. */
  onHookError?: (error: Error) => void;
}

export interface ClaudeRunResult {
  /** Characters of model text written to `raw.txt`. */
  characters: number;
  turns: number;
  costUsd: number | null;
  /** What the run spent. `null` when it ended without a result. */
  usage: SdkUsage | null;
  /** Set when the run ended on something other than a finished answer. */
  incomplete: string | null;
}

export async function runClaude(
  run: RunFiles,
  options: ClaudeRunOptions,
  deps: ClaudeRunDeps = {},
): Promise<ClaudeRunResult> {
  const [system, prompt] = await Promise.all([
    readFile(run.system, 'utf8'),
    readFile(run.prompt, 'utf8'),
  ]);

  const controller = new AbortController();
  const unregister = onInterrupt(() => {
    controller.abort();
  });
  const timer = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs);
  const started = performance.now();
  const events = createWriteStream(run.events, { flags: 'w' });
  const raw = createWriteStream(run.raw, { flags: 'w' });
  const event = (fields: Record<string, unknown>) => {
    events.write(`${JSON.stringify({ ms: Math.round(performance.now() - started), ...fields })}\n`);
  };

  let characters = 0;
  // The run keeps its own copy of the answer: the Stop hook grades everything
  // the model has said, and a long narrative spans several assistant messages.
  const said: string[] = [];
  const onDeny = (tool: string, input: Record<string, unknown>, reason: string) => {
    event({ type: 'denied', tool, detail: describeInput(input), reason });
  };
  // The whole reason, instruction to the model and all, belongs in the event
  // log; the terminal gets only the part addressed to a person.
  const onBlock = (attempt: number, reason: string, defects: string) => {
    event({ type: 'blocked', attempt, reason });
    deps.onBlocked?.(attempt, defects);
  };
  const onHookError = (error: Error) => {
    event({ type: 'hook-error', message: error.message });
    deps.onHookError?.(error);
  };

  try {
    const queryFn = deps.query ?? (await loadQuery());
    const outcome = await runSdkLoop(
      queryFn,
      {
        prompt,
        options: sdkOptions(system, options, controller, {
          onDeny,
          onBlock,
          onHookError,
          text: () => said.join(''),
        }),
      },
      {
        onText: (text) => {
          raw.write(text);
          said.push(text);
          characters += text.length;
          deps.onText?.(text);
        },
        onToolUse: (tool, detail) => {
          event({ type: 'tool', tool, detail });
          deps.onActivity?.(activityLine(tool, detail));
        },
        onSystem: (subtype) => {
          event({ type: 'system', subtype });
        },
      },
    );

    const { result } = outcome;
    if (result) {
      event({
        type: 'result',
        subtype: result.subtype,
        isError: result.isError,
        turns: result.turns,
        costUsd: result.costUsd,
        usage: result.usage,
      });
    }
    // The SDK ends an aborted run either by throwing or by simply stopping.
    if (controller.signal.aborted) throw stoppedEarly(options, characters, run);
    if (outcome.sdkError) throw withSigninHint(outcome.sdkError);
    if (characters === 0) {
      throw new Error(
        `the model wrote nothing${result === null ? '' : ` (${result.subtype})`}; see ${run.events}`,
      );
    }
    return {
      characters,
      usage: result?.usage ?? null,
      turns: result?.turns ?? 0,
      costUsd: result?.costUsd ?? null,
      incomplete: howItEnded(result),
    };
  } finally {
    clearTimeout(timer);
    unregister();
    await Promise.all([closeStream(raw), closeStream(events)]);
  }
}

interface RunCallbacks {
  onDeny: (tool: string, input: Record<string, unknown>, reason: string) => void;
  onBlock: (attempt: number, reason: string, defects: string) => void;
  onHookError: (error: Error) => void;
  /** Everything the model has said so far, for the Stop hook. */
  text: () => string;
}

function sdkOptions(
  system: string,
  options: ClaudeRunOptions,
  controller: AbortController,
  callbacks: RunCallbacks,
): Options {
  return {
    cwd: options.cwd,
    model: options.model,
    systemPrompt: system,
    tools: [...TOOLS],
    allowedTools: [...PRE_APPROVED],
    canUseTool: (tool, input) => {
      const decision = permission(tool, input);
      if (decision.behavior === 'deny') callbacks.onDeny(tool, input, decision.message);
      return Promise.resolve(decision);
    },
    // The engineer's own settings, and the reviewed repository's CLAUDE.md.
    settingSources: ['user', 'project', 'local'],
    persistSession: false,
    abortController: controller,
    maxTurns: options.maxTurns,
    // The same verdict the parse stage gives, while the model can still act on
    // it: a disqualified answer costs one more turn rather than a whole second run.
    hooks: {
      Stop: [
        validationStopHook({
          grounding: options.grounding,
          maxRetries: MAX_VALIDATION_RETRIES,
          text: callbacks.text,
          onBlock: callbacks.onBlock,
          onError: callbacks.onHookError,
        }),
      ],
    },
  };
}

type Permission =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string };

/** Read, Glob and Grep never reach this; Bash does, and only reads get through. */
function permission(tool: string, input: Record<string, unknown>): Permission {
  if (tool !== 'Bash') {
    return { behavior: 'deny', message: `er reviews are read-only; ${tool} is not available.` };
  }
  const command = typeof input.command === 'string' ? input.command : '';
  const decision = reviewBashCommand(command);
  return decision.allowed
    ? { behavior: 'allow', updatedInput: input }
    : { behavior: 'deny', message: decision.reason };
}

/** Enough of a refused call to recognise it in `events.jsonl`. */
function describeInput(input: Record<string, unknown>): string {
  return typeof input.command === 'string' ? input.command : JSON.stringify(input);
}

function activityLine(tool: string, detail: string): string {
  return detail === '' ? tool : `${tool} ${detail}`;
}

/**
 * The SDK reports a missing sign-in as an ordinary error. `er` runs as the
 * engineer, so the fix is theirs to make in their own terminal.
 */
function withSigninHint(error: unknown): Error {
  const thrown = error instanceof Error ? error : new Error(String(error));
  if (!/not logged in|\/login|authentication|api key/i.test(thrown.message)) return thrown;
  return new Error(
    `${thrown.message}\nRun \`claude\` and sign in, or set ANTHROPIC_API_KEY, ` +
      'then try again: er runs the model as you, with your own credentials.',
  );
}

function stoppedEarly(options: ClaudeRunOptions, characters: number, run: RunFiles): Error {
  const minutes = Math.round(options.timeoutMs / 60_000);
  const kept = characters > 0 ? ` What it wrote is in ${run.raw}; --from parse reads it.` : '';
  return new Error(
    `the model run stopped after ${String(minutes)} minutes; raise it with --timeout.${kept}`,
  );
}

async function loadQuery(): Promise<QueryFn> {
  // Imported here so the SDK, which starts a subprocess, is loaded only by a
  // real run: never by --stub, by a resumed later stage, or by the tests.
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  return sdk.query;
}

function closeStream(stream: WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.end(() => {
      resolve();
    });
    stream.once('error', reject);
  });
}
