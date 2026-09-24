import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { reviewerInstructions } from './reviewer-instructions.ts';

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'cli-test-instructions-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function file(bytes: Buffer): string {
  const name = path.join(root, 'instructions.txt');
  writeFileSync(name, bytes);
  return name;
}

const BOM_UTF8 = Buffer.from([0xef, 0xbb, 0xbf]);
const BOM_UTF16LE = Buffer.from([0xff, 0xfe]);

describe('reviewer instructions', () => {
  it('is null when neither flag is given', () => {
    expect(reviewerInstructions(undefined, undefined)).toBeNull();
  });

  it('takes the text as given, trimmed', () => {
    expect(reviewerInstructions('  Focus on retries.\n', undefined)).toBe('Focus on retries.');
  });

  it('refuses both flags at once, and empty text from either', () => {
    expect(() => reviewerInstructions('a', 'b')).toThrow(/cannot be combined/);
    expect(() => reviewerInstructions(' \n ', undefined)).toThrow(/^--instructions is empty$/);
    expect(() => reviewerInstructions(undefined, file(Buffer.from('\n')))).toThrow(
      /^--instructions-file is empty$/,
    );
  });

  it('reads UTF-8 with or without a byte-order mark', () => {
    const text = 'Look at the café’s retry path.\nSkip the CSS.';
    expect(reviewerInstructions(undefined, file(Buffer.from(text)))).toBe(text);
    expect(
      reviewerInstructions(undefined, file(Buffer.concat([BOM_UTF8, Buffer.from(text)]))),
    ).toBe(text);
  });

  it('reads the UTF-16 that Windows PowerShell writes by default', () => {
    const bytes = Buffer.concat([BOM_UTF16LE, Buffer.from('Focus on auth.\r\n', 'utf16le')]);
    expect(reviewerInstructions(undefined, file(bytes))).toBe('Focus on auth.');
  });

  it('refuses a file that is not text it can read, rather than passing on mojibake', () => {
    expect(() =>
      reviewerInstructions(undefined, file(Buffer.from([0x63, 0x61, 0x66, 0xe9]))),
    ).toThrow(/is not UTF-8 or UTF-16 text$/);
    expect(() => reviewerInstructions(undefined, path.join(root, 'missing.txt'))).toThrow(
      /^--instructions-file: ENOENT/,
    );
  });
});
