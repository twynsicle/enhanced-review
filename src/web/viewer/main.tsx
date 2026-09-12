import '@/web/theme/theme.css';
import { MantineProvider } from '@mantine/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createHashRouter, RouterProvider } from 'react-router';
import { BUNDLE_ELEMENT_ID, readEmbeddedBundle } from '@/domain/review/bundle-html';
import { bindLayoutWidth } from '@/web/stores/layout-width';
import { bindSidebarWidth } from '@/web/stores/sidebar-width';
import { colorSchemeManager } from '@/web/theme/color-scheme';
import { cssVariablesResolver } from '@/web/theme/css-variables';
import { theme } from '@/web/theme/theme';
import { ViewerPage } from './viewer-page';

// Entry point of the local report. Client-rendered
// only, so there is no hydration and no pre-paint script: MantineProvider
// applies the stored scheme in a layout effect, and the stored geometry is
// applied here, before the first render. The hash data router gives the
// reader `?ch=` / `?file=` from a file:// URL, and is a data router because
// the diff always mounts a fetcher.
bindLayoutWidth();
bindSidebarWidth();
const result = readEmbeddedBundle(document.getElementById(BUNDLE_ELEMENT_ID)?.textContent);

const router = createHashRouter([{ path: '*', element: <ViewerPage result={result} /> }]);

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <MantineProvider
      theme={theme}
      cssVariablesResolver={cssVariablesResolver}
      colorSchemeManager={colorSchemeManager}
      defaultColorScheme="dark"
    >
      <RouterProvider router={router} />
    </MantineProvider>
  </StrictMode>,
);
