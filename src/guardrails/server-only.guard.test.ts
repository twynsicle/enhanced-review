import { describe, expect, it } from 'vitest';
import { importSpecifiers, isTestFile, listFiles, readSource, report } from './helpers';

/**
 * Guardrail — `*.server.ts` modules never end up in a client bundle.
 * They may be imported only from other `.server` modules, route modules,
 * `root.tsx` / `entry.server.tsx`, `server/`, `src/jobs/`, non-web areas
 * (which are server-only by construction) and tests.
 */
function mayImportServerOnly(relPath: string): boolean {
  return (
    /\.server\.[jt]sx?$/.test(relPath) ||
    relPath === 'src/web/root.tsx' ||
    relPath === 'src/web/entry.server.tsx' ||
    relPath.startsWith('src/web/routes/') ||
    relPath.startsWith('server/') ||
    !relPath.startsWith('src/web/') ||
    isTestFile(relPath)
  );
}

describe('guardrail: server-only modules', () => {
  it('.server modules are not imported from browser-bound files', () => {
    const violations: string[] = [];
    for (const file of listFiles(['src/**/*.{ts,tsx}', 'server/**/*.ts'])) {
      if (mayImportServerOnly(file)) continue;
      for (const spec of importSpecifiers(readSource(file))) {
        if (/\.server(\.[jt]sx?)?$/.test(spec)) {
          violations.push(`${file} imports ${spec}`);
        }
      }
    }
    expect(report(violations)).toBe('');
  });
});
