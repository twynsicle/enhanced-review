'use client';

import type { DiffChunk, NarrativeChapter, ReviewFile } from '@enhanced-review/review-types';
import { InlineDiffChunk } from './inline-diff-chunk';

interface FileViewProps {
  filename: string;
  chapters: readonly NarrativeChapter[];
  files?: readonly ReviewFile[];
  owner: string;
  repo: string;
  baseRef: string;
  headRef: string;
}

/**
 * File-only view: shows the diff for a single file, independent of the
 * narrative structure. A file may be discussed by zero, one, or multiple
 * chapters; we render every diffChunk that targets this filename so the
 * reader sees the full diff context the AI selected.
 *
 * Falls back to a "no diff" message when the file is listed in the
 * review's `files[]` array but has no chunk in any chapter (rare —
 * usually means the AI didn't select any hunks for it).
 */
export function FileView({
  filename,
  chapters,
  files,
  owner,
  repo,
  baseRef,
  headRef,
}: FileViewProps) {
  const chunks: { chunk: DiffChunk; chapter: NarrativeChapter }[] = [];
  for (const chapter of chapters) {
    for (const chunk of chapter.diffChunks) {
      if (chunk.filename === filename) {
        chunks.push({ chunk, chapter });
      }
    }
  }

  const fileMeta = files?.find((f) => f.filename === filename) ?? null;
  const slash = filename.lastIndexOf('/');
  const basename = slash === -1 ? filename : filename.slice(slash + 1);
  const dirname = slash === -1 ? '' : filename.slice(0, slash);
  const hasStats = fileMeta && (fileMeta.additions > 0 || fileMeta.deletions > 0);

  return (
    <article id={`file-${filename}`} className="flex flex-col gap-7">
      <header className="flex flex-col gap-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-iris">File</p>
        <h1
          tabIndex={-1}
          className="font-mono text-[28px] font-semibold leading-[1.15] tracking-[-0.01em] outline-none break-all"
        >
          {dirname.length > 0 && (
            <span className="text-[18px] font-medium text-subtle">{dirname}/</span>
          )}
          <span>{basename}</span>
        </h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
          {fileMeta && <span className="capitalize">{fileMeta.status}</span>}
          {hasStats && (
            <>
              {fileMeta && <span aria-hidden>·</span>}
              <span>
                <span className="text-add">+{fileMeta.additions.toString()}</span>{' '}
                <span className="text-del">-{fileMeta.deletions.toString()}</span>
              </span>
            </>
          )}
          {chunks.length > 0 && (
            <>
              <span aria-hidden>·</span>
              <span>
                Discussed in{' '}
                {chunks.map((c, i) => (
                  <span key={c.chapter.id}>
                    {i > 0 && ', '}
                    <span className="text-foreground">{c.chapter.title}</span>
                  </span>
                ))}
              </span>
            </>
          )}
        </div>
      </header>

      {chunks.length > 0 ? (
        <section className="flex flex-col gap-5">
          {chunks.map(({ chunk }, i) => (
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
      ) : (
        <p className="rounded-lg border border-border bg-card/60 px-4 py-5 text-[13.5px] text-muted-foreground">
          The reviewer didn&apos;t select any hunks for this file, so there&apos;s no inline diff.
          The file may still be listed because it changed — open it on GitHub to see the full diff.
        </p>
      )}
    </article>
  );
}
