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
  /**
   * The colour it is drawn in. A move has its own, since it is the commonest
   * fact and its region is read differently: the lines are not new, only
   * moved. Everything else is plain.
   */
  tone: HunkTone;
}

export type HunkTone = 'move' | 'plain';

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
      tone: 'move',
    };
  }
  return {
    label: `Moved ${direction} ${filename}, with edits`,
    detail: `${String(similarity)}% of these lines match the lines ${direction === 'from' ? 'removed from' : 'added to'} ${filename}`,
    tone: 'move',
  };
}

export function provenNote(hunk: CitedHunk): HunkNote | null {
  if (hunk.whitespaceOnly) {
    return {
      label: 'Whitespace only',
      detail: 'Only whitespace changed, and none of it where it could change how the code parses',
      tone: 'plain',
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

/** Hunks that share a label, each with its own note. */
type Held = { hunk: CitedHunk; note: HunkNote }[];

/**
 * One hover for hunks that share a label. Their details can still differ —
 * two moves from one file with edits, matched at different strengths — and
 * then each is given against its own lines rather than the first standing for
 * all of them.
 */
function joinedDetail(held: Held): string {
  const details = new Set(held.map(({ note }) => note.detail));
  if (details.size === 1) return held[0]!.note.detail;
  return held
    .map(({ hunk, note }) => `${formatSelectedHunkLabel([hunk])}: ${note.detail}`)
    .join('\n');
}

/**
 * The card header's tags: one per fact, not one per hunk, so a block split
 * into parts and moved whole is one tag over all of its lines.
 */
export function factTags(hunks: readonly CitedHunk[]): FactTag[] {
  const byLabel = new Map<string, Held>();
  for (const hunk of hunks.toSorted((a, b) => a.fileOrder - b.fileOrder)) {
    const note = provenNote(hunk);
    if (!note) continue;
    const held = byLabel.get(note.label);
    if (held) held.push({ hunk, note });
    else byLabel.set(note.label, [{ hunk, note }]);
  }
  return [...byLabel].map(([label, held]) => ({
    label,
    detail: joinedDetail(held),
    tone: held[0]!.note.tone,
    lines: formatSelectedHunkLabel(held.map(({ hunk }) => hunk)),
  }));
}

/** A run of a snippet's hunks the diff labels as one region. */
export interface HunkMark extends HunkNote {
  key: string;
  /**
   * How far the region's lines fade: a skim hunk's by the reader's skim fade,
   * and a moved hunk the review still says to read by less of it — the reader
   * keeps the shape of what moved in view without it pulling as hard as code
   * that is new.
   */
  fade: 'skim' | 'move';
  hunks: readonly CitedHunk[];
}

/**
 * The regions a snippet labels: each skim hunk, and each hunk with a proven
 * fact whatever its tier. Neighbours with the same label are one region, so a
 * split block reads as the block it was. A skim region's label leads with
 * "Skim", which is also what keeps a skim region from joining a read one.
 */
export function hunkMarks(hunks: readonly CitedHunk[]): HunkMark[] {
  const runs: Held[] = [];
  let previous: CitedHunk | undefined;
  for (const hunk of hunks.toSorted((a, b) => a.fileOrder - b.fileOrder)) {
    const note = markNote(hunk);
    const run = runs.at(-1);
    const last = run?.at(-1);
    const joins =
      last !== undefined &&
      last.hunk === previous &&
      hunk.fileOrder === last.hunk.fileOrder + 1 &&
      last.note.label === note?.label;
    if (note && joins) run!.push({ hunk, note });
    else if (note) runs.push([{ hunk, note }]);
    previous = hunk;
  }
  return runs.map((held) => ({
    key: held[0]!.hunk.id,
    label: held[0]!.note.label,
    detail: joinedDetail(held),
    tone: held[0]!.note.tone,
    fade: held[0]!.hunk.tier === 'skim' ? 'skim' : 'move',
    hunks: held.map(({ hunk }) => hunk),
  }));
}

function markNote(hunk: CitedHunk): HunkNote | null {
  const proven = provenNote(hunk);
  if (hunk.tier === 'read') return proven;
  const reason = hunk.skimReason;
  const label = ['Skim', proven?.label, reason].filter(Boolean).join(' · ');
  const detail = [proven?.detail, reason].filter(Boolean).join('. ');
  return {
    label,
    detail: detail || 'The review says these lines can be skimmed',
    tone: proven?.tone ?? 'plain',
  };
}
