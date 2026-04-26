import type { NarrativeChapter } from '@enhanced-review/review-types';
import { InlineDiffChunk } from './inline-diff-chunk';
import { InsightCallout } from './insight-callout';

interface ChapterCardProps {
  chapter: NarrativeChapter;
  owner: string;
  repo: string;
  baseRef: string;
  headRef: string;
}

export function ChapterCard({ chapter, owner, repo, baseRef, headRef }: ChapterCardProps) {
  return (
    <article
      id={`chapter-${chapter.id}`}
      aria-labelledby={`chapter-heading-${chapter.id}`}
      className="flex flex-col gap-5"
    >
      <h2
        id={`chapter-heading-${chapter.id}`}
        tabIndex={-1}
        className="text-xl font-semibold leading-tight outline-none"
      >
        {chapter.title}
      </h2>

      {chapter.insights.length > 0 && (
        <div className="flex flex-col gap-2">
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
