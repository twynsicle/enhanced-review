/**
 * Inline script that runs in <head> BEFORE React hydrates and BEFORE the
 * first paint. Reads `er-layout` from localStorage and sets the
 * `--review-max-width` CSS variable on <html> accordingly. Default is
 * the narrow value — only flips to wide when the user has previously
 * chosen wide mode.
 *
 * Mirrors the ThemeInitScript pattern: must stay tiny and dependency-free
 * because it runs synchronously on the browser's main thread.
 */
const NARROW = '92rem';
const WIDE = '110rem';

const SCRIPT = `
  try {
    var w = localStorage.getItem('er-layout');
    document.documentElement.style.setProperty(
      '--review-max-width',
      w === 'wide' ? '${WIDE}' : '${NARROW}'
    );
  } catch (e) {
    document.documentElement.style.setProperty('--review-max-width', '${NARROW}');
  }
`;

export function LayoutWidthInitScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}

/** Exported so the menu toggle can apply the same values live. */
export const LAYOUT_WIDTHS = { narrow: NARROW, wide: WIDE } as const;
