import { ActionIcon, Stack, Text, Tooltip } from '@mantine/core';
import { IconArrowsMaximize } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import { changeMarks, isGraphDiagram, type Diagram } from '@/review/diagram';
import { Caption } from '@/report/chrome/caption';
import { token } from '@/report/theme/tokens';
import { CHANGE_ORDER, changeStyle } from './change-style';
import { DiagramModal } from './diagram-modal';
import { GraphSvg } from './graph-svg';
import { layoutGraph } from './graph-layout';
import { SequenceSvg } from './sequence-svg';
import { layoutSequence } from './sequence-layout';
import classes from './diagram.module.css';

/**
 * One diagram as a figure: eyebrow, title, the drawing, a legend when there is
 * something to read it against, and the caption that had to justify the
 * picture existing at all.
 *
 * The layout runs during render rather than in an effect, so the SVG is there
 * on the first paint with no layout flash. dagre is pure JavaScript, which is
 * what makes that possible and is most of the reason this is not mermaid.
 */
export function DiagramFigure({
  diagram,
  onSelectFile,
}: {
  diagram: Diagram;
  /** Clicking a node that carries a filename opens that file in the reader. */
  onSelectFile?: (filename: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const painted = useMemo(() => {
    /*
     * The schema and the parser keep a malformed diagram out of the review, so
     * layout should not fail. But this runs during render with no boundary
     * above it until the report's own, and a layout bug would take the whole
     * reader down with it on every visit. Losing one picture is the better failure.
     */
    try {
      return paint(diagram);
    } catch {
      return null;
    }
  }, [diagram]);

  if (painted === null) return null;

  const label = `${diagram.title}. ${diagram.caption}`;
  // A diagram whose marks are all the same is drawn flat, so a legend would
  // have one entry and explain nothing.
  const legend = painted.uniform ? [] : CHANGE_ORDER.filter((mark) => painted.marks.has(mark));

  return (
    <figure className={classes.figure} data-bleed>
      <div className={classes.head}>
        <Stack gap={2}>
          <Caption tone="before">Diagram</Caption>
          <Text fz="md" fw={600}>
            {diagram.title}
          </Text>
        </Stack>
        <Tooltip label="Expand">
          <ActionIcon
            variant="default"
            onClick={() => setExpanded(true)}
            aria-label={`Expand diagram: ${diagram.title}`}
          >
            <IconArrowsMaximize size={16} />
          </ActionIcon>
        </Tooltip>
      </div>

      <div className={classes.frame}>
        <svg
          className={classes.svg}
          width={painted.width}
          height={painted.height}
          viewBox={`0 0 ${String(painted.width)} ${String(painted.height)}`}
          role="img"
          aria-label={label}
        >
          {painted.render(onSelectFile)}
        </svg>
      </div>

      {legend.length > 0 && (
        <div className={classes.legend}>
          {legend.map((mark) => {
            const style = changeStyle(mark, false);
            return (
              <span key={mark} className={classes.legendItem}>
                <span
                  className={classes.swatch}
                  style={{
                    borderTopColor: token(style.stroke),
                    borderTopStyle: style.dashed ? 'dashed' : 'solid',
                  }}
                  aria-hidden
                />
                <Text component="span" fz="xs" c="dimmed">
                  {style.text}
                </Text>
              </span>
            );
          })}
        </div>
      )}

      <Text component="figcaption" fz="sm" c="dimmed">
        {diagram.caption}
      </Text>

      <DiagramModal
        opened={expanded}
        onClose={() => setExpanded(false)}
        title={diagram.title}
        caption={diagram.caption}
        width={painted.width}
        height={painted.height}
      >
        {painted.render(
          onSelectFile &&
            ((filename: string) => {
              // The file opens in the reader behind the modal, so get out of its way.
              setExpanded(false);
              onSelectFile(filename);
            }),
        )}
      </DiagramModal>
    </figure>
  );
}

function paint(diagram: Diagram) {
  // Lines carry change marks too, and a rewiring may be drawn in nothing else.
  const marks = new Set(changeMarks(diagram));
  if (isGraphDiagram(diagram)) {
    const layout = layoutGraph(diagram);
    return {
      width: layout.width,
      height: layout.height,
      uniform: layout.uniform,
      marks,
      render: (handler?: (filename: string) => void) => (
        <GraphSvg layout={layout} {...(handler ? { onSelectFile: handler } : {})} />
      ),
    };
  }
  const layout = layoutSequence(diagram);
  return {
    width: layout.width,
    height: layout.height,
    uniform: layout.uniform,
    marks,
    render: (handler?: (filename: string) => void) => (
      <SequenceSvg layout={layout} {...(handler ? { onSelectFile: handler } : {})} />
    ),
  };
}
