import type { HookInput } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import { buildDiffHunkIndex, groundingFor } from '../prompt/diff-hunk-catalog.ts';
import { validationStopHook } from './validation-stop-hook.server.ts';

const DIFF = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
+x
@@ -20,2 +21,3 @@
+y
`;

const grounding = groundingFor(buildDiffHunkIndex(DIFF).hunks);

function answer(hunkIds: string[]): string {
  return `<narrative_review>${JSON.stringify({
    prTitle: 't',
    overviewSummary: { lede: 's' },
    chapters: [
      {
        id: 'c',
        title: 'C',
        insights: [],
        diffChunks: [{ filename: 'src/a.ts', language: 'typescript', hunkIds }],
      },
    ],
  })}</narrative_review>`;
}

const STOP = {
  hook_event_name: 'Stop',
  stop_hook_active: false,
  session_id: 's',
  transcript_path: 't',
  cwd: '.',
} as HookInput;

function harness(texts: string[] | (() => string), maxRetries = 3) {
  let at = 0;
  const onBlock = vi.fn<(attempt: number, reason: string, defects: string) => void>();
  const onError = vi.fn<(error: Error) => void>();
  const matcher = validationStopHook({
    grounding,
    maxRetries,
    text: typeof texts === 'function' ? texts : () => texts[Math.min(at, texts.length - 1)] ?? '',
    onBlock,
    onError,
  });
  const stop = async (): Promise<{ decision?: string; reason?: string; continue?: boolean }> => {
    const out = (await matcher.hooks[0]!(STOP, undefined, {
      signal: new AbortController().signal,
    })) as { decision?: string; reason?: string; continue?: boolean };
    at += 1;
    return out;
  };
  return { stop, onBlock, onError };
}

describe('validationStopHook', () => {
  it('lets a complete answer stop', async () => {
    const { stop, onBlock } = harness([answer(['H0001', 'H0002'])]);
    await expect(stop()).resolves.toEqual({ continue: true });
    expect(onBlock).not.toHaveBeenCalled();
  });

  it('refuses the stop with the defect and an instruction to send the whole block', async () => {
    const { stop, onBlock } = harness([answer(['H0001'])]);
    const out = await stop();
    expect(out.decision).toBe('block');
    expect(out.reason).toContain('H0002 (src/a.ts)');
    expect(out.reason).toContain('complete narrative review block again, inside its tags');
    expect(onBlock).toHaveBeenCalledWith(1, out.reason, expect.stringContaining('H0002'));
  });

  /**
   * The instruction is read back by the parser, which looks for the tag pair:
   * spelling it here would leave an empty block at the end of the transcript
   * and disqualify the very answer this asked for.
   */
  it('names no tag pair in what it sends back', async () => {
    const { stop } = harness([answer(['H0001'])]);
    const out = await stop();
    expect(out.reason).not.toContain('</narrative_review>');
  });

  it('allows the stop and reports when the hook itself throws', async () => {
    const { stop, onBlock, onError } = harness(() => {
      throw new Error('the transcript went missing');
    });
    await expect(stop()).resolves.toEqual({ continue: true });
    expect(onBlock).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'the transcript went missing' }),
    );
  });

  /** Reporting the failure must not become the failure it reports. */
  it('still allows the stop when reporting the failure throws too', async () => {
    const matcher = validationStopHook({
      grounding,
      maxRetries: 3,
      text: () => {
        throw new Error('the transcript went missing');
      },
      onBlock: vi.fn(),
      onError: () => {
        throw new Error('and the terminal is gone as well');
      },
    });
    await expect(
      matcher.hooks[0]!(STOP, undefined, { signal: new AbortController().signal }),
    ).resolves.toEqual({ continue: true });
  });

  it('says what is missing when there is no block at all', async () => {
    const { stop } = harness(['I had a look and decided not to.']);
    await expect(stop()).resolves.toMatchObject({
      reason: expect.stringContaining('no complete <narrative_review> block') as string,
    });
  });

  it('stops refusing once the budget is spent', async () => {
    const bad = answer(['H0001']);
    const { stop, onBlock } = harness([bad, bad, bad, bad], 3);
    for (let i = 0; i < 3; i += 1) expect((await stop()).decision).toBe('block');
    await expect(stop()).resolves.toEqual({ continue: true });
    expect(onBlock).toHaveBeenCalledTimes(3);
    expect(onBlock.mock.calls.map(([attempt]) => attempt)).toEqual([1, 2, 3]);
  });

  it('spends nothing on the attempts that were good', async () => {
    const { stop, onBlock } = harness([answer(['H0001']), answer(['H0001', 'H0002'])]);
    expect((await stop()).decision).toBe('block');
    await expect(stop()).resolves.toEqual({ continue: true });
    expect(onBlock).toHaveBeenCalledTimes(1);
  });
});
