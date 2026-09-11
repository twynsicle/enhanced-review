import type { DiagramChange } from '@/domain/review/diagram';
import type { TokenName } from '@/web/theme/tokens';

/**
 * How a change mark is drawn.
 *
 * Nodes are not filled. Change is carried by the stroke and a corner marker,
 * and the label stays `foreground` — which sidesteps the palette rule that
 * text on a `-soft` fill must take the matching `-ink`, since there is no
 * `add-soft`/`del-soft` pair to reach for. An outlined box on the page ground
 * keeps every label on a colour that already clears AA against all four
 * grounds, and adds no tokens to a palette whose contrast is checked by hand.
 *
 * The tokens are the ones the reader already speaks: `add` and `del` are the
 * green and red on the `+N`/`−N` counts in `file-view` and `summary-card`, so
 * a node added by this PR is the same green as the lines that added it.
 * `suggestion` is the one remaining semantic accent not already spoken for,
 * and amber reads as "touched" rather than "new" or "gone".
 */
export interface ChangeStyle {
  /** Node border and edge line. */
  stroke: TokenName;
  /** Node label. */
  label: TokenName;
  /** Removed things are drawn dashed as well as coloured. */
  dashed: boolean;
  /** Corner marker, or null when the mark needs no glyph. */
  marker: string | null;
  /** Legend wording, and the accessible name suffix on a node. */
  text: string;
}

const STYLES: Record<DiagramChange, ChangeStyle> = {
  added: { stroke: 'add', label: 'foreground', dashed: false, marker: '+', text: 'added' },
  removed: { stroke: 'del', label: 'foreground', dashed: true, marker: '−', text: 'removed' },
  modified: {
    stroke: 'suggestion',
    label: 'foreground',
    dashed: false,
    marker: '±',
    text: 'modified',
  },
  unchanged: {
    stroke: 'border',
    label: 'muted-foreground',
    dashed: false,
    marker: null,
    text: 'unchanged',
  },
};

/**
 * The flat treatment, used when every node in a diagram carries the same mark.
 * A wholly new subsystem is entirely `added`, and colouring all of it says
 * nothing: emphasis needs something to be emphatic against.
 */
const FLAT: ChangeStyle = {
  stroke: 'border',
  label: 'foreground',
  dashed: false,
  marker: null,
  text: '',
};

export function changeStyle(change: DiagramChange, uniform: boolean): ChangeStyle {
  return uniform ? FLAT : STYLES[change];
}

/** The marks present in a diagram, in a fixed order, for the legend. */
export const CHANGE_ORDER: readonly DiagramChange[] = [
  'added',
  'modified',
  'removed',
  'unchanged',
] as const;
