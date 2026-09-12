import type { ModelUsage, Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';

/**
 * The Agent SDK message loop, shared by the server's executor and the local
 * `er` CLI. It knows how to read a stream of SDK
 * messages and nothing else: no logging, no configuration, no policy about
 * what a failure means. Each caller supplies the options and decides what to
 * do with the outcome, because the two want different things — the server
 * turns a failure into a job error, the CLI into a message and a file on
 * disk it can resume from.
 *
 * Nothing here throws. Everything that went wrong is reported in the
 * outcome, so a caller cannot accidentally lose the text collected before a
 * failure.
 */

export type SdkQueryFn = (args: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;

/** How the run ended, as the SDK's own result message describes it. */
export interface SdkRunResult {
  subtype: string;
  /** A result can be `success` and still carry an error, such as a failed sign-in. */
  isError: boolean;
  turns: number;
  /** Every result carries this, including a run that ran out of turns. */
  costUsd: number | null;
  usage: SdkUsage;
}

/**
 * What the run spent, totalled over every model it used. An agentic run pays
 * for its whole context on each turn, so `inputTokens` climbs far past the
 * size of the prompt, and how much of it was read from cache rather than sent
 * again is the difference between a cheap review and an expensive one.
 */
export interface SdkUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

const NO_USAGE: SdkUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

function totalUsage(byModel: Record<string, ModelUsage> | undefined): SdkUsage {
  const total = { ...NO_USAGE };
  for (const model of Object.values(byModel ?? {})) {
    total.inputTokens += model.inputTokens;
    total.outputTokens += model.outputTokens;
    total.cacheReadTokens += model.cacheReadInputTokens;
    total.cacheWriteTokens += model.cacheCreationInputTokens;
  }
  return total;
}

export interface SdkLoopCallbacks {
  /** Each block of model text, in order. Throwing stops the run. */
  onText?: (text: string) => void;
  /** A tool the model used, with the path, pattern or command it named. */
  onToolUse?: (tool: string, detail: string) => void;
  onSystem?: (subtype: string) => void;
}

export interface SdkLoopOutcome {
  /** Every block of model text, joined. */
  raw: string;
  result: SdkRunResult | null;
  /** The SDK threw and iteration stopped here. */
  sdkError: Error | null;
  /** `onText` threw; the run was aborted and this is what it threw. */
  callbackError: Error | null;
}

export async function runSdkLoop(
  queryFn: SdkQueryFn,
  args: { prompt: string; options: Options },
  callbacks: SdkLoopCallbacks = {},
): Promise<SdkLoopOutcome> {
  let raw = '';
  let result: SdkRunResult | null = null;
  let callbackError: Error | null = null;

  try {
    for await (const message of queryFn(args)) {
      if (callbackError) break;
      if (message.type === 'assistant') {
        for (const block of assistantBlocks(message)) {
          if (block.kind === 'tool') {
            callbacks.onToolUse?.(block.tool, block.detail);
            continue;
          }
          raw += block.text;
          try {
            callbacks.onText?.(block.text);
          } catch (error) {
            callbackError = asError(error);
            // Stop the model as well: nobody is listening any more.
            args.options.abortController?.abort();
            break;
          }
        }
      } else if (message.type === 'result') {
        result = {
          subtype: message.subtype,
          isError: message.is_error === true,
          turns: message.num_turns,
          // A run that ran out of turns still charged for the ones it took.
          costUsd: message.total_cost_usd,
          usage: totalUsage(message.modelUsage),
        };
      } else if (message.type === 'system') {
        callbacks.onSystem?.(message.subtype);
      }
    }
  } catch (error) {
    return { raw, result, sdkError: asError(error), callbackError };
  }

  return { raw, result, sdkError: null, callbackError };
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

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
