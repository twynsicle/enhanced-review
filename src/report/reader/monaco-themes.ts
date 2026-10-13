import type { editor } from 'monaco-editor';
import type { DimComments } from '@/report/stores/dim-comments';
import { oklchToHex } from '@/report/theme/oklch';
import { darkTokens, lightTokens } from '@/report/theme/tokens';

/**
 * The code viewers' themes: Monaco's own `vs` and `vs-dark`, and a dimmed
 * twin of each that paints comments italic in the `subtle` token faded most
 * of the way into the editor's background — still taking their lines, so the
 * code keeps its shape, but too faint to read without meaning to.
 *
 * `subtle` is decoration and never text by the design rules. A comment the
 * reader has asked to push back is decoration by their choice, which is why
 * it may carry one here and nowhere else.
 *
 * Faded by mixing rather than by alpha: Monaco reads a token colour's six hex
 * digits and drops any alpha after them.
 *
 * A theme rather than CSS because a comment's colour comes from the
 * tokenizer's classes, which only a theme rule can reach. Monaco themes are
 * global, so one `setTheme` restyles every editor on the page in place.
 */
export type EditorScheme = 'light' | 'dark';

const BASE_THEME: Record<EditorScheme, editor.BuiltinTheme> = { light: 'vs', dark: 'vs-dark' };

/** The background each base theme paints the editor, which the comments fade into. */
const BASE_BACKGROUND: Record<EditorScheme, string> = { light: 'fffffe', dark: '1e1e1e' };

/** How much of `subtle` survives over the background. */
export const COMMENT_STRENGTH = 0.3;

/** `amount` of `top` over `bottom`, both six hex digits, per sRGB channel. */
export function mixHex(top: string, bottom: string, amount: number): string {
  return [0, 2, 4]
    .map((at) => {
      const over = Number.parseInt(top.slice(at, at + 2), 16);
      const under = Number.parseInt(bottom.slice(at, at + 2), 16);
      return Math.round(under + (over - under) * amount)
        .toString(16)
        .padStart(2, '0');
    })
    .join('');
}

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
  const subtle = oklchToHex((scheme === 'dark' ? darkTokens : lightTokens).subtle);
  const foreground = mixHex(subtle, BASE_BACKGROUND[scheme], COMMENT_STRENGTH);
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
