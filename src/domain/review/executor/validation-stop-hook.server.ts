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
  /**
   * Called with each refusal: `reason` is the whole message sent back to the
   * model, `defects` only the sentences saying what was wrong. They are
   * separate because the instruction to answer again is addressed to the
   * model and means nothing to a person reading a terminal.
   */
  onBlock: (attempt: number, reason: string, defects: string) => void;
  /**
   * The hook threw. A Stop hook that throws is the one failure mode that can
   * strand a run, so the caller is told and the stop is allowed: an answer
   * nobody graded is still judged downstream, where a bad one fails the
   * review rather than hanging it.
   */
  onError: (error: Error) => void;
}

/** Three, because a defect a model cannot fix in three tries it will not fix in ten. */
export const MAX_VALIDATION_RETRIES = 3;

/**
 * Deliberately does not spell the tag pair: the model quotes its own
 * instructions back, and a sentence carrying both tags leaves an empty block
 * at the end of the transcript for the parser to find.
 */
const REDO =
  'Write out the complete narrative review block again, inside its tags, not a fragment, with every hunk you were shown placed in a chapter.';

export function validationStopHook(options: ValidationStopHookOptions): HookCallbackMatcher {
  let blocks = 0;

  // `stop_hook_active` says only that some hook already blocked once, never
  // how many times, so the budget is counted here.
  const hook = (): Promise<HookJSONOutput> => {
    try {
      const { findings } = validateReview(options.text(), options.grounding);
      const fatal = fatalFindings(findings);
      if (fatal.length === 0 || blocks >= options.maxRetries) {
        return Promise.resolve({ continue: true });
      }

      blocks += 1;
      const defects = fatal.map((item) => item.message).join(' ');
      const reason = `${defects} ${REDO}`;
      options.onBlock(blocks, reason, defects);
      return Promise.resolve({ decision: 'block', reason });
    } catch (error) {
      options.onError(error instanceof Error ? error : new Error(String(error)));
      return Promise.resolve({ continue: true });
    }
  };

  return { hooks: [hook] };
}
