import { describe, expect, it } from 'vitest';
import { importSpecifiers, isTestFile, listFiles, readSource, report } from './helpers';

/**
 * Guardrail — the Monaco the reader is typechecked against and the Monaco it
 * loads are two separate declarations, and nothing else compares them.
 *
 * `inline-diff-chunk.tsx` takes its `editor` types from the `monaco-editor`
 * devDependency; the runtime arrives over the network from the URL in
 * `monaco-cdn.ts`. Each moves on its own, and a property that changed shape
 * between the two versions fails in the diff panes at runtime with every other
 * check here already green — which is how the pair came to be a minor version
 * apart unnoticed.
 *
 * `monaco-editor` is pinned exactly rather than by range, because a range
 * would let an install satisfy it with a version the URL does not name and
 * leave this comparison none the wiser.
 */
const CDN = 'src/web/components/narrative/monaco-cdn.ts';

/** The only module allowed to pull the editor in, because it is the one that pins the URL. */
const CONFIGURES_THE_LOADER = 'src/web/components/narrative/inline-diff-chunk.tsx';

const MONACO_PACKAGES = /^@monaco-editor\/(react|loader)$/;

function readJson(file: string): { devDependencies?: Record<string, string>; version?: string } {
  return JSON.parse(readSource(file)) as {
    devDependencies?: Record<string, string>;
    version?: string;
  };
}

const declared = (): string => readJson('package.json').devDependencies?.['monaco-editor'] ?? '';
const installed = (): string => readJson('node_modules/monaco-editor/package.json').version ?? '';
const loaded = (): string => /\bMONACO_VERSION = '([^']+)'/.exec(readSource(CDN))?.[1] ?? '';

describe('guardrail: monaco version', () => {
  it('package.json pins monaco-editor exactly, so there is one version to agree with', () => {
    expect(declared()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('the version the reader loads is the version it is typechecked against', () => {
    const violations: string[] = [];
    if (loaded() !== declared()) {
      violations.push(
        `${CDN} loads ${loaded() || '(unreadable)'}, package.json declares ${declared() || '(absent)'}`,
      );
    }
    if (installed() !== declared()) {
      violations.push(
        `node_modules has ${installed() || '(absent)'}, package.json declares ${declared() || '(absent)'}`,
      );
    }
    expect(report(violations)).toBe('');
  });

  it('only the module that pins the URL may import the editor', () => {
    // An editor mounted from anywhere else would fall back to the version
    // baked into @monaco-editor/loader, which is the drift itself, arriving by
    // a second route and just as quietly.
    const violations = listFiles(['src/**/*.{ts,tsx}'])
      .filter((file) => !isTestFile(file) && file !== CONFIGURES_THE_LOADER)
      .filter((file) => importSpecifiers(readSource(file)).some((s) => MONACO_PACKAGES.test(s)));
    expect(report(violations)).toBe('');
  });
});
