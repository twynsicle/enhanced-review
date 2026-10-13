import { describe, expect, it, vi } from 'vitest';
import { oklchToHex } from '@/report/theme/oklch';
import { darkTokens, lightTokens } from '@/report/theme/tokens';
import {
  COMMENT_SCOPES,
  COMMENT_STRENGTH,
  defineEditorThemes,
  DIMMED_THEME,
  dimmedThemeData,
  editorTheme,
  mixHex,
} from './monaco-themes';

describe('the code viewers’ themes', () => {
  it.each([
    ['light', 'vs', lightTokens.subtle, 'fffffe'],
    ['dark', 'vs-dark', darkTokens.subtle, '1e1e1e'],
  ] as const)(
    '%s: the dimmed theme inherits %s and paints every comment scope italic, subtle faded into the background',
    (scheme, base, subtle, background) => {
      const data = dimmedThemeData(scheme);
      expect(data.base).toBe(base);
      expect(data.inherit).toBe(true);
      expect(COMMENT_SCOPES).toEqual(
        expect.arrayContaining(['comment', 'comment.doc', 'comment.block']),
      );
      expect(data.rules).toEqual(
        COMMENT_SCOPES.map((token) => ({
          token,
          foreground: mixHex(oklchToHex(subtle), background, COMMENT_STRENGTH),
          fontStyle: 'italic',
        })),
      );
      expect(data.rules[0]!.foreground).toMatch(/^[0-9a-f]{6}$/);
    },
  );

  it('holds a different subtle in each scheme, as the tokens do', () => {
    expect(dimmedThemeData('light').rules[0]!.foreground).not.toBe(
      dimmedThemeData('dark').rules[0]!.foreground,
    );
  });

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

describe('mixHex', () => {
  it('lands on either end at 0 and 1, and between them per channel', () => {
    expect(mixHex('ff8000', '000000', 1)).toBe('ff8000');
    expect(mixHex('ff8000', '000000', 0)).toBe('000000');
    expect(mixHex('ff8000', '204060', 0.5)).toBe('906030');
  });
});

describe('oklchToHex', () => {
  it('converts the ends of the lightness axis exactly', () => {
    expect(oklchToHex('oklch(1 0 0)')).toBe('ffffff');
    expect(oklchToHex('oklch(0 0 0)')).toBe('000000');
  });

  it('lands a grey on three equal channels', () => {
    const hex = oklchToHex('oklch(0.6 0 0)');
    expect(hex.slice(0, 2)).toBe(hex.slice(2, 4));
    expect(hex.slice(2, 4)).toBe(hex.slice(4, 6));
  });
});
