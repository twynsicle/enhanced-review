import type { CitedHunk, HunkMove } from '@/review/narrative';
import { formatSelectedHunkLabel } from '@/report/reader/inline-diff-snippets';

/**
 * What a diff says about a hunk beyond its lines: the fact the CLI proved, and
 * why a skim hunk may be skimmed. Pure, so the wording is tested apart from
 * Monaco.
 */
export interface HunkNote {
  /** A few words, short enough to sit over the right edge of the code. */
  label: string;
  /** The whole of it, for a hover. */
  detail: string;
}

/**
 * A move as a reader asks about it: where the lines went, and whether they
 * arrived as they left. The similarity stays in the hover, since a bare
 * percentage on the tag read as the share of the hunk that moved.
 */
function moveNote(direction: 'from' | 'to', { filename, similarity }: HunkMove): HunkNote {
  if (similarity === 100) {
    return {
      label: `Moved unchanged ${direction} ${filename}`,
      detail: `Every line ${direction === 'from' ? 'was removed from' : 'reappears in'} ${filename} as it is here`,
    };
  }
  return {
    label: `Moved ${direction} ${filename}, with edits`,
    detail: `${String(similarity)}% of these lines match the lines ${direction === 'from' ? 'removed from' : 'added to'} ${filename}`,
  };
}

export function provenNote(hunk: CitedHunk): HunkNote | null {
  if (hunk.whitespaceOnly) {
    return {
      label: 'Whitespace only',
      detail: 'Only whitespace changed, and none of it where it could change how the code parses',
    };
  }
  if (hunk.movedFrom) return moveNote('from', hunk.movedFrom);
  if (hunk.movedTo) return moveNote('to', hunk.movedTo);
  return null;
}

/** A proven fact and the hunks it holds for, with their lines joined. */
export interface FactTag extends HunkNote {
  lines: string;
}

/**
 * The card header's tags: one per fact, not one per hunk, so a block split
 * into parts and moved whole is one tag over all of its lines.
 */
export function factTags(hunks: readonly CitedHunk[]): FactTag[] {
  const byLabel = new Map<string, { note: HunkNote; hunks: CitedHunk[] }>();
  for (const hunk of hunks.toSorted((a, b) => a.fileOrder - b.fileOrder)) {
    const note = provenNote(hunk);
    if (!note) continue;
    const entry = byLabel.get(note.label);
    if (entry) entry.hunks.push(hunk);
    else byLabel.set(note.label, { note, hunks: [hunk] });
  }
  return [...byLabel.values()].map(({ note, hunks: held }) => ({
    ...note,
    lines: formatSelectedHunkLabel(held),
  }));
}

/** A run of a snippet's hunks the diff labels as one region. */
export interface HunkMark extends HunkNote {
  key: string;
  skim: boolean;
  hunks: readonly CitedHunk[];
}

/**
 * The regions a snippet labels: each skim hunk, and each hunk with a proven
 * fact whatever its tier. Neighbours with the same label are one region, so a
 * split block reads as the block it was. A skim region's label leads with
 * "Skim", since the label is what says why the lines are faded.
 */
export function hunkMarks(hunks: readonly CitedHunk[]): HunkMark[] {
  const marks: HunkMark[] = [];
  let previous: CitedHunk | undefined;
  for (const hunk of hunks.toSorted((a, b) => a.fileOrder - b.fileOrder)) {
    const note = markNote(hunk);
    const last = marks.at(-1);
    const joins =
      last !== undefined &&
      previous !== undefined &&
      last.hunks.at(-1) === previous &&
      hunk.fileOrder === previous.fileOrder + 1 &&
      last.label === note?.label;
    if (note && joins) last.hunks = [...last.hunks, hunk];
    else if (note) marks.push({ key: hunk.id, ...note, skim: hunk.tier === 'skim', hunks: [hunk] });
    previous = hunk;
  }
  return marks;
}

function markNote(hunk: CitedHunk): HunkNote | null {
  const proven = provenNote(hunk);
  if (hunk.tier === 'read') return proven;
  const reason = hunk.skimReason;
  const label = ['Skim', proven?.label, reason].filter(Boolean).join(' · ');
  const detail = [proven?.detail, reason].filter(Boolean).join('. ');
  return { label, detail: detail || 'The review says these lines can be skimmed' };
}
