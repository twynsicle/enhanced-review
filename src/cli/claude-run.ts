import { createWriteStream, type WriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { runSdkLoop, type SdkQueryFn } from '../domain/review/executor/sdk-loop.server.ts';
import { reviewBashCommand } from './bash-gate.ts';
import { onInterrupt } from './interrupts.ts';
import type { RunFiles } from './run-folder.ts';

/**
 * The run stage (docs/local-mode D5, D9): the Agent SDK, in the review's
 * working directory, with the prompt stage's `system.md` and `prompt.md` as
 * its input. Everything the model says lands in `raw.txt` as it arrives, so
 * an interrupted run still leaves something for `--from parse`, and every
 * SDK message is summarised in `events.jsonl`.
 *
 * The engineer's own environment is what authenticates: the SDK subprocess
 * inherits it, and this CLI reads none of it itself (A4). The reviewed
 * repository's own Claude configuration loads as it would in a normal
 * session (D5), which is why `settingSources` is not empty here as it is on
 * the server.
 */

/** The server's default, spelled out because the CLI may not read `env.ts` (A4). */
export const DEFAULT_MODEL = 'claude-sonnet-5';
/**
 * Measured: an 88-file, 138-hunk review took 32 turns and 7m 36s, so both of
 * these leave a change about twice that size room to finish. A review that
 * runs out says so and keeps what it wrote, and `--max-turns` / `--timeout`
 * raise them for the change that needs it.
 */
export const DEFAULT_MAX_TURNS = 60;
export const DEFAULT_TIMEOUT_MINUTES = 15;

/** Read-only. The three the hosted executor uses run without asking; Bash is gated. */
const TOOLS = ['Read', 'Glob', 'Grep', 'Bash'] as const;
const PRE_APPROVED = ['Read', 'Glob', 'Grep'] as const;

export type QueryFn = SdkQueryFn;

export interface ClaudeRunOptions {
  /** The agent's working directory: a PR's worktree, or the repository. */
  cwd: string;
  model: string;
  maxTurns: number;
  timeoutMs: number;
}

export interface ClaudeRunDeps {
  query?: QueryFn;
  /** One line per tool use, for the terminal. */
  onActivity?: (activity: string) => void;
  /** Each block of the answer as it arrives, for the terminal. */
  onText?: (chunk: string) => void;
}

export interface ClaudeRunResult {
  /** Characters of model text written to `raw.txt`. */
  characters: number;
  turns: number;
  costUsd: number | null;
  /** Tool calls the gate turned away. Each one is an event in `events.jsonl`. */
  denied: number;
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
  let denied = 0;
  const onDeny = (tool: string, input: Record<string, unknown>, reason: string) => {
    denied += 1;
    event({ type: 'denied', tool, detail: describeInput(input), reason });
  };

  try {
    const queryFn = deps.query ?? (await loadQuery());
    const outcome = await runSdkLoop(
      queryFn,
      { prompt, options: sdkOptions(system, options, controller, onDeny) },
      {
        onText: (text) => {
          raw.write(text);
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
      denied,
      turns: result?.turns ?? 0,
      costUsd: result?.costUsd ?? null,
      incomplete: incompleteReason(result),
    };
  } finally {
    clearTimeout(timer);
    unregister();
    await Promise.all([closeStream(raw), closeStream(events)]);
  }
}

/**
 * Why a run counts as unfinished. A result can say `success` and still carry
 * an error — a run that could not sign in ends that way, with the refusal as
 * its only text.
 */
function incompleteReason(result: { subtype: string; isError: boolean } | null): string | null {
  if (result === null) return 'no result';
  if (result.subtype !== 'success') return result.subtype;
  return result.isError ? 'error' : null;
}

function sdkOptions(
  system: string,
  options: ClaudeRunOptions,
  controller: AbortController,
  onDeny: (tool: string, input: Record<string, unknown>, reason: string) => void,
): Options {
  return {
    cwd: options.cwd,
    model: options.model,
    systemPrompt: system,
    tools: [...TOOLS],
    allowedTools: [...PRE_APPROVED],
    canUseTool: (tool, input) => {
      const decision = permission(tool, input);
      if (decision.behavior === 'deny') onDeny(tool, input, decision.message);
      return Promise.resolve(decision);
    },
    // The engineer's own settings and the reviewed repository's CLAUDE.md (D5).
    settingSources: ['user', 'project', 'local'],
    persistSession: false,
    abortController: controller,
    maxTurns: options.maxTurns,
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
