import '@/report/theme/theme.css';
import { MantineProvider } from '@mantine/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BUNDLE_ELEMENT_ID, readEmbeddedBundle } from '@/review/bundle-html';
import { followLayoutWidth } from '@/report/stores/layout-width';
import { followSidebarWidth } from '@/report/stores/sidebar-width';
import { colorSchemeManager } from '@/report/theme/color-scheme';
import { cssVariablesResolver } from '@/report/theme/css-variables';
import { theme } from '@/report/theme/theme';
import { ReportRoot } from './report-root';

// The stored geometry is painted before the first render, so the page opens
// at the width it was left at rather than moving to it.
followLayoutWidth();
followSidebarWidth();
const result = readEmbeddedBundle(document.getElementById(BUNDLE_ELEMENT_ID)?.textContent);

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <MantineProvider
      theme={theme}
      cssVariablesResolver={cssVariablesResolver}
      colorSchemeManager={colorSchemeManager}
      defaultColorScheme="dark"
    >
      <ReportRoot result={result} />
    </MantineProvider>
  </StrictMode>,
);
