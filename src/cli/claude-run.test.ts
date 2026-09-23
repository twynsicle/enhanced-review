import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { HookInput, Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { groundingFor } from '../review/prompt/diff-hunk-catalog.ts';
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

/** One turn that asks for several tools at once, as a batching agent does. */
const toolUses = (...tools: [name: string, input: Record<string, unknown>][]) =>
  ({
    type: 'assistant',
    message: { content: tools.map(([name, input]) => ({ type: 'tool_use', name, input })) },
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

const hunk = (id: string) => ({
  id,
  filename: 'src/a.ts',
  header: '@@ -1,3 +1,4 @@',
  fileOrder: 1,
  original: { startLine: 1, lineCount: 3 },
  modified: { startLine: 1, lineCount: 4 },
});

const options = {
  cwd: 'C:/repo',
  tree: 'own' as const,
  model: 'test-model',
  maxTurns: 5,
  timeoutMs: 60_000,
  grounding: groundingFor([]),
};

const events = () =>
  readFileSync(run.events, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);

/** A review of the one reviewed file, citing exactly the hunks named. */
const answer = (hunkIds: string[]) =>
  `<narrative_review>${JSON.stringify({
    prTitle: 'One file',
    overviewSummary: { lede: 'A summary.' },
    chapters: [
      {
        id: 'c1',
        title: 'The change',
        insights: [],
        diffChunks: [{ filename: 'src/a.ts', language: 'typescript', hunkIds }],
      },
    ],
  })}</narrative_review>`;

/**
 * A query that answers, then submits to the Stop hook the way the SDK does: a
 * refusal sends it back for the next answer in the list, and the last answer
 * stands whatever the hook says of it.
 */
function answeringQuery(answers: string[]): QueryFn {
  return ({ options: sdkOptions }) =>
    (async function* () {
      for (const [index, value] of answers.entries()) {
        yield text(value);
        const hook = sdkOptions.hooks?.Stop?.[0]?.hooks[0];
        if (!hook) throw new Error('no Stop hook was registered');
        const out = (await hook(
          {
            hook_event_name: 'Stop',
            stop_hook_active: index > 0,
            session_id: 's',
            transcript_path: 't',
            cwd: '.',
          } as HookInput,
          undefined,
          { signal: new AbortController().signal },
        )) as { decision?: string };
        if (out.decision !== 'block') break;
      }
      yield result({ subtype: 'success', total_cost_usd: 0 });
    })();
}

describe('the model run', () => {
  it('writes what the model said to raw.txt and how it went to events.jsonl', async () => {
    const query = fakeQuery([
      text('<narrative_review>{'),
      text('}</narrative_review>'),
      result({ subtype: 'success', total_cost_usd: 0.42, num_turns: 7 }),
    ]);

    await expect(runClaude(run, options, { query })).resolves.toEqual({
      characters: 39,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      turns: 7,
      costUsd: 0.42,
      incomplete: null,
    });
    expect(readFileSync(run.raw, 'utf8')).toBe('<narrative_review>{}</narrative_review>');
    expect(events().at(-1)).toMatchObject({ type: 'result', subtype: 'success', turns: 7 });
  });

  it('reports each tool use as it happens, with what it was about and its turn', async () => {
    const onActivity = vi.fn<(activity: string, turn: number) => void>();
    const query = fakeQuery([
      toolUses(
        ['Read', { file_path: 'src/cli/review.ts' }],
        ['Bash', { command: 'git log --oneline -5' }],
      ),
      toolUse('Grep', { pattern: 'addWorktree' }),
      text('a review'),
      result({ subtype: 'success', total_cost_usd: 0.1 }),
    ]);

    await runClaude(run, options, { query, onActivity });

    // Two tools asked for at once is one turn, which is what --max-turns counts.
    expect(onActivity.mock.calls).toEqual([
      ['Read src/cli/review.ts', 1],
      ['Bash git log --oneline -5', 1],
      ['Grep addWorktree', 2],
    ]);
    expect(events().filter((event) => event.type === 'tool')).toEqual([
      expect.objectContaining({ type: 'tool', turn: 1, tool: 'Read' }),
      expect.objectContaining({ type: 'tool', turn: 1, tool: 'Bash' }),
      expect.objectContaining({ type: 'tool', turn: 2, tool: 'Grep' }),
    ]);
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

  it('reads only the engineer’s user settings in a worktree of someone else’s PR', async () => {
    const query = fakeQuery([text('a review'), result({ subtype: 'success', total_cost_usd: 0 })]);

    await runClaude(run, { ...options, tree: 'pr' }, { query });

    // A hook or an allow rule in the PR's own .claude/ would run as the reviewer.
    expect(query.options().settingSources).toEqual(['user']);
  });

  it('runs the agent with git refusing a bare repository it was not pointed at', async () => {
    const query = fakeQuery([text('a review'), result({ subtype: 'success', total_cost_usd: 0 })]);

    await runClaude(run, options, { query });

    const env = query.options().env ?? {};
    const index = Number(env.GIT_CONFIG_COUNT) - 1;
    expect(env[`GIT_CONFIG_KEY_${String(index)}`]).toBe('safe.bareRepository');
    expect(env[`GIT_CONFIG_VALUE_${String(index)}`]).toBe('explicit');
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

    await runClaude(run, options, { query: asking });
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

describe('the validation retry', () => {
  const grounded = { ...options, grounding: groundingFor([hunk('H0001'), hunk('H0002')]) };

  it('asks the model again when a hunk it was shown is cited by no chapter', async () => {
    const onBlocked = vi.fn<(attempt: number, reason: string) => void>();
    const query = answeringQuery([answer(['H0001']), answer(['H0001', 'H0002'])]);

    await runClaude(run, grounded, { query, onBlocked });

    expect(onBlocked.mock.calls.map(([attempt]) => attempt)).toEqual([1]);
    expect(onBlocked.mock.calls[0]?.[1]).toContain('H0002 (src/a.ts)');
    // Both answers are in raw.txt; the parser reads the last complete block.
    expect(readFileSync(run.raw, 'utf8')).toContain('"H0002"');
    expect(events().filter((event) => event.type === 'blocked')).toMatchObject([
      { attempt: 1, reason: expect.stringContaining('complete narrative review block again') },
    ]);
  });

  it('lets a complete first answer stop without asking anything', async () => {
    const onBlocked = vi.fn<(attempt: number, reason: string) => void>();
    await runClaude(run, grounded, {
      query: answeringQuery([answer(['H0001', 'H0002'])]),
      onBlocked,
    });

    expect(onBlocked).not.toHaveBeenCalled();
    expect(events().filter((event) => event.type === 'blocked')).toEqual([]);
  });
});
