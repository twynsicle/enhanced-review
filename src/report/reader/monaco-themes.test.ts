import { describe, expect, it, vi } from 'vitest';
import {
  COMMENT_SCOPES,
  defineEditorThemes,
  DIMMED_COMMENT_STYLE,
  DIMMED_THEME,
  dimmedThemeData,
  editorTheme,
} from './monaco-themes';

describe('the code viewers’ themes', () => {
  it.each([
    ['light', 'vs'],
    ['dark', 'vs-dark'],
  ] as const)(
    '%s: the dimmed theme inherits %s and marks every comment scope, keeping its colour',
    (scheme, base) => {
      const data = dimmedThemeData(scheme);
      expect(data.base).toBe(base);
      expect(data.inherit).toBe(true);
      expect(COMMENT_SCOPES).toEqual(
        expect.arrayContaining(['comment', 'comment.doc', 'comment.block']),
      );
      expect(data.rules).toEqual(
        COMMENT_SCOPES.map((token) => ({ token, fontStyle: DIMMED_COMMENT_STYLE })),
      );
    },
  );

  it('registers both dimmed themes with Monaco', () => {
    const defineTheme = vi.fn();
    defineEditorThemes({ editor: { defineTheme } });
    expect(defineTheme).toHaveBeenCalledWith(DIMMED_THEME.light, dimmedThemeData('light'));
    expect(defineTheme).toHaveBeenCalledWith(DIMMED_THEME.dark, dimmedThemeData('dark'));
  });

  it('picks Monaco’s own theme unless comments are dimmed', () => {
    expect(editorTheme('light', 'normal')).toBe('vs');
    expect(editorTheme('dark', 'normal')).toBe('vs-dark');
    expect(editorTheme('light', 'dimmed')).toBe(DIMMED_THEME.light);
    expect(editorTheme('dark', 'dimmed')).toBe(DIMMED_THEME.dark);
  });
});
