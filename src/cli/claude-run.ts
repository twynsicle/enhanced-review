import { createWriteStream, type WriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
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
/** A 60-file review needs more turns than the server's 30; set from measurement in commit 5. */
export const DEFAULT_MAX_TURNS = 60;
export const DEFAULT_TIMEOUT_MINUTES = 15;

/** Read-only. The three the hosted executor uses run without asking; Bash is gated. */
const TOOLS = ['Read', 'Glob', 'Grep', 'Bash'] as const;
const PRE_APPROVED = ['Read', 'Glob', 'Grep'] as const;

export type QueryFn = (args: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;

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
}

export interface ClaudeRunResult {
  /** Characters of model text written to `raw.txt`. */
  characters: number;
  turns: number;
  costUsd: number | null;
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
  let turns = 0;
  let costUsd: number | null = null;
  let incomplete: string | null = null;

  try {
    const queryFn = deps.query ?? (await loadQuery());
    for await (const message of queryFn({
      prompt,
      options: sdkOptions(system, options, controller),
    })) {
      if (message.type === 'assistant') {
        for (const block of assistantBlocks(message)) {
          if (block.kind === 'text') {
            raw.write(block.text);
            characters += block.text.length;
          } else {
            event({ type: 'tool', tool: block.tool, detail: block.detail });
            deps.onActivity?.(activityLine(block.tool, block.detail));
          }
        }
      } else if (message.type === 'result') {
        turns = message.num_turns;
        costUsd = message.subtype === 'success' ? message.total_cost_usd : null;
        // `is_error` can be set on an otherwise successful result: a run that
        // could not sign in ends that way, with the refusal as its only text.
        if (message.subtype !== 'success') incomplete = message.subtype;
        else if (message.is_error) incomplete = 'error';
        event({
          type: 'result',
          subtype: message.subtype,
          isError: message.is_error,
          turns,
          costUsd,
        });
      } else if (message.type === 'system') {
        event({ type: 'system', subtype: message.subtype });
      }
    }
  } catch (error) {
    if (controller.signal.aborted) throw stoppedEarly(options, characters, run);
    throw withSigninHint(error);
  } finally {
    clearTimeout(timer);
    unregister();
    await Promise.all([closeStream(raw), closeStream(events)]);
  }

  // The SDK can stop iterating on an abort without throwing.
  if (controller.signal.aborted) throw stoppedEarly(options, characters, run);
  if (characters === 0) {
    throw new Error(
      `the model wrote nothing${incomplete === null ? '' : ` (${incomplete})`}; see ${run.events}`,
    );
  }
  return { characters, turns, costUsd, incomplete };
}

function sdkOptions(
  system: string,
  options: ClaudeRunOptions,
  controller: AbortController,
): Options {
  return {
    cwd: options.cwd,
    model: options.model,
    systemPrompt: system,
    tools: [...TOOLS],
    allowedTools: [...PRE_APPROVED],
    canUseTool: (tool, input) => Promise.resolve(permission(tool, input)),
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

type AssistantBlock =
  { kind: 'text'; text: string } | { kind: 'tool'; tool: string; detail: string };

function assistantBlocks(message: SDKMessage & { type: 'assistant' }): AssistantBlock[] {
  const content: unknown = message.message.content;
  if (!Array.isArray(content)) return [];
  const blocks: AssistantBlock[] = [];
  for (const block of content) {
    if (typeof block !== 'object' || block === null || !('type' in block)) continue;
    if (block.type === 'text' && 'text' in block && typeof block.text === 'string') {
      blocks.push({ kind: 'text', text: block.text });
    } else if (block.type === 'tool_use' && 'name' in block && typeof block.name === 'string') {
      blocks.push({ kind: 'tool', tool: block.name, detail: toolDetail(block) });
    }
  }
  return blocks;
}

/** What a tool use is about: the path, the pattern or the command. */
function toolDetail(block: object): string {
  const input: unknown = 'input' in block ? block.input : undefined;
  if (typeof input !== 'object' || input === null) return '';
  const fields = input as Record<string, unknown>;
  for (const key of ['file_path', 'path', 'pattern', 'command']) {
    const value = fields[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return '';
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
