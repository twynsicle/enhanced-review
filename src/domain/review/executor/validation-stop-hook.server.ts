import type { HookCallbackMatcher, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import { fatalFindings } from '../findings.ts';
import type { PromptGrounding } from '../prompt/diff-hunk-catalog.ts';
import { validateReview } from '../validate-review.ts';

/**
 * The retry loop, as a Stop hook.
 *
 * A review that omits a hunk, or writes a chapter it can show nothing for, is
 * a defect the model can fix — it still has the diff and its own answer in
 * context, and the correction costs one more turn rather than a whole second
 * run. Refusing the stop and naming the exact defect is far cheaper than
 * failing the job and making a person resubmit, so validation runs here,
 * where the answer can still be repaired, and only what survives three
 * attempts is allowed to fail the review.
 *
 * The hook reads the caller's own accumulated text rather than
 * `last_assistant_message`: a 40 KB narrative arrives over several assistant
 * messages, and grading the last one alone would report a missing block for
 * an answer that is perfectly complete.
 *
 * Imports the SDK for types only, so the local CLI can share this module
 * without loading the SDK to build a hook.
 */
export interface ValidationStopHookOptions {
  /** What the answer is held against; the same grounding the prompt was built from. */
  grounding: PromptGrounding | undefined;
  /** How many times the stop may be refused before the answer is taken as final. */
  maxRetries: number;
  /** Everything the model has said so far, joined. */
  text: () => string;
  /** Called with each refusal, for the log line a person will look for. */
  onBlock: (attempt: number, reason: string) => void;
}

/** Three, because a defect a model cannot fix in three tries it will not fix in ten. */
export const MAX_VALIDATION_RETRIES = 3;

const REDO =
  'Re-emit the complete <narrative_review>…</narrative_review> block, with every hunk you were shown placed in a chapter. Emit the whole block again, not a fragment of it.';

export function validationStopHook(options: ValidationStopHookOptions): HookCallbackMatcher {
  let blocks = 0;

  // `stop_hook_active` says only that some hook already blocked once, never
  // how many times, so the budget is counted here.
  const hook = (): Promise<HookJSONOutput> => {
    const { findings } = validateReview(options.text(), options.grounding);
    const fatal = fatalFindings(findings);
    if (fatal.length === 0 || blocks >= options.maxRetries) {
      return Promise.resolve({ continue: true });
    }

    blocks += 1;
    const reason = `${fatal.map((item) => item.message).join(' ')} ${REDO}`;
    options.onBlock(blocks, reason);
    return Promise.resolve({ decision: 'block', reason });
  };

  return { hooks: [hook] };
}
