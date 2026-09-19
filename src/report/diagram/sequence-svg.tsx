import { CAPTION_TYPE, token } from '@/report/theme/tokens';
import { changeStyle } from './change-style';
import {
  SELF_LABEL_OFFSET,
  type LaidOutMessage,
  type LaidOutParticipant,
  type SequenceLayout,
} from './sequence-layout';
import { DIAGRAM_TYPE } from './text-metrics';
import classes from './diagram.module.css';

/** Paints a laid-out sequence: heads, lifelines, group frames, messages. */
const ARROW = 6;
const LABEL_LIFT = 12;

function Head({
  participant,
  uniform,
  onSelectFile,
}: {
  participant: LaidOutParticipant;
  uniform: boolean;
  onSelectFile?: (filename: string) => void;
}) {
  const style = changeStyle(participant.change, uniform);
  const clickable = participant.filename !== undefined && onSelectFile !== undefined;
  const { lineHeight } = DIAGRAM_TYPE.node;
  const firstY =
    participant.y + participant.height / 2 - ((participant.lines.length - 1) * lineHeight) / 2;

  return (
    <g
      className={clickable ? classes.clickable : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={
        clickable ? `${participant.lines.join(' ')} — ${participant.filename ?? ''}` : undefined
      }
      onClick={clickable ? () => onSelectFile(participant.filename as string) : undefined}
      onKeyDown={
        clickable
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelectFile(participant.filename as string);
              }
            }
          : undefined
      }
    >
      <rect
        x={participant.x}
        y={participant.y}
        width={participant.width}
        height={participant.height}
        rx={participant.kind === 'data' ? 12 : 6}
        fill={token('card')}
        stroke={token(style.stroke)}
        strokeWidth={participant.change === 'unchanged' ? 1 : 1.75}
        strokeDasharray={style.dashed ? '5 4' : undefined}
      />
      {participant.lines.map((line, index) => (
        <text
          key={index}
          x={participant.centerX}
          y={firstY + index * lineHeight}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={DIAGRAM_TYPE.node.size}
          fill={token(style.label)}
        >
          {line}
        </text>
      ))}
    </g>
  );
}

function Message({ message, uniform }: { message: LaidOutMessage; uniform: boolean }) {
  const style = changeStyle(message.change, uniform);
  const stroke = token(style.stroke);
  const dashed = message.style === 'return' || style.dashed;
  const { lineHeight, size } = DIAGRAM_TYPE.edge;
  /*
   * Labels are centred on their own baseline, so lifting them by half the line
   * height is not enough: the glyph box reaches roughly 5.5px below the centre
   * and the arrow is 1.5px thick, which put every descender straight through
   * the line. LABEL_LIFT clears the box, not the centre.
   */
  const labelTop = message.y - LABEL_LIFT - (message.lines.length - 1) * lineHeight;

  if (message.selfCall) {
    const x = message.fromX;
    const top = message.y - 10;
    const bottom = message.y + 10;
    return (
      <g>
        <path
          d={`M${String(x)},${String(top)} L${String(x + 30)},${String(top)} L${String(x + 30)},${String(bottom)} L${String(x + 6)},${String(bottom)}`}
          fill="none"
          stroke={stroke}
          strokeWidth={1.5}
          strokeDasharray={dashed ? '5 4' : undefined}
        />
        <path
          d={`M${String(x + 6)},${String(bottom)} L${String(x + 6 + ARROW)},${String(bottom - 4)} L${String(x + 6 + ARROW)},${String(bottom + 4)} Z`}
          fill={stroke}
        />
        {message.lines.map((line, index) => (
          <text
            key={index}
            x={x + SELF_LABEL_OFFSET}
            y={message.y + (index - (message.lines.length - 1) / 2) * lineHeight}
            dominantBaseline="central"
            fontSize={size}
            fill={token('muted-foreground')}
          >
            {line}
          </text>
        ))}
      </g>
    );
  }

  const forward = message.toX > message.fromX;
  const tip = message.toX + (forward ? -1 : 1);
  return (
    <g>
      <line
        x1={message.fromX}
        y1={message.y}
        x2={tip}
        y2={message.y}
        stroke={stroke}
        strokeWidth={1.5}
        strokeDasharray={dashed ? '5 4' : undefined}
      />
      <path
        d={`M${String(tip)},${String(message.y)} L${String(tip + (forward ? -ARROW : ARROW))},${String(message.y - 4)} L${String(tip + (forward ? -ARROW : ARROW))},${String(message.y + 4)} Z`}
        fill={stroke}
      />
      {message.lines.map((line, index) => (
        <text
          key={index}
          x={(message.fromX + message.toX) / 2}
          y={labelTop + index * lineHeight}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={size}
          fill={token('muted-foreground')}
        >
          {line}
        </text>
      ))}
    </g>
  );
}

export function SequenceSvg({
  layout,
  onSelectFile,
}: {
  layout: SequenceLayout;
  onSelectFile?: (filename: string) => void;
}) {
  return (
    <>
      {layout.participants.map((participant) => (
        <line
          key={`life-${participant.id}`}
          x1={participant.centerX}
          y1={layout.lifelineTop}
          x2={participant.centerX}
          y2={layout.lifelineBottom}
          stroke={token('border')}
          strokeDasharray="2 5"
        />
      ))}

      {layout.groups.map((group) => (
        <g key={group.key}>
          <rect
            x={group.x}
            y={group.y}
            width={group.width}
            height={group.height}
            rx={8}
            fill="none"
            stroke={token('border')}
          />
          <rect
            x={group.x}
            y={group.y}
            width={44 + (group.label ? 0 : 0)}
            height={18}
            rx={8}
            fill={token('surface-2')}
          />
          <text
            x={group.x + 10}
            y={group.y + 9}
            dominantBaseline="central"
            fontSize={CAPTION_TYPE.size}
            fontWeight={CAPTION_TYPE.weight}
            letterSpacing={CAPTION_TYPE.tracking}
            fill={token('muted-foreground')}
          >
            {group.style.toUpperCase()}
          </text>
          {group.label !== undefined && (
            <text
              x={group.x + 58}
              y={group.y + 9}
              dominantBaseline="central"
              fontSize={DIAGRAM_TYPE.edge.size}
              fill={token('muted-foreground')}
            >
              {group.label}
            </text>
          )}
          {group.branches.map((branch, index) => (
            <g key={index}>
              {branch.rule && (
                <line
                  x1={group.x}
                  y1={branch.y}
                  x2={group.x + group.width}
                  y2={branch.y}
                  stroke={token('border')}
                  strokeDasharray="4 4"
                />
              )}
              {branch.label !== undefined && (
                <text
                  x={group.x + 10}
                  y={branch.y + 10}
                  dominantBaseline="central"
                  fontSize={DIAGRAM_TYPE.edge.size}
                  fontWeight={600}
                  fill={token('foreground')}
                >
                  [{branch.label}]
                </text>
              )}
            </g>
          ))}
        </g>
      ))}

      {layout.messages.map((message) => (
        <Message key={message.key} message={message} uniform={layout.uniform} />
      ))}

      {layout.participants.map((participant) => (
        <Head
          key={participant.id}
          participant={participant}
          uniform={layout.uniform}
          {...(onSelectFile ? { onSelectFile } : {})}
        />
      ))}
    </>
  );
}
