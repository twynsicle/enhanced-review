import { MantineProvider } from '@mantine/core';
import { render as tlRender, type RenderOptions, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { colorSchemeManager } from '@/web/theme/color-scheme';
import { cssVariablesResolver } from '@/web/theme/css-variables';
import { theme } from '@/web/theme/theme';

function Providers({ children }: { children: ReactNode }) {
  return (
    <MantineProvider
      theme={theme}
      cssVariablesResolver={cssVariablesResolver}
      colorSchemeManager={colorSchemeManager}
      defaultColorScheme="dark"
    >
      {children}
    </MantineProvider>
  );
}

/** `@testing-library/react`'s render wrapped in the real Mantine provider. */
export function render(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>): RenderResult {
  return tlRender(ui, { wrapper: Providers, ...options });
}

export { screen, within, waitFor, fireEvent } from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';
