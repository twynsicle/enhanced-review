import type { editor } from 'monaco-editor';
import type { DimComments } from '@/report/stores/dim-comments';
import { oklchToHex } from '@/report/theme/oklch';
import { darkTokens, lightTokens } from '@/report/theme/tokens';

/**
 * The code viewers' themes: Monaco's own `vs` and `vs-dark`, and a dimmed
 * twin of each that paints comments in the `subtle` token, italic.
 *
 * `subtle` is decoration and never text by the design rules. A comment the
 * reader has asked to push back is decoration by their choice, which is why
 * it may carry one here and nowhere else.
 *
 * A theme rather than CSS because a comment's colour comes from the
 * tokenizer's classes, which only a theme rule can reach. Monaco themes are
 * global, so one `setTheme` restyles every editor on the page in place.
 */
export type EditorScheme = 'light' | 'dark';

const BASE_THEME: Record<EditorScheme, editor.BuiltinTheme> = { light: 'vs', dark: 'vs-dark' };

export const DIMMED_THEME: Record<EditorScheme, string> = {
  light: 'er-vs-dimmed',
  dark: 'er-vs-dark-dimmed',
};

/**
 * A rule for `comment` already reaches `comment.doc.ts` and the rest, but the
 * most specific rule wins, so a sub-scope a base theme colours on its own
 * would keep that colour. Naming the ones Monaco's tokenizers emit holds them.
 */
export const COMMENT_SCOPES = ['comment', 'comment.doc', 'comment.block', 'comment.content'];

export function dimmedThemeData(scheme: EditorScheme): editor.IStandaloneThemeData {
  const foreground = oklchToHex((scheme === 'dark' ? darkTokens : lightTokens).subtle);
  return {
    base: BASE_THEME[scheme],
    inherit: true,
    rules: COMMENT_SCOPES.map((token) => ({ token, foreground, fontStyle: 'italic' })),
    colors: {},
  };
}

/** Registered once, before either editor mounts, so a theme prop never names one Monaco lacks. */
export function defineEditorThemes(monaco: {
  editor: { defineTheme: (name: string, data: editor.IStandaloneThemeData) => void };
}): void {
  for (const scheme of ['light', 'dark'] as const) {
    monaco.editor.defineTheme(DIMMED_THEME[scheme], dimmedThemeData(scheme));
  }
}

export function editorTheme(scheme: EditorScheme, comments: DimComments): string {
  return comments === 'dimmed' ? DIMMED_THEME[scheme] : BASE_THEME[scheme];
}
