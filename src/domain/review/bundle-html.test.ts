import { describe, expect, it } from 'vitest';
import { BUNDLE_SCHEMA_VERSION, type ReviewBundle } from './bundle.ts';
import {
  BUNDLE_PLACEHOLDER,
  injectBundle,
  readEmbeddedBundle,
  serializeBundle,
} from './bundle-html.ts';

const HOSTILE = 'const a = "</script><script>alert(1)</script>"; // <!-- not a comment';

const bundle: ReviewBundle = {
  schemaVersion: BUNDLE_SCHEMA_VERSION,
  generatedAt: '2026-09-11T00:00:00.000Z',
  meta: {
    repo: 'acme/widgets',
    title: 'Escaping',
    prNumber: null,
    baseRefName: null,
    headRefName: null,
    authorLogin: null,
    description: null,
    stats: null,
  },
  review: { prTitle: 'Escaping', overviewSummary: { lede: 'x < y' }, chapters: [] },
  files: {
    'src/a.ts': { base: { kind: 'absent' }, head: { kind: 'content', content: HOSTILE } },
  },
};

const PAGE = `<html><body><div id="root"></div>${BUNDLE_PLACEHOLDER}</body></html>`;

/** What the browser hands the page: the element's text, which ends at the first `</script`. */
function elementText(html: string): string {
  const start = html.indexOf(BUNDLE_PLACEHOLDER.slice(0, -'</script>'.length));
  const open = html.indexOf('>', start) + 1;
  return html.slice(open, html.indexOf('</script', open));
}

describe('bundle in HTML', () => {
  it('never writes a raw < into the element', () => {
    expect(serializeBundle(bundle)).not.toContain('<');
  });

  it('round-trips a file that contains </script> and <!--', () => {
    const html = injectBundle(PAGE, bundle);
    const result = readEmbeddedBundle(elementText(html));
    expect(result.ok && result.bundle.files['src/a.ts']?.head).toEqual({
      kind: 'content',
      content: HOSTILE,
    });
    expect(html.endsWith('</body></html>')).toBe(true);
  });

  it('refuses a page without exactly one placeholder', () => {
    expect(() => injectBundle('<html></html>', bundle)).toThrow(/exactly one/);
    expect(() => injectBundle(PAGE + BUNDLE_PLACEHOLDER, bundle)).toThrow(/exactly one/);
  });

  it('reports an empty element as missing', () => {
    expect(readEmbeddedBundle('')).toEqual({ ok: false, reason: 'missing' });
    expect(readEmbeddedBundle(null)).toEqual({ ok: false, reason: 'missing' });
  });

  it('reports text that is not JSON as invalid', () => {
    expect(readEmbeddedBundle('{nope')).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('passes a different schema version through as a mismatch', () => {
    expect(readEmbeddedBundle(JSON.stringify({ schemaVersion: 99 }))).toEqual({
      ok: false,
      reason: 'version-mismatch',
      found: 99,
    });
  });
});
