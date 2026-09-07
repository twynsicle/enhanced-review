import type { CSSVariablesResolver } from '@mantine/core';
import {
  LAYOUT_WIDTHS,
  TOKEN_NAMES,
  darkTokens,
  lightTokens,
  tokenVar,
  type TokenMap,
} from './tokens';

/**
 * Emits every Editorial Iris token as `--er-<name>` for the active colour
 * scheme, and points the Mantine variables that drive component chrome at
 * the same tokens so `Paper`, `Text c="dimmed"`, inputs, borders and anchors
 * pick up the baseline colours without per-component overrides (D2).
 */
function schemeVariables(tokens: TokenMap): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const name of TOKEN_NAMES) vars[tokenVar(name)] = tokens[name];

  vars['--mantine-color-body'] = tokens.background;
  vars['--mantine-color-text'] = tokens.foreground;
  vars['--mantine-color-dimmed'] = tokens['muted-foreground'];
  vars['--mantine-color-placeholder'] = tokens.subtle;
  vars['--mantine-color-anchor'] = tokens.primary;
  vars['--mantine-color-default'] = tokens.card;
  vars['--mantine-color-default-hover'] = tokens.muted;
  vars['--mantine-color-default-color'] = tokens.foreground;
  vars['--mantine-color-default-border'] = tokens.border;
  vars['--mantine-color-error'] = tokens.destructive;
  return vars;
}

export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {
    '--review-max-width': LAYOUT_WIDTHS.narrow,
  },
  light: schemeVariables(lightTokens),
  dark: schemeVariables(darkTokens),
});
