import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SdkQueryFn } from '../cli/sdk-loop.ts';
import { caseFiles, writeCase, type Label, type LoadedCase } from './skim-case.ts';
import { readSweep, requireApiKey, runSweep, sampleFiles, type SampleMeta } from './skim-run.ts';
import { SKIM_SYSTEM_PROMPT } from './skim-prompt.ts';

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'er-sweep-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

const labels: Label[] = [
  { id: 'H0001', file: 'src/a.ts', header: '@@ -1 +1 @@', tier: 'read', category: 'logic' },
];
const loaded: LoadedCase = {
  case: {
    name: 'c',
    source: { folder: 'er-reviews/pr-1/x', repo: 'o/r', kind: 'pr' },
    title: 't',
    description: null,
    commits: [],
    files: [{ filename: 'src/a.ts', status: 'modified', additions: 1, deletions: 0 }],
    hunks: [
      {
        id: 'H0001',
        filename: 'src/a.ts',
        header: '@@ -1 +1 @@',
        fileOrder: 1,
        original: { startLine: 1, lineCount: 1 },
        modified: { startLine: 1, lineCount: 1 },
        changedLines: 1,
      },
    ],
  },
  diff: 'diff --git a/src/a.ts b/src/a.ts\n# H0001\n@@ -1 +1 @@\n-a\n+b\n',
  labels,
};

const text = (value: string) =>
  ({ type: 'assistant', message: { content: [{ type: 'text', text: value }] } }) as SDKMessage;
const result = (fields: Record<string, unknown>) =>
  ({ type: 'result', subtype: 'success', num_turns: 1, ...fields }) as unknown as SDKMessage;

/** Answers each query with the next script, recording every call's prompt and options. */
function fakeQuery(
  scripts: SDKMessage[][],
): SdkQueryFn & { calls: { prompt: string; options: Options }[] } {
  const calls: { prompt: string; options: Options }[] = [];
  const query: SdkQueryFn = ({ prompt, options }) => {
    calls.push({ prompt, options });
    const messages = scripts[calls.length - 1] ?? [];
    return (async function* () {
      for (const message of messages) await Promise.resolve(yield message);
    })();
  };
  return Object.assign(query, { calls });
}

describe('runSweep', () => {
  it('queries once per sample, with no tools and one turn, and keeps every answer', async () => {
    await writeCase(caseFiles(root, 'c'), loaded);
    const answer = '<hunk_tiers>{"hunks":[{"id":"H0001","tier":"read"}]}</hunk_tiers>';
    const query = fakeQuery([
      [text(answer), result({ total_cost_usd: 0.25, modelUsage: {} })],
      [text('nothing useful'), result({ subtype: 'error_max_turns', total_cost_usd: 0.5 })],
    ]);
    const seen: [string, number, SampleMeta][] = [];
    const sweep = await runSweep(
      { root, model: 'a-model', samples: 2, cases: ['c'], parallel: 1 },
      { query, onSample: (name, sample, meta) => seen.push([name, sample, meta]) },
    );

    expect(query.calls).toHaveLength(2);
    const { prompt, options } = query.calls[0]!;
    expect(prompt).toContain('# t');
    expect(prompt).toContain('H0001  src/a.ts');
    expect(prompt).toContain('-a\n+b');
    expect(options).toMatchObject({
      model: 'a-model',
      systemPrompt: SKIM_SYSTEM_PROMPT,
      tools: [],
      allowedTools: [],
      maxTurns: 1,
      settingSources: [],
      persistSession: false,
    });

    expect(seen.map(([name, sample, meta]) => [name, sample, meta.costUsd, meta.ended])).toEqual([
      ['c', 1, 0.25, null],
      ['c', 2, 0.5, 'error_max_turns'],
    ]);
    expect(readFileSync(sampleFiles(sweep, 'c', 1).text, 'utf8')).toBe(answer);

    const { record, answers } = await readSweep(sweep);
    expect(record).toMatchObject({ model: 'a-model', samples: 2, cases: ['c'], costUsd: 0.75 });
    expect(record.finishedAt).not.toBeNull();
    expect(Object.keys(record.catalogs)).toEqual(['c']);
    const [first, second] = answers.get('c')!;
    expect(first!.tiers.get('H0001')?.tier).toBe('read');
    expect(second!.problems).toEqual(['no <hunk_tiers> block in the answer']);
  });

  it('fails the sweep when the SDK fails, rather than scoring a silence', async () => {
    await writeCase(caseFiles(root, 'c'), loaded);
    const query: SdkQueryFn = () => {
      throw new Error('Not logged in');
    };
    await expect(
      runSweep({ root, model: 'm', samples: 1, cases: ['c'], parallel: 1 }, { query }),
    ).rejects.toThrow('Not logged in');
  });
});

describe('requireApiKey', () => {
  it('insists on a key, so a sweep never draws on a plan sign-in', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    expect(() => requireApiKey()).toThrow('ANTHROPIC_API_KEY is not set');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    expect(() => requireApiKey()).not.toThrow();
  });
});
