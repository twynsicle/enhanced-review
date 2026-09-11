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
 *   cli    → cli, domain, common, config   (and see cli-imports)
 *   common → common, config
 *   config → config
 *
 * `db` and `config` are server-only. `domain` is shared between server and
 * browser: a domain module that reaches server-only code — db, config, the
 * logger, a `node:` builtin, a server-only package or a `.server` module —
 * must itself be named `*.server.ts`.
 *
 * Inside `web`, only server-side modules (route modules, root.tsx,
 * entry.server.tsx, `*.server.ts`) may reach into db/config, the logger or
 * `.server` modules: everything else in `web` ships to the browser, and React
 * Router only strips server code from route-module exports.
 *
 * React and React Router are UI concerns: nothing outside `src/web` and
 * `server/` may import them.
 */
const ALLOWED: Record<Exclude<Area, 'guardrails' | 'test'>, Area[]> = {
  web: ['web', 'domain', 'db', 'common', 'config'],
  domain: ['domain', 'db', 'common', 'config'],
  db: ['db', 'common', 'config'],
  jobs: ['jobs', 'domain', 'db', 'common', 'config'],
  cli: ['cli', 'domain', 'common', 'config'],
  common: ['common', 'config'],
  config: ['config'],
};

const SERVER_ONLY_AREAS: Area[] = ['db', 'config'];
const UI_PACKAGES = /^(react|react-dom|react-router|@react-router\/|@mantine\/|@tabler\/)/;
// Packages that only make sense on the server; importing one makes a module server-only.
const SERVER_PACKAGES = /^(@octokit\/|@anthropic-ai\/claude-agent-sdk|@prisma\/|pg$|pino)/;
const NODE_BUILTINS = new Set([
  'assert',
  'buffer',
  'child_process',
  'crypto',
  'events',
  'fs',
  'http',
  'https',
  'net',
  'os',
  'path',
  'process',
  'readline',
  'stream',
  'timers',
  'url',
  'util',
  'worker_threads',
  'zlib',
]);

function isServerModule(relPath: string): boolean {
  return /\.server\.[jt]sx?$/.test(relPath);
}

function isWebServerModule(relPath: string): boolean {
  return (
    isServerModule(relPath) ||
    relPath === 'src/web/root.tsx' ||
    relPath === 'src/web/entry.server.tsx' ||
    relPath.startsWith('src/web/routes/')
  );
}

/** Why importing `spec` from `file` makes the importer server-only, or null. */
function serverOnlyReason(spec: string, file: string): string | null {
  const target = resolveProjectImport(spec, file);
  if (target) {
    const targetArea = areaOf(`${target}/`) ?? areaOf(target);
    if (targetArea && SERVER_ONLY_AREAS.includes(targetArea)) return `${targetArea} is server-only`;
    if (target === 'src/common/logger') return 'the logger is server-only';
    if (target.endsWith('.server')) return 'a .server module';
    return null;
  }
  if (spec.startsWith('node:') || NODE_BUILTINS.has(spec.split('/')[0] ?? spec)) {
    return 'a Node builtin';
  }
  if (SERVER_PACKAGES.test(spec)) return 'a server-only package';
  return null;
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

  it('domain modules that reach server-only code are named .server', () => {
    const violations: string[] = [];
    for (const file of files) {
      if (areaOf(file) !== 'domain' || isServerModule(file)) continue;
      for (const spec of importSpecifiers(readSource(file))) {
        const reason = serverOnlyReason(spec, file);
        if (reason) {
          violations.push(`${file} imports ${spec} (${reason}) — rename it *.server.ts`);
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
        const reason = serverOnlyReason(spec, file);
        if (reason) {
          violations.push(`${file} imports ${spec} (client-bundled web module → ${reason})`);
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
