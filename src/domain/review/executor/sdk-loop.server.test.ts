import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import { runSdkLoop, type SdkQueryFn } from './sdk-loop.server.ts';

const assistant = (...blocks: unknown[]) =>
  ({ type: 'assistant', message: { content: blocks } }) as unknown as SDKMessage;
const text = (value: string) => ({ type: 'text', text: value });
const toolUse = (name: string, input: Record<string, unknown>) => ({
  type: 'tool_use',
  name,
  input,
});
const result = (fields: Record<string, unknown>) =>
  ({ type: 'result', num_turns: 2, ...fields }) as unknown as SDKMessage;

const yielding = (messages: SDKMessage[]): SdkQueryFn =>
  function* stream() {
    for (const message of messages) yield message;
  } as unknown as SdkQueryFn;

const args = (options: Options = {}) => ({ prompt: 'review this', options });

describe('the shared SDK loop', () => {
  it('collects the model’s text and how the run ended', async () => {
    const outcome = await runSdkLoop(
      yielding([
        assistant(text('<narrative_review>'), text('{}</narrative_review>')),
        result({ subtype: 'success', is_error: false, total_cost_usd: 0.3, num_turns: 9 }),
      ]),
      args(),
    );

    expect(outcome).toEqual({
      raw: '<narrative_review>{}</narrative_review>',
      result: { subtype: 'success', isError: false, turns: 9, costUsd: 0.3 },
      sdkError: null,
      callbackError: null,
    });
  });

  it('reports tool uses with what they name, and system messages by subtype', async () => {
    const onToolUse = vi.fn<(tool: string, detail: string) => void>();
    const onSystem = vi.fn<(subtype: string) => void>();

    await runSdkLoop(
      yielding([
        { type: 'system', subtype: 'init' } as unknown as SDKMessage,
        assistant(
          toolUse('Grep', { pattern: 'addWorktree' }),
          toolUse('Bash', { command: 'git log' }),
        ),
        result({ subtype: 'success', is_error: false, total_cost_usd: 0 }),
      ]),
      args(),
      { onToolUse, onSystem },
    );

    expect(onToolUse.mock.calls).toEqual([
      ['Grep', 'addWorktree'],
      ['Bash', 'git log'],
    ]);
    expect(onSystem).toHaveBeenCalledWith('init');
  });

  it('hands back an SDK failure with the text collected before it, instead of throwing', async () => {
    const failing: SdkQueryFn = () =>
      (async function* () {
        yield assistant(text('half an answer'));
        await Promise.resolve();
        throw new Error('spawn failed');
      })();

    const outcome = await runSdkLoop(failing, args());

    expect(outcome.raw).toBe('half an answer');
    expect(outcome.sdkError?.message).toBe('spawn failed');
    expect(outcome.result).toBeNull();
  });

  it('stops the run when the text callback throws, and reports what it threw', async () => {
    const controller = new AbortController();
    const later = vi.fn<(text: string) => void>();
    const onText = vi.fn<(text: string) => void>().mockImplementationOnce(() => {
      throw new Error('the chunk could not be saved');
    });

    const outcome = await runSdkLoop(
      yielding([
        assistant(text('first')),
        assistant(text('second')),
        result({ subtype: 'success', is_error: false, total_cost_usd: 0 }),
      ]),
      args({ abortController: controller }),
      {
        onText: (value) => {
          onText(value);
          later(value);
        },
      },
    );

    expect(outcome.callbackError?.message).toBe('the chunk could not be saved');
    expect(later).not.toHaveBeenCalled();
    expect(controller.signal.aborted).toBe(true);
    expect(outcome.result).toBeNull();
  });
});
