import { describe, expect, it } from 'vitest';
import { filePair, parseBundle } from '@/domain/review/bundle';
import { SAMPLE_BUNDLE, SAMPLE_MISSING_FILE } from './sample-bundle';

const chunks = SAMPLE_BUNDLE.review.chapters.flatMap((chapter) => chapter.diffChunks);

describe('the sample report bundle', () => {
  it('parses as a current bundle', () => {
    const result = parseBundle(JSON.parse(JSON.stringify(SAMPLE_BUNDLE)));
    expect(result.ok ? 'ok' : result).toBe('ok');
  });

  it('embeds every chunk file except the one left out on purpose', () => {
    const missing = chunks
      .map((chunk) => chunk.filename)
      .filter((filename) => !(filename in SAMPLE_BUNDLE.files));
    expect(missing).toEqual([SAMPLE_MISSING_FILE]);
  });

  it('keeps every hunk inside the file it points at', () => {
    const overruns: string[] = [];
    for (const chunk of chunks) {
      const { base, head } = filePair(SAMPLE_BUNDLE, chunk.filename);
      for (const { id, original, modified } of chunk.hunks) {
        if (base.ok && original.startLine + original.lineCount - 1 > base.data.lineCount) {
          overruns.push(`${id} original`);
        }
        if (head.ok && modified.startLine + modified.lineCount - 1 > head.data.lineCount) {
          overruns.push(`${id} modified`);
        }
      }
    }
    expect(overruns).toEqual([]);
  });

  it('covers every file-side state the reader draws', () => {
    const kinds = Object.values(SAMPLE_BUNDLE.files).flatMap((f) => [f.base.kind, f.head.kind]);
    expect(new Set(kinds)).toEqual(new Set(['content', 'absent', 'too-large']));
  });
});
