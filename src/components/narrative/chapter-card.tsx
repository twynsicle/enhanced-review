import type { NarrativeChapter } from '@enhanced-review/review-types';
import { InlineDiffChunk } from './inline-diff-chunk';
import { InsightCallout } from './insight-callout';

interface ChapterCardProps {
  chapter: NarrativeChapter;
  /** 1-based index used for the chapter eyebrow ("Chapter Two · Refactor"). */
  chapterIndex: number;
  owner: string;
  repo: string;
  baseRef: string;
  headRef: string;
}

const ORDINALS = [
  'Zero',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
];

function chapterEyebrow(index: number): string {
  const ordinal = ORDINALS[index] ?? `#${index.toString()}`;
  return `Chapter ${ordinal}`;
}

export function ChapterCard({
  chapter,
  chapterIndex,
  owner,
  repo,
  baseRef,
  headRef,
}: ChapterCardProps) {
  const fileCount = chapter.diffChunks.length;
  const insightCount = chapter.insights.length;
  return (
    <article
      id={`chapter-${chapter.id}`}
      aria-labelledby={`chapter-heading-${chapter.id}`}
      className="flex flex-col gap-7"
    >
      <header className="flex flex-col gap-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-iris">
          {chapterEyebrow(chapterIndex)}
        </p>
        <h1
          id={`chapter-heading-${chapter.id}`}
          tabIndex={-1}
          className="font-serif text-[42px] font-semibold leading-[1.05] tracking-[-0.02em] outline-none"
        >
          {chapter.title}
        </h1>
        {chapter.description && chapter.description.trim().length > 0 && (
          <p className="max-w-[82ch] text-[15px] leading-[1.6] text-muted-foreground text-pretty">
            {chapter.description}
          </p>
        )}
        <p className="text-[13px] text-muted-foreground">
          {fileCount} file{fileCount === 1 ? '' : 's'} touched · {insightCount} insight
          {insightCount === 1 ? '' : 's'}
        </p>
      </header>

      {chapter.insights.length > 0 && (
        <div className="flex flex-col gap-3">
          {chapter.insights.map((insight, i) => (
            <InsightCallout key={i} insight={insight} />
          ))}
        </div>
      )}

      {chapter.diffChunks.map((chunk, i) => (
        <InlineDiffChunk
          key={`${chunk.filename}-${String(i)}`}
          chunk={chunk}
          owner={owner}
          repo={repo}
          baseRef={baseRef}
          headRef={headRef}
        />
      ))}
    </article>
  );
}
