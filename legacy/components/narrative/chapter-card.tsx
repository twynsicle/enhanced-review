import type { NarrativeChapter } from '@enhanced-review/review-types';
import { InlineDiffChunk } from './inline-diff-chunk';
import { InsightCallout } from './insight-callout';
import { LeadMarkdown } from './lead-markdown';

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
        <p className="text-[13px] text-muted-foreground">
          {fileCount} file{fileCount === 1 ? '' : 's'} touched · {insightCount} insight
          {insightCount === 1 ? '' : 's'}
        </p>
      </header>

      {chapter.description && chapter.description.trim().length > 0 && (
        <LeadMarkdown text={chapter.description} size={18} />
      )}

      {chapter.insights.length > 0 && (
        <section className="flex flex-col gap-4">
          <header className="flex items-baseline justify-between border-b border-border pb-2">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-subtle">
              Insights
            </span>
            <span className="font-mono text-[11px] text-subtle">{insightCount}</span>
          </header>
          <div className="grid gap-4 md:grid-cols-2">
            {chapter.insights.map((insight, i) => (
              <InsightCallout key={i} insight={insight} />
            ))}
          </div>
        </section>
      )}

      {chapter.diffChunks.length > 0 && (
        <section className="flex flex-col gap-5">
          <header className="flex items-baseline justify-between border-b border-border pb-2">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-subtle">
              Files in this chapter
            </span>
            <span className="font-mono text-[11px] text-subtle">{fileCount}</span>
          </header>
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
        </section>
      )}
    </article>
  );
}
