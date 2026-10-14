import type { CitedHunk, HunkMove } from '@/review/narrative';
import { formatSelectedHunkLabel } from '@/report/reader/inline-diff-snippets';

/**
 * A run of a label's text. A path is kept apart from the words around it so a
 * label too long for its room gives up the start of the path first: the file
 * name at its end is what says where a move went, and the directories before
 * it are what a long path shares with its neighbours.
 */
export interface LabelPart {
  text: string;
  path?: true;
}

/**
 * What a diff says about a hunk beyond its lines: the fact the CLI proved, and
 * why a skim hunk may be skimmed. Pure, so the wording is tested apart from
 * Monaco.
 */
export interface HunkNote {
  /** A few words, short enough to sit over the right edge of the code. */
  label: string;
  /** `label` in runs, its paths marked. */
  parts: readonly LabelPart[];
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

/** Runs of label text joined with the label's separator, as one label. */
function joinParts(groups: readonly (readonly LabelPart[])[]): Pick<HunkNote, 'label' | 'parts'> {
  const parts = groups.flatMap((group, i) => (i === 0 ? group : [{ text: ' · ' }, ...group]));
  return { label: parts.map((part) => part.text).join(''), parts };
}

const words = (text: string): LabelPart[] => [{ text }];

/**
 * A move as a reader asks about it: where the lines went, and whether they
 * arrived as they left. The similarity stays in the hover, since a bare
 * percentage on the tag read as the share of the hunk that moved.
 */
function moveNote(direction: 'from' | 'to', { filename, similarity }: HunkMove): HunkNote {
  const unchanged = similarity === 100;
  return {
    ...joinParts([
      [
        { text: unchanged ? `Moved unchanged ${direction} ` : `Moved ${direction} ` },
        { text: filename, path: true },
        ...(unchanged ? [] : [{ text: ', with edits' }]),
      ],
    ]),
    detail: unchanged
      ? `Every line ${direction === 'from' ? 'was removed from' : 'reappears in'} ${filename} as it is here`
      : `${String(similarity)}% of these lines match the lines ${direction === 'from' ? 'removed from' : 'added to'} ${filename}`,
    tone: 'move',
  };
}

export function provenNote(hunk: CitedHunk): HunkNote | null {
  if (hunk.whitespaceOnly) {
    return {
      ...joinParts([words('Whitespace only')]),
      detail: 'Only whitespace changed, and none of it where it could change how the code parses',
      tone: 'plain',
    };
  }
  if (hunk.importsOnly) {
    return {
      ...joinParts([words('Imports only')]),
      detail: 'Every line changed here is part of an import or re-export',
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
  return [...byLabel.values()].map((held) => ({
    ...held[0]!.note,
    detail: joinedDetail(held),
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
   * that is new. Only the hunk debug labels a region that does not fade.
   */
  fade: 'skim' | 'move' | 'none';
  hunks: readonly CitedHunk[];
}

function fadeOf(hunk: CitedHunk): HunkMark['fade'] {
  if (hunk.tier === 'skim') return 'skim';
  return hunk.movedFrom || hunk.movedTo ? 'move' : 'none';
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
    ...held[0]!.note,
    key: held[0]!.hunk.id,
    detail: joinedDetail(held),
    fade: fadeOf(held[0]!.hunk),
    hunks: held.map(({ hunk }) => hunk),
  }));
}

function markNote(hunk: CitedHunk): HunkNote | null {
  const proven = provenNote(hunk);
  if (hunk.tier === 'read') return proven;
  const reason = hunk.skimReason;
  const detail = [proven?.detail, reason].filter(Boolean).join('. ');
  return {
    ...joinParts([
      words('Skim'),
      ...(proven ? [proven.parts] : []),
      ...(reason ? [words(reason)] : []),
    ]),
    detail: detail || 'The review says these lines can be skimmed',
    tone: proven?.tone ?? 'plain',
  };
}

/**
 * Every hunk as its own region, labelled with what the reader is otherwise
 * left to infer: its id, its tier, which part of a split hunk it is, and the
 * facts and reason behind its tier. For telling a hunk tiered wrongly from one
 * cut in the wrong place, so nothing is joined, a read hunk with nothing
 * proven about it is labelled too, and every region's bracket shows where
 * the splitter cut.
 */
export function debugMarks(hunks: readonly CitedHunk[]): HunkMark[] {
  return hunks
    .toSorted((a, b) => a.fileOrder - b.fileOrder)
    .map((hunk) => {
      const proven = provenNote(hunk);
      const part = hunk.part ? ` · part ${String(hunk.part.part)}/${String(hunk.part.of)}` : '';
      return {
        ...joinParts([
          words(`${hunk.id} · ${hunk.tier}${part}`),
          ...(proven ? [proven.parts] : []),
          ...(hunk.skimReason ? [words(hunk.skimReason)] : []),
        ]),
        detail: [
          `${hunk.id}, ${String(hunk.changedLines)} changed lines`,
          proven?.detail,
          hunk.skimReason,
        ]
          .filter(Boolean)
          .join('. '),
        tone: proven?.tone ?? 'plain',
        key: hunk.id,
        fade: fadeOf(hunk),
        hunks: [hunk],
      };
    });
}
