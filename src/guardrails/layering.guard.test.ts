import { describe, expect, it } from 'vitest';
import {
  type Area,
  areaOf,
  importSpecifiers,
  isTestFile,
  listFiles,
  readSource,
  report,
  resolveProjectImport,
} from './helpers';

/**
 * Guardrail A4(a) — layering.
 *
 *   web    → web, domain, db, common, config
 *   domain → domain, db, common, config
 *   db     → db, common, config
 *   jobs   → jobs, domain, db, common, config
 *   common → common, config
 *   config → config
 *
 * Inside `web`, only server-side modules (route modules, root.tsx,
 * entry.server.tsx, `*.server.ts`) may reach into domain/db/config or the
 * logger: everything else in `web` ships to the browser, and React Router
 * only strips server code from route-module exports.
 *
 * React and React Router are UI concerns: nothing outside `src/web` and
 * `server/` may import them.
 */
const ALLOWED: Record<Exclude<Area, 'guardrails' | 'test'>, Area[]> = {
  web: ['web', 'domain', 'db', 'common', 'config'],
  domain: ['domain', 'db', 'common', 'config'],
  db: ['db', 'common', 'config'],
  jobs: ['jobs', 'domain', 'db', 'common', 'config'],
  common: ['common', 'config'],
  config: ['config'],
};

const SERVER_ONLY_AREAS: Area[] = ['domain', 'db', 'config'];
const UI_PACKAGES = /^(react|react-dom|react-router|@react-router\/|@mantine\/|@tabler\/)/;

function isWebServerModule(relPath: string): boolean {
  return (
    /\.server\.[jt]sx?$/.test(relPath) ||
    relPath === 'src/web/root.tsx' ||
    relPath === 'src/web/entry.server.tsx' ||
    relPath.startsWith('src/web/routes/')
  );
}

describe('guardrail: layering', () => {
  const files = listFiles(['src/**/*.{ts,tsx}']).filter((f) => !isTestFile(f));

  it('areas only import from the layers below them', () => {
    const violations: string[] = [];
    for (const file of files) {
      const area = areaOf(file);
      if (!area || area === 'guardrails' || area === 'test') continue;
      const allowed = ALLOWED[area];
      for (const spec of importSpecifiers(readSource(file))) {
        const target = resolveProjectImport(spec, file);
        if (!target) continue;
        const targetArea = areaOf(`${target}/`) ?? areaOf(target);
        if (!targetArea) continue;
        if (!allowed.includes(targetArea)) {
          violations.push(`${file} imports ${spec} (${area} → ${targetArea} is not allowed)`);
        }
      }
    }
    expect(report(violations)).toBe('');
  });

  it('browser-bound web modules do not import server-only code', () => {
    const violations: string[] = [];
    for (const file of files) {
      if (areaOf(file) !== 'web' || isWebServerModule(file)) continue;
      for (const spec of importSpecifiers(readSource(file))) {
        const target = resolveProjectImport(spec, file);
        if (!target) continue;
        const targetArea = areaOf(`${target}/`);
        if (
          (targetArea && SERVER_ONLY_AREAS.includes(targetArea)) ||
          target === 'src/common/logger' ||
          target.endsWith('.server')
        ) {
          violations.push(`${file} imports ${spec} (client-bundled web module → server-only code)`);
        }
      }
    }
    expect(report(violations)).toBe('');
  });

  it('only src/web and server/ import React or React Router', () => {
    const violations: string[] = [];
    for (const file of files) {
      if (file.startsWith('src/web/')) continue;
      for (const spec of importSpecifiers(readSource(file))) {
        if (UI_PACKAGES.test(spec)) violations.push(`${file} imports ${spec}`);
      }
    }
    expect(report(violations)).toBe('');
  });
});
