import type { ReactNode } from 'react';
import type { DiagramChange, DiagramNodeKind } from '@/review/diagram';
import { token } from '@/report/theme/tokens';
import { changeStyle } from './change-style';
import { DIAGRAM_TYPE, PATH_GAP, PATH_HEIGHT } from './text-metrics';
import classes from './diagram.module.css';

/**
 * Where a grounded node can take the reader. Only a file the review carries
 * opens: a diagram may name an untouched file to say where a part lives, and
 * the report has nothing of that file to show.
 */
export interface DiagramFiles {
  /** Every changed file in the review. */
  reviewed: ReadonlySet<string>;
  open: (filename: string) => void;
}

/** What both painters draw a box from: a graph's node or a sequence's head. */
export interface BoxedPart {
  x: number;
  y: number;
  width: number;
  height: number;
  lines: readonly string[];
  fullLabel?: string;
  path?: string;
  filename?: string;
  change: DiagramChange;
  kind: DiagramNodeKind;
}

/**
 * One node as a box: its outline, its label, the path beneath it in the edge
 * type and mono, like every path in the reader, and muted so the name stays
 * what is read first. A pointer gets the whole label and the whole path,
 * since the box may hold only part of either.
 */
export function NodeBox({
  part,
  uniform,
  files,
  children,
}: {
  part: BoxedPart;
  uniform: boolean;
  files?: DiagramFiles;
  /** Drawn over the box, such as a graph node's change marker. */
  children?: ReactNode;
}) {
  const style = changeStyle(part.change, uniform);
  const filename = part.filename;
  const open = filename !== undefined && files?.reviewed.has(filename) ? files.open : undefined;
  const { lineHeight, size } = DIAGRAM_TYPE.node;
  const block = part.lines.length * lineHeight + (part.path !== undefined ? PATH_HEIGHT : 0);
  const top = part.y + (part.height - block) / 2;
  const centerX = part.x + part.width / 2;
  const spoken = part.fullLabel ?? part.lines.join(' ');
  const cut = part.fullLabel !== undefined || (part.path !== undefined && part.path !== filename);
  const marks = [style.text, filename].filter(Boolean).join(', ');

  return (
    <g
      className={open ? classes.clickable : undefined}
      role={open ? 'button' : undefined}
      tabIndex={open ? 0 : undefined}
      aria-label={open ? `${spoken} — ${marks}` : undefined}
      onClick={open ? () => open(filename as string) : undefined}
      onKeyDown={
        open
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                open(filename as string);
              }
            }
          : undefined
      }
    >
      {/*
       * Two files in one diagram can differ only in the part that was cut,
       * which leaves the diagram drawing the comparison and unable to say
       * which side is which.
       */}
      {cut && <title>{part.path !== undefined ? `${spoken}\n${filename ?? ''}` : spoken}</title>}
      <rect
        x={part.x}
        y={part.y}
        width={part.width}
        height={part.height}
        rx={part.kind === 'data' ? 12 : 6}
        fill={token('card')}
        stroke={token(style.stroke)}
        strokeWidth={part.change === 'unchanged' ? 1 : 1.75}
        strokeDasharray={style.dashed ? '5 4' : undefined}
      />
      {part.lines.map((line, index) => (
        <text
          key={index}
          x={centerX}
          y={top + index * lineHeight + lineHeight / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={size}
          fill={token(style.label)}
        >
          {line}
        </text>
      ))}
      {part.path !== undefined && (
        <text
          className={classes.path}
          x={centerX}
          y={top + part.lines.length * lineHeight + PATH_GAP + DIAGRAM_TYPE.edge.lineHeight / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={DIAGRAM_TYPE.edge.size}
          fill={token('muted-foreground')}
        >
          {part.path}
        </text>
      )}
      {children}
    </g>
  );
}
