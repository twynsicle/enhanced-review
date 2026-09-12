import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runClaude, type QueryFn } from './claude-run.ts';
import { runFiles, type RunFiles } from './run-folder.ts';

let folder: string;
let run: RunFiles;

beforeEach(() => {
  folder = mkdtempSync(path.join(tmpdir(), 'er-run-'));
  run = runFiles(folder);
  writeFileSync(run.system, 'the instructions\n');
  writeFileSync(run.prompt, 'the change\n');
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

const text = (value: string) =>
  ({
    type: 'assistant',
    message: { content: [{ type: 'text', text: value }] },
  }) as unknown as SDKMessage;

const toolUse = (name: string, input: Record<string, unknown>) =>
  ({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name, input }] },
  }) as unknown as SDKMessage;

const result = (fields: Record<string, unknown>) =>
  ({ type: 'result', num_turns: 3, ...fields }) as unknown as SDKMessage;

/** A query that yields the given messages, and records the options it was handed. */
function fakeQuery(messages: SDKMessage[]): QueryFn & { options: () => Options } {
  let seen: Options | undefined;
  const query: QueryFn = ({ options }) => {
    seen = options;
    return (async function* () {
      for (const message of messages) await Promise.resolve(yield message);
    })();
  };
  return Object.assign(query, {
    options: () => {
      if (!seen) throw new Error('the query was never called');
      return seen;
    },
  });
}

const options = { cwd: 'C:/repo', model: 'test-model', maxTurns: 5, timeoutMs: 60_000 };

const events = () =>
  readFileSync(run.events, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);

describe('the model run', () => {
  it('writes what the model said to raw.txt and how it went to events.jsonl', async () => {
    const query = fakeQuery([
      text('<narrative_review>{'),
      text('}</narrative_review>'),
      result({ subtype: 'success', total_cost_usd: 0.42, num_turns: 7 }),
    ]);

    await expect(runClaude(run, options, { query })).resolves.toEqual({
      characters: 39,
      denied: 0,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      turns: 7,
      costUsd: 0.42,
      incomplete: null,
    });
    expect(readFileSync(run.raw, 'utf8')).toBe('<narrative_review>{}</narrative_review>');
    expect(events().at(-1)).toMatchObject({ type: 'result', subtype: 'success', turns: 7 });
  });

  it('reports each tool use as it happens, with what it was about', async () => {
    const onActivity = vi.fn<(activity: string) => void>();
    const query = fakeQuery([
      toolUse('Read', { file_path: 'src/cli/review.ts' }),
      toolUse('Bash', { command: 'git log --oneline -5' }),
      text('a review'),
      result({ subtype: 'success', total_cost_usd: 0.1 }),
    ]);

    await runClaude(run, options, { query, onActivity });

    expect(onActivity.mock.calls.map(([activity]) => activity)).toEqual([
      'Read src/cli/review.ts',
      'Bash git log --oneline -5',
    ]);
    expect(events().filter((event) => event.type === 'tool')).toHaveLength(2);
  });

  it('runs the agent in the review’s working directory, with the repo’s own settings', async () => {
    const query = fakeQuery([text('a review'), result({ subtype: 'success', total_cost_usd: 0 })]);

    await runClaude(run, options, { query });

    expect(query.options()).toMatchObject({
      cwd: 'C:/repo',
      model: 'test-model',
      maxTurns: 5,
      systemPrompt: 'the instructions\n',
      settingSources: ['user', 'project', 'local'],
      allowedTools: ['Read', 'Glob', 'Grep'],
      tools: ['Read', 'Glob', 'Grep', 'Bash'],
    });
  });

  it('lets the agent read history with Bash, and nothing else', async () => {
    const query = fakeQuery([text('a review'), result({ subtype: 'success', total_cost_usd: 0 })]);
    await runClaude(run, options, { query });
    const canUseTool = query.options().canUseTool!;
    const ask = (tool: string, input: Record<string, unknown>) =>
      canUseTool(tool, input, { signal: AbortSignal.abort(), toolUseID: 'tool-1' });

    await expect(ask('Bash', { command: 'git blame src/cli/er.ts' })).resolves.toMatchObject({
      behavior: 'allow',
    });
    await expect(ask('Bash', { command: 'git push --force' })).resolves.toMatchObject({
      behavior: 'deny',
    });
    await expect(ask('Write', { file_path: 'x', content: 'y' })).resolves.toMatchObject({
      behavior: 'deny',
      message: expect.stringContaining('read-only'),
    });
  });

  it('records a refused command, so a gate that is too tight is visible', async () => {
    // Asked mid-run, the way the SDK asks: the refusal has to reach
    // events.jsonl while the run is still writing it.
    const asking: QueryFn = ({ options: sdkOptions }) => {
      const ask = (command: string) =>
        sdkOptions.canUseTool!(
          'Bash',
          { command },
          {
            signal: AbortSignal.abort(),
            toolUseID: 'tool-1',
          },
        );
      return (async function* () {
        await ask('git log --oneline');
        await ask('rm -rf .');
        yield text('a review');
        yield result({ subtype: 'success', total_cost_usd: 0 });
      })();
    };

    await expect(runClaude(run, options, { query: asking })).resolves.toMatchObject({ denied: 1 });
    expect(events().filter((event) => event.type === 'denied')).toMatchObject([
      { tool: 'Bash', detail: 'rm -rf .', reason: expect.stringContaining('read-only') },
    ]);
  });

  it('keeps a partial answer and says how the run ended', async () => {
    const query = fakeQuery([text('half a review'), result({ subtype: 'error_max_turns' })]);

    await expect(runClaude(run, options, { query })).resolves.toMatchObject({
      incomplete: 'error_max_turns',
      costUsd: null,
    });
    expect(readFileSync(run.raw, 'utf8')).toBe('half a review');
  });

  it('treats a failed result as incomplete even when its subtype says success', async () => {
    // How a run that could not sign in comes back: one turn, no cost, the
    // refusal as its only text.
    const query = fakeQuery([
      text('Not logged in'),
      result({ subtype: 'success', is_error: true, total_cost_usd: 0, num_turns: 1 }),
    ]);

    await expect(runClaude(run, options, { query })).resolves.toMatchObject({
      incomplete: 'error',
    });
    expect(events().at(-1)).toMatchObject({ isError: true });
  });

  it('says how to sign in when that is what the SDK complained about', async () => {
    const query: QueryFn = () =>
      (async function* () {
        yield text('some text');
        await Promise.resolve();
        throw new Error('Claude Code returned an error result: Not logged in · Please run /login');
      })();

    await expect(runClaude(run, options, { query })).rejects.toThrow(
      /Not logged in.*Run `claude` and sign in, or set ANTHROPIC_API_KEY/s,
    );
  });

  it('points at the event log when the model says nothing at all', async () => {
    const query = fakeQuery([result({ subtype: 'error_during_execution' })]);

    await expect(runClaude(run, options, { query })).rejects.toThrow(
      /wrote nothing \(error_during_execution\); see .*events\.jsonl/,
    );
  });

  it('stops at the timeout and says which flag raises it', async () => {
    const query: QueryFn = ({ options: sdkOptions }) =>
      (async function* () {
        yield text('a start');
        await new Promise<void>((resolve) => {
          sdkOptions.abortController?.signal.addEventListener('abort', () => {
            resolve();
          });
        });
      })();

    await expect(runClaude(run, { ...options, timeoutMs: 60 }, { query })).rejects.toThrow(
      /stopped after 0 minutes; raise it with --timeout\..*raw\.txt/s,
    );
    expect(readFileSync(run.raw, 'utf8')).toBe('a start');
  });
});
