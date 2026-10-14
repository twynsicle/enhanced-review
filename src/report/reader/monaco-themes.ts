import type { editor } from 'monaco-editor';
import type { DimComments } from '@/report/stores/dim-comments';

/**
 * The code viewers' themes: Monaco's own `vs` and `vs-dark`, and a dimmed
 * twin of each that marks every comment so the page's CSS can fade it.
 *
 * Faded by opacity rather than recoloured. A comment painted one fixed grey
 * reads against the editor's background and nowhere else: on an added or
 * removed line's band it is grey on green or red, which is harder to read than
 * the comment it replaced and clashes with the band besides. Opacity lets the
 * comment keep its own colour and fall back into whatever is behind it, band
 * or background, the way a skim line does.
 *
 * Monaco has no opacity for a token and drops a colour's alpha, and its
 * colour classes are numbered at runtime, so the theme cannot fade a comment
 * itself or name it for CSS by colour. What it can do is give it a font style,
 * which arrives as fixed classes: italic, underline and strikethrough together
 * (`mtki mtku mtks`), which no base theme gives any token, so `theme.css` can
 * find a comment by them, cancel the lines and fade it. No `foreground`, so
 * each scope keeps the colour its base theme gives it.
 *
 * A theme rather than CSS alone because a comment is known only by the
 * tokenizer's classes, which only a theme rule reaches. Monaco themes are
 * global, so one `setTheme` restyles every editor on the page in place, the
 * stacked view's removed lines included.
 */
export type EditorScheme = 'light' | 'dark';

const BASE_THEME: Record<EditorScheme, editor.BuiltinTheme> = { light: 'vs', dark: 'vs-dark' };

export const DIMMED_THEME: Record<EditorScheme, string> = {
  light: 'er-vs-dimmed',
  dark: 'er-vs-dark-dimmed',
};

/** The font style that marks a comment for `theme.css` to fade. */
export const DIMMED_COMMENT_STYLE = 'italic underline strikethrough';

/**
 * A rule for `comment` already reaches `comment.doc.ts` and the rest, but the
 * most specific rule wins, so a sub-scope a base theme styles on its own
 * would keep that style. Naming the ones Monaco's tokenizers emit holds them.
 */
export const COMMENT_SCOPES = ['comment', 'comment.doc', 'comment.block', 'comment.content'];

export function dimmedThemeData(scheme: EditorScheme): editor.IStandaloneThemeData {
  return {
    base: BASE_THEME[scheme],
    inherit: true,
    rules: COMMENT_SCOPES.map((token) => ({ token, fontStyle: DIMMED_COMMENT_STYLE })),
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
