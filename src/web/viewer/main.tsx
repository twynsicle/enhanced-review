import '@/web/theme/theme.css';
import { MantineProvider } from '@mantine/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createHashRouter, RouterProvider } from 'react-router';
import { BUNDLE_ELEMENT_ID, readEmbeddedBundle } from '@/domain/review/bundle-html';
import { colorSchemeManager } from '@/web/theme/color-scheme';
import { cssVariablesResolver } from '@/web/theme/css-variables';
import { theme } from '@/web/theme/theme';
import { ViewerPage } from './viewer-page';

// Entry point of the local report (docs/local-mode, A5). Client-rendered
// only, so there is no hydration and no pre-paint script: MantineProvider
// applies the stored scheme in a layout effect before anything paints. The
// hash data router gives the reader `?ch=` / `?file=` from a file:// URL, and
// is a data router because the diff always mounts a fetcher.
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
