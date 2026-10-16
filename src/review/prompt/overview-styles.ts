import { MAX_HEADLINE_WORDS, OVERVIEW_STYLES, type OverviewStyle } from '../narrative.ts';

/**
 * How the overview's and the chapters' bodies are written, chosen per run with
 * `--overview-style`: one style, or several to compare on the same chapters.
 * The overview's lede and each chapter's headline are never restyled: they are
 * what a reader skims the summary and the chapters by, so they stay one short
 * sentence whatever the body becomes, and every style shares them.
 *
 * A style is a section of the run's own prompt, never of the system prompt,
 * which stays byte-identical across runs so that it is read from cache.
 */
export const DEFAULT_OVERVIEW_STYLE: OverviewStyle = 'narrative';

/** What each style asks of a body; `narrative` is the system prompt's own and adds nothing. */
export const OVERVIEW_STYLE_TEXT: Record<OverviewStyle, string | null> = {
  narrative: null,
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
  simple:
    'Write each body at a lower reading level, for an engineer who does not know this part of the ' +
    'codebase. Short sentences, one idea each, in everyday words: no sentence past 15 words. ' +
    'Explain a term specific to this area in a few plain words the first time it appears. Keep an ' +
    'identifier, in backticks, where the reader needs it to find the code, but never open a ' +
    'sentence with one. No analogies: say what the code does, not what it is like. Where a ' +
    'sentence would list things, write the list.',
  'pros-cons':
    'Write each body as what the change gains and what it costs, as two short Markdown lists:\n\n' +
    '**Pros**\n\n' +
    '- A failed upload is retried instead of lost.\n\n' +
    '**Cons**\n\n' +
    '- A slow server now holds a request for up to six seconds.\n\n' +
    'One line per item, and at most three on each side. A con is a real cost: complexity, a ' +
    'slower path, a behaviour someone relied on that changes, a risk the change takes on. Do not ' +
    'repeat a risk the chapter already raises as an insight. When a side has nothing true to say, ' +
    'write "None found." under it rather than inventing an item. A chapter that only adds tests ' +
    'or docs gets one sentence on what it adds, or no body.',
  tldr:
    'Leave out "bodies" entirely, in overviewSummary and in every chapter, so that the ' +
    'overview’s lede and each chapter’s headline are the whole of the prose. Make that one ' +
    'sentence carry the change, or its one ' +
    'risk when the risk is what a reviewer most needs to know. The reader will read the code for ' +
    'the rest.',
};

export function isOverviewStyle(name: string): name is OverviewStyle {
  return (OVERVIEW_STYLES as readonly string[]).includes(name);
}

/** The styles a body is written in: every one asked for but `tldr`, whose body is none. */
export function bodyStyles(styles: readonly OverviewStyle[]): OverviewStyle[] {
  return styles.filter((style) => style !== 'tldr');
}

/** What every style section holds the model to, whatever the body becomes. */
const UNCHANGED =
  'the overview’s "lede" and every chapter’s "headline" are each one sentence of at most ' +
  `${String(MAX_HEADLINE_WORDS)} words, every chapter has a headline, the rest of the JSON ` +
  'shape does not change, and a body states nothing the diff, the description, the commits or ' +
  'the code you read does not support.';

/**
 * The prompt's section for the styles asked for, or null when that is the
 * default alone. The framing says outright that the system prompt's description
 * of a body is replaced and nothing else is, since a model told only "write
 * before and after pairs" could as easily restyle the headlines, or take it as
 * licence to change the JSON.
 */
export function overviewStyleSection(styles: readonly OverviewStyle[]): string | null {
  // Alone, tldr is asked for, since it also reshapes the headlines. Beside
  // another style it asks nothing: the reader shows it by hiding the bodies.
  const written = styles.length === 1 ? [...styles] : bodyStyles(styles);
  if (written.length === 1) return singleStyle(written[0]!);
  const keys = written.map((style) => `"${style}"`).join(', ');
  return (
    `## Overview Styles: ${written.join(', ')}\n` +
    'The engineer who ran this review is comparing ways of writing a body, so write the body of ' +
    'overviewSummary and of each chapter once in each of these styles, each under its own key in ' +
    `"bodies": ${keys}. Each is the same passage told another way, from the same evidence: never ` +
    'a body that refers to another style’s, or borrows its shape. Leave a key out only where its ' +
    'style says a body may be left out. Everything else in your system prompt still holds: ' +
    `${UNCHANGED} The lede and the headlines are shared by every style, so no style reshapes them.\n\n` +
    written
      .map(
        (style) =>
          `### ${style}\n${OVERVIEW_STYLE_TEXT[style] ?? 'What your system prompt says a body holds.'}`,
      )
      .join('\n\n')
  );
}

function singleStyle(style: OverviewStyle): string | null {
  const text = OVERVIEW_STYLE_TEXT[style];
  if (text === null) return null;
  const where =
    style === 'tldr'
      ? ''
      : ` Write each body under the key "${style}" in "bodies", in place of "narrative".`;
  return (
    `## Overview Style: ${style}\n` +
    'The engineer who ran this review chose what goes in the body of overviewSummary and of ' +
    `each chapter.${where} This replaces what your system prompt says a body holds. Everything ` +
    `else there still holds: ${UNCHANGED}\n\n${text}`
  );
}
