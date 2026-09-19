import { describe, expect, it } from 'vitest';
import type { JudgementCall, NarrativeChapter, NarrativeReview } from '@/review/narrative';
import { anchorJudgementCalls, judgementCallsByFile } from './judgement-calls';

const hunk = (id: string) => ({
  id,
  fileOrder: 0,
  original: { startLine: 1, lineCount: 1 },
  modified: { startLine: 1, lineCount: 1 },
});

/** A chapter showing each file for H0001 unless the entry names its hunks. */
function chapter(id: string, files: (string | [string, string[]])[]): NarrativeChapter {
  return {
    id,
    title: id.toUpperCase(),
    insights: [],
    diffChunks: files.map((entry) => {
      const [filename, hunkIds] = typeof entry === 'string' ? [entry, ['H0001']] : entry;
      return { filename, language: 'typescript', hunks: hunkIds.map(hunk) };
    }),
  };
}

function call(
  filename: string,
  title: string,
  hunkIds: [string, ...string[]] = ['H0001'],
): JudgementCall {
  return { title, text: `about ${filename}`, filename, hunkIds };
}

function review(chapters: NarrativeChapter[], judgementCalls: JudgementCall[]): NarrativeReview {
  return { prTitle: 't', overviewSummary: { lede: 's' }, chapters, judgementCalls };
}

describe('anchorJudgementCalls', () => {
  it('gives each call the chapter that cites its file', () => {
    const anchored = anchorJudgementCalls(
      review(
        [chapter('one', ['src/a.ts']), chapter('two', ['src/b.ts'])],
        [call('src/b.ts', 'about b'), call('src/a.ts', 'about a')],
      ),
    );
    expect(anchored).toEqual([
      { call: call('src/b.ts', 'about b'), chapterId: 'two' },
      { call: call('src/a.ts', 'about a'), chapterId: 'one' },
    ]);
  });

  it('gives a file two chapters both cite to the first of them, so it is asked once', () => {
    const anchored = anchorJudgementCalls(
      review(
        [chapter('one', ['src/a.ts']), chapter('two', ['src/a.ts'])],
        [call('src/a.ts', 'about a')],
      ),
    );
    expect(anchored.map((entry) => entry.chapterId)).toEqual(['one']);
  });

  it('gives a file two chapters show different hunks of to the one showing its lines', () => {
    const anchored = anchorJudgementCalls(
      review(
        [chapter('one', [['src/a.ts', ['H0001']]]), chapter('two', [['src/a.ts', ['H0002']]])],
        [call('src/a.ts', 'about the second hunk', ['H0002'])],
      ),
    );
    expect(anchored.map((entry) => entry.chapterId)).toEqual(['two']);
  });

  it('leaves out a call whose file no chapter shows, having nowhere to draw it', () => {
    const anchored = anchorJudgementCalls(
      review([chapter('one', ['src/a.ts'])], [call('src/gone.ts', 'about gone')]),
    );
    expect(anchored).toEqual([]);
  });

  it('is empty for a review that asked nothing', () => {
    const base = review([chapter('one', ['src/a.ts'])], []);
    expect(anchorJudgementCalls(base)).toEqual([]);
    expect(anchorJudgementCalls({ ...base, judgementCalls: undefined })).toEqual([]);
  });
});

describe('judgementCallsByFile', () => {
  const anchored = anchorJudgementCalls(
    review(
      [chapter('one', ['src/a.ts', 'src/b.ts']), chapter('two', ['src/c.ts'])],
      [call('src/a.ts', 'first on a'), call('src/c.ts', 'on c'), call('src/a.ts', 'second on a')],
    ),
  );

  it('collects the calls of one chapter under the file each sits on', () => {
    const byFile = judgementCallsByFile(anchored, 'one');
    expect(byFile.get('src/a.ts')?.map((c) => c.title)).toEqual(['first on a', 'second on a']);
    expect(byFile.has('src/c.ts')).toBe(false);
  });

  it('gives another chapter only its own', () => {
    expect([...judgementCallsByFile(anchored, 'two').keys()]).toEqual(['src/c.ts']);
  });

  it('is empty for a chapter that draws none', () => {
    expect(judgementCallsByFile(anchored, 'three').size).toBe(0);
  });
});
