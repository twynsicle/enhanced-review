/**
 * How the overview's and the chapters' bodies are written, chosen per run with
 * `--overview-style`. The lede is never restyled: it is what a reader skims
 * the sidebar and the summary by, so it stays one short sentence whatever the
 * body becomes.
 *
 * A style is a section of the run's own prompt, never of the system prompt,
 * which stays byte-identical across runs so that it is read from cache.
 */
export const OVERVIEW_STYLES = [
  'narrative',
  'checklist',
  'before-after',
  'five-whys',
  'plain',
  'tldr',
] as const;

export type OverviewStyle = (typeof OVERVIEW_STYLES)[number];

export const DEFAULT_OVERVIEW_STYLE: OverviewStyle = 'narrative';

/** What each style asks of a body; `narrative` is the system prompt's own and adds nothing. */
export const OVERVIEW_STYLE_TEXT: Record<OverviewStyle, string | null> = {
  narrative: null,
  checklist:
    'Write each body as a short Markdown list of what a reviewer should verify, and nothing else: ' +
    'no paragraph before or after it. Use plain `- ` bullets, not `- [ ]` boxes. Three to six ' +
    'items, fewer for a small chapter. Each item is one question a reviewer can answer yes or no ' +
    'by reading this change, about one concrete behaviour, edge case or boundary, and where it is: ' +
    '"Does a retried upload reuse the first attempt’s idempotency key?" Not a task for the author, ' +
    'and not a restatement of what the code does. Gloss a term in parentheses in the question that ' +
    'first uses it. The overview’s list holds what spans chapters; a chapter’s list holds only ' +
    'what its own hunks raise.',
  'before-after':
    'Write each body as Before and After pairs: what the system did before this change, then what ' +
    'it does now. One pair per behaviour that changed, at most three, each as two list items:\n\n' +
    '- **Before:** a failed upload was dropped without a trace.\n' +
    '- **After:** it is retried twice, then recorded as failed.\n\n' +
    'Describe what a user or a caller would notice, not the shape of the code. Take each Before ' +
    'from the base side of the diff or the file as it stood, never from a guess. For something ' +
    'wholly new, the Before is what happened without it. A chapter with no behaviour to compare, ' +
    'such as new tests or docs, gets one sentence on what it adds, or no body.',
  'five-whys':
    'Write each body as a chain of why-questions, from what changed down to the reason it was worth ' +
    'changing. Use a numbered Markdown list. Each item is a short question in bold, then its ' +
    'answer in one sentence: "1. **Why add a retry?** Uploads failed on flaky networks." The first ' +
    'question asks why the change was made, and each one after it asks why about the answer before ' +
    'it. Stop at the motivation the description, the commits or the code actually state. That is ' +
    'usually two or three steps, and never more than five. Do not pad the chain to reach five. If ' +
    'the evidence runs out before the root, end on the last reason you can support and say that ' +
    'the rest is not stated.',
  plain:
    'Write each body for someone who has never seen this codebase: plain words, no identifiers, ' +
    'no file paths and no jargon; the file list beside each chapter names the code. Explain in a ' +
    'few words any term the change cannot be described without. Say what the change means for ' +
    'the people or systems that rely on it, not how the code does it. Two or three short ' +
    'sentences at most, and one when the chapter is internal plumbing with no effect anyone would ' +
    'notice.',
  tldr:
    'Leave out the "body" entirely, in overviewSummary and in every chapter’s description, so ' +
    'that each lede is the whole of the prose. Make that one sentence carry the change, or its one ' +
    'risk when the risk is what a reviewer most needs to know. The reader will read the code for ' +
    'the rest.',
};

export function isOverviewStyle(name: string): name is OverviewStyle {
  return (OVERVIEW_STYLES as readonly string[]).includes(name);
}

/**
 * The prompt's section for a style, or null for the default. The framing says
 * outright that the system prompt's description of a body is replaced and
 * nothing else is, since a model told only "write checklists" could as easily
 * restyle the ledes, or take it as licence to change the JSON.
 */
export function overviewStyleSection(style: OverviewStyle): string | null {
  const text = OVERVIEW_STYLE_TEXT[style];
  if (text === null) return null;
  return (
    `## Overview Style: ${style}\n` +
    'The engineer who ran this review chose what goes in the "body" of overviewSummary and of ' +
    'each chapter’s description. This replaces what your system prompt says a body ' +
    'holds. Everything else there still holds: each "lede" is one sentence of at most 20 words, ' +
    'the JSON shape does not change, and a body states nothing the diff, the description, the ' +
    'commits or the code you read does not support.\n\n' +
    text
  );
}
