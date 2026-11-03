import { CAPTION_TYPE, token } from '@/report/theme/tokens';
import { changeStyle } from './change-style';
import {
  GROUP_LABEL_INSET,
  PANEL_TITLE_HEIGHT,
  PANEL_TITLE_INSET,
  type GraphLayout,
  type LaidOutEdge,
  type LaidOutNode,
  type Point,
} from './graph-layout';
import { NodeBox, type DiagramFiles } from './node-box';
import { DIAGRAM_TYPE } from './text-metrics';

/**
 * Paints a laid-out graph. Nodes are outlined rather than filled — see
 * `change-style.ts` — so every label sits on `card`, one of the four grounds
 * the palette guardrail already checks `foreground` against.
 *
 * Arrowheads are drawn by hand from the last segment rather than with SVG
 * `marker` elements: a marker cannot inherit the line's stroke without
 * `context-stroke`, and defining one per colour per diagram is more machinery
 * than two lines of trigonometry.
 */
const ARROW = 7;

function arrowHead(points: readonly Point[]): string {
  const end = points[points.length - 1];
  const prev = points[points.length - 2];
  if (!end || !prev) return '';
  const angle = Math.atan2(end.y - prev.y, end.x - prev.x);
  const wing = Math.PI / 7;
  const ax = end.x - ARROW * Math.cos(angle - wing);
  const ay = end.y - ARROW * Math.sin(angle - wing);
  const bx = end.x - ARROW * Math.cos(angle + wing);
  const by = end.y - ARROW * Math.sin(angle + wing);
  return `M${String(end.x)},${String(end.y)} L${String(ax)},${String(ay)} L${String(bx)},${String(by)} Z`;
}

function polyline(points: readonly Point[]): string {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${String(point.x)},${String(point.y)}`)
    .join(' ');
}

function EdgeShape({ edge, uniform }: { edge: LaidOutEdge; uniform: boolean }) {
  const style = changeStyle(edge.change, uniform);
  const stroke = token(style.stroke);
  return (
    <g>
      <path
        d={polyline(edge.points)}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeDasharray={style.dashed ? '5 4' : undefined}
      />
      <path d={arrowHead(edge.points)} fill={stroke} />
      {edge.label !== undefined && edge.labelX !== undefined && edge.labelY !== undefined && (
        <>
          <rect
            x={edge.labelX - (edge.labelWidth ?? 0) / 2 - 4}
            y={edge.labelY - DIAGRAM_TYPE.edge.lineHeight / 2}
            width={(edge.labelWidth ?? 0) + 8}
            height={DIAGRAM_TYPE.edge.lineHeight}
            rx={3}
            fill={token('background')}
          />
          <text
            x={edge.labelX}
            y={edge.labelY}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={DIAGRAM_TYPE.edge.size}
            fill={token('muted-foreground')}
          >
            {edge.label}
          </text>
        </>
      )}
    </g>
  );
}

function NodeShape({
  node,
  uniform,
  files,
}: {
  node: LaidOutNode;
  uniform: boolean;
  files?: DiagramFiles;
}) {
  const style = changeStyle(node.change, uniform);

  if (node.isInitialDot) {
    return (
      <circle
        cx={node.x + node.width / 2}
        cy={node.y + node.height / 2}
        r={node.width / 2}
        fill={token('foreground')}
      />
    );
  }

  return (
    <NodeBox part={node} uniform={uniform} {...(files ? { files } : {})}>
      {style.marker !== null && (
        <text
          x={node.x + node.width - 6}
          y={node.y + 4}
          textAnchor="end"
          dominantBaseline="hanging"
          fontSize={DIAGRAM_TYPE.edge.size}
          fontWeight={700}
          fill={token(style.stroke)}
          aria-hidden
        >
          {style.marker}
        </text>
      )}
    </NodeBox>
  );
}

export function GraphSvg({ layout, files }: { layout: GraphLayout; files?: DiagramFiles }) {
  return (
    <>
      {layout.panels.map((panel, panelIndex) => (
        <g
          key={panelIndex}
          transform={`translate(${String(panel.offsetX)},${String(panel.offsetY)})`}
        >
          {panel.title !== undefined && (
            <text
              x={PANEL_TITLE_INSET}
              y={-PANEL_TITLE_HEIGHT / 2}
              dominantBaseline="central"
              fontSize={CAPTION_TYPE.size}
              fontWeight={CAPTION_TYPE.weight}
              letterSpacing={CAPTION_TYPE.tracking}
              fill={token('muted-foreground')}
            >
              {panel.title.toUpperCase()}
            </text>
          )}
          {panel.groups.map((group) => (
            <g key={group.id}>
              <rect
                x={group.x}
                y={group.y}
                width={group.width}
                height={group.height}
                rx={10}
                fill="none"
                stroke={token('border')}
                strokeDasharray="3 4"
              />
              <text
                x={group.x + GROUP_LABEL_INSET}
                y={group.y + 13}
                dominantBaseline="central"
                fontSize={CAPTION_TYPE.size}
                fontWeight={CAPTION_TYPE.weight}
                letterSpacing={CAPTION_TYPE.tracking}
                fill={token('muted-foreground')}
              >
                {group.fullLabel !== undefined && <title>{group.fullLabel}</title>}
                {group.label.toUpperCase()}
              </text>
            </g>
          ))}
          {panel.edges.map((edge) => (
            <EdgeShape key={edge.key} edge={edge} uniform={layout.uniform} />
          ))}
          {panel.nodes.map((node) => (
            <NodeShape
              key={node.id}
              node={node}
              uniform={layout.uniform}
              {...(files ? { files } : {})}
            />
          ))}
        </g>
      ))}
    </>
  );
}
