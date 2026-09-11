import '@/web/theme/theme.css';
import { MantineProvider } from '@mantine/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createHashRouter, RouterProvider } from 'react-router';
import { BUNDLE_SCHEMA_VERSION, type ReviewBundle } from '@/domain/review/bundle';
import { EmbeddedFileSource } from '@/web/components/narrative/file-source';
import { InlineDiffChunk } from '@/web/components/narrative/inline-diff-chunk';
import { colorSchemeManager } from '@/web/theme/color-scheme';
import { cssVariablesResolver } from '@/web/theme/css-variables';
import { theme } from '@/web/theme/theme';

// Phase 2, commit 1: the smallest page that proves Monaco renders a diff from
// a file opened off disk. Replaced by the real report page in later commits.
const BASE = ['export function greet(name) {', "  return 'Hello ' + name;", '}', ''].join('\n');
const HEAD = [
  'export function greet(name: string): string {',
  '  return `Hello, ${name}!`;',
  '}',
  '',
].join('\n');

const PROOF: ReviewBundle = {
  schemaVersion: BUNDLE_SCHEMA_VERSION,
  generatedAt: '2026-09-11T00:00:00.000Z',
  meta: {
    repo: 'acme/widgets',
    title: 'Proof',
    prNumber: null,
    baseRefName: null,
    headRefName: null,
    authorLogin: null,
    description: null,
    stats: null,
  },
  review: { prTitle: 'Proof', overviewSummary: '', chapters: [] },
  files: {
    'src/greet.ts': {
      base: { kind: 'content', content: BASE },
      head: { kind: 'content', content: HEAD },
    },
  },
};

function ProofPage() {
  return (
    <EmbeddedFileSource bundle={PROOF}>
      <div style={{ padding: 32 }}>
        <InlineDiffChunk
          chunk={{
            filename: 'src/greet.ts',
            language: 'typescript',
            hunks: [
              {
                id: 'H0001',
                fileOrder: 0,
                original: { startLine: 1, lineCount: 3 },
                modified: { startLine: 1, lineCount: 3 },
              },
            ],
          }}
        />
      </div>
    </EmbeddedFileSource>
  );
}

const router = createHashRouter([{ path: '/', element: <ProofPage /> }]);

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
