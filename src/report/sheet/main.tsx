import '@/report/theme/theme.css';
import { MantineProvider } from '@mantine/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { colorSchemeManager } from '@/report/theme/color-scheme';
import { cssVariablesResolver } from '@/report/theme/css-variables';
import { theme } from '@/report/theme/theme';
import { readEmbeddedSheet, SHEET_ELEMENT_ID } from './sheet-data';
import { SheetPage } from './sheet-page';

const result = readEmbeddedSheet(document.getElementById(SHEET_ELEMENT_ID)?.textContent);

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <MantineProvider
      theme={theme}
      cssVariablesResolver={cssVariablesResolver}
      colorSchemeManager={colorSchemeManager}
      defaultColorScheme="dark"
    >
      <SheetPage result={result} />
    </MantineProvider>
  </StrictMode>,
);
