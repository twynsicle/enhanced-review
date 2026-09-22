import { parseBundle, type BundleParseResult, type ReviewBundle } from './bundle.ts';

/**
 * How a `ReviewBundle` travels inside the report shell: as the text of one
 * `application/json` script element. The report's build leaves that element
 * empty; the local CLI's render stage and the report's dev server fill it, and
 * the page reads it back. Pure strings, so the page, the Vite config and the
 * CLI can all import it.
 */
export const BUNDLE_ELEMENT_ID = 'er-bundle';

const CLOSE = '</script>';
const OPEN = `<script id="${BUNDLE_ELEMENT_ID}" type="application/json">`;

/** The empty element as the report's `index.html` spells it. */
export const BUNDLE_PLACEHOLDER = `${OPEN}${CLOSE}`;

/**
 * JSON that cannot end its own element: every `<` is written as its JSON
 * unicode escape, so a changed file containing `</script>` or `<!--` stays
 * inside the string it belongs to. `JSON.parse` reads the escape back.
 */
const LESS_THAN_ESCAPE = '\\u003c';

export function serializeBundle(bundle: ReviewBundle): string {
  return JSON.stringify(bundle).replaceAll('<', LESS_THAN_ESCAPE);
}

/** Fills the placeholder, which must appear exactly once. */
export function injectBundle(html: string, bundle: ReviewBundle): string {
  const at = html.indexOf(BUNDLE_PLACEHOLDER);
  if (at === -1 || html.includes(BUNDLE_PLACEHOLDER, at + 1)) {
    throw new Error(`expected exactly one ${BUNDLE_PLACEHOLDER} in the report page`);
  }
  return (
    html.slice(0, at) +
    OPEN +
    serializeBundle(bundle) +
    CLOSE +
    html.slice(at + BUNDLE_PLACEHOLDER.length)
  );
}

export type EmbeddedBundleResult = BundleParseResult | { ok: false; reason: 'missing' };

/** Parses the element's text: empty is `missing`, anything else goes through `parseBundle`. */
export function readEmbeddedBundle(text: string | null | undefined): EmbeddedBundleResult {
  if (!text?.trim()) return { ok: false, reason: 'missing' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, reason: 'invalid', message: `not JSON: ${(error as Error).message}` };
  }
  return parseBundle(raw);
}
