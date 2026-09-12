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
      /*
       * Mantine's `Transition` renders through React's `<Activity>`, which
       * keeps a closed overlay's nodes in the DOM but out of the accessibility
       * tree — so a just-opened menu or modal is findable by `querySelector`
       * and invisible to `getByRole`, which is the query that matters. `test`
       * drops the transition and mounts the content outright.
       */
      env="test"
    >
      {children}
    </MantineProvider>
  );
}

/** `@testing-library/react`'s render wrapped in the real Mantine provider. */
export function render(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>): RenderResult {
  return tlRender(ui, { wrapper: Providers, ...options });
}

export { act, screen, within, waitFor, fireEvent } from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';
