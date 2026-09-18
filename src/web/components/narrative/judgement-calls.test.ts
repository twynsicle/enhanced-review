import { describe, expect, it } from 'vitest';
import type { JudgementCall, NarrativeChapter, NarrativeReview } from '@/domain/review/narrative';
import { anchorJudgementCalls, judgementCallsByFile } from './judgement-calls';

function chapter(id: string, filenames: string[]): NarrativeChapter {
  return {
    id,
    title: id.toUpperCase(),
    insights: [],
    diffChunks: filenames.map((filename) => ({ filename, language: 'typescript', hunks: [] })),
  };
}

function call(filename: string, title: string): JudgementCall {
  return { title, text: `about ${filename}`, filename, hunkIds: ['H0001'] };
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
