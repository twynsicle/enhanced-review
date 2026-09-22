import { describe, expect, it } from 'vitest';
import { detectLanguage } from './language-map.ts';

describe('detectLanguage', () => {
  it('detects TypeScript for .ts and .tsx', () => {
    expect(detectLanguage('src/main.ts')).toBe('typescript');
    expect(detectLanguage('App.tsx')).toBe('typescript');
  });

  it('detects JavaScript for .js, .jsx, .mjs, .cjs', () => {
    expect(detectLanguage('index.js')).toBe('javascript');
    expect(detectLanguage('App.jsx')).toBe('javascript');
    expect(detectLanguage('config.mjs')).toBe('javascript');
    expect(detectLanguage('config.cjs')).toBe('javascript');
  });

  it('detects common languages from extension', () => {
    expect(detectLanguage('script.py')).toBe('python');
    expect(detectLanguage('main.rs')).toBe('rust');
    expect(detectLanguage('server.go')).toBe('go');
    expect(detectLanguage('Main.java')).toBe('java');
    expect(detectLanguage('package.json')).toBe('json');
    expect(detectLanguage('README.md')).toBe('markdown');
    expect(detectLanguage('styles.css')).toBe('css');
  });

  it('is case insensitive for extensions', () => {
    expect(detectLanguage('file.TS')).toBe('typescript');
    expect(detectLanguage('file.PY')).toBe('python');
  });

  it('detects dockerfile by filename (case insensitive)', () => {
    expect(detectLanguage('Dockerfile')).toBe('dockerfile');
    expect(detectLanguage('subdir/dockerfile')).toBe('dockerfile');
  });

  it('detects makefile by filename', () => {
    expect(detectLanguage('Makefile')).toBe('shell');
  });

  it('returns plaintext for unknown extensions and bare names', () => {
    expect(detectLanguage('file.xyz')).toBe('plaintext');
    expect(detectLanguage('LICENSE')).toBe('plaintext');
  });

  it('uses the last extension for double extensions like .test.ts', () => {
    expect(detectLanguage('utils.test.ts')).toBe('typescript');
  });

  it('handles deep paths', () => {
    expect(detectLanguage('src/renderer/components/App.tsx')).toBe('typescript');
  });

  it('treats a leading-dot file as having no extension', () => {
    expect(detectLanguage('.gitignore')).toBe('plaintext');
  });

  it('does not treat inherited object properties as extensions', () => {
    expect(detectLanguage('file.constructor')).toBe('plaintext');
    expect(detectLanguage('toString')).toBe('plaintext');
  });
});
