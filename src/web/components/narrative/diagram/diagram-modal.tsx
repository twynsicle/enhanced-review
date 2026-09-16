import { ActionIcon, Group, Modal, Text, Tooltip } from '@mantine/core';
import { IconFocusCentered, IconMinus, IconPlus } from '@tabler/icons-react';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { token } from '@/web/theme/tokens';
import classes from './diagram.module.css';

/**
 * The expanded view: the same painted diagram, on the whole viewport, with pan
 * and zoom.
 *
 * This is where a large graph becomes readable, and it is the reason the
 * schema puts no aesthetic ceiling on node count. Zoom is viewBox arithmetic —
 * cheap, because we own the SVG. Nothing here scales the type below the type
 * scale, because at 100% it is the same 1:1 drawing the page shows; zooming
 * out is the reader's own choice, not a layout decision made for them.
 */
const MIN_SCALE = 0.2;
const MAX_SCALE = 4;

/** What one line and one page of wheel delta are worth in pixels. */
const LINE_PX = 16;
const PAGE_PX = 400;
const DELTA_MODE_PX: Record<number, number> = { 0: 1, 1: LINE_PX, 2: PAGE_PX };

/** The most zoom one event may ask for: 200px of delta is about 35%. */
const MAX_WHEEL_PX = 200;
const WHEEL_RATE = 1.0015;

/**
 * The zoom factor one wheel event asks for.
 *
 * A trackpad fling fires many small wheel events per gesture, so a fixed
 * per-event step compounds fast; scaling by the event's own deltaY keeps a
 * light touch light and a hard scroll fast, instead of one gesture jumping
 * from 20% to 100%. That only holds while deltaY is in pixels, which is not
 * something a wheel event promises: Firefox reports a mouse wheel in lines
 * (`deltaMode` 1, about ±3 a tick), which at this rate is half a percent of
 * zoom and reads as a control that does nothing. The clamp covers the other
 * end, where a page-mode or high-resolution event crosses the whole range in
 * one tick.
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  if (!Number.isFinite(deltaY)) return 1;
  const px = deltaY * (DELTA_MODE_PX[deltaMode] ?? 1);
  return Math.pow(WHEEL_RATE, -Math.min(MAX_WHEEL_PX, Math.max(-MAX_WHEEL_PX, px)));
}

interface View {
  x: number;
  y: number;
  scale: number;
}

export function DiagramModal({
  opened,
  onClose,
  title,
  caption,
  width,
  height,
  children,
}: {
  opened: boolean;
  onClose: () => void;
  title: string;
  caption: string;
  width: number;
  height: number;
  children: ReactNode;
}) {
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const [panning, setPanning] = useState(false);
  const origin = useRef<{ x: number; y: number; viewX: number; viewY: number } | null>(null);

  const fit = useCallback(() => {
    setView({ x: 0, y: 0, scale: 1 });
  }, []);

  const zoomBy = useCallback((factor: number) => {
    setView((current) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.scale * factor));
      return { ...current, scale };
    });
  }, []);

  // A larger scale shows less of the drawing, so the viewBox shrinks.
  const viewWidth = width / view.scale;
  const viewHeight = height / view.scale;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      fullScreen
      title={
        <div>
          <Text fw={600}>{title}</Text>
          <Text fz="sm" c="dimmed">
            {caption}
          </Text>
        </div>
      }
      styles={{ body: { height: 'calc(100vh - 120px)', padding: 0 } }}
    >
      <Group justify="flex-end" gap={6} px={16} pb={8}>
        <Tooltip label="Zoom out">
          <ActionIcon variant="default" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out">
            <IconMinus size={16} />
          </ActionIcon>
        </Tooltip>
        <Text fz="xs" c="dimmed" w={44} ta="center" ff="monospace">
          {Math.round(view.scale * 100)}%
        </Text>
        <Tooltip label="Zoom in">
          <ActionIcon variant="default" onClick={() => zoomBy(1.25)} aria-label="Zoom in">
            <IconPlus size={16} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Reset">
          <ActionIcon variant="default" onClick={fit} aria-label="Reset view">
            <IconFocusCentered size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>

      <div className={classes.modalFrame}>
        <svg
          className={classes.modalSvg}
          data-panning={panning || undefined}
          viewBox={`${String(view.x)} ${String(view.y)} ${String(viewWidth)} ${String(viewHeight)}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`${title}. ${caption}`}
          style={{ background: token('background') }}
          onPointerDown={(event) => {
            /*
             * Pointer capture retargets the click that follows to the svg, so
             * capturing on a grounded node swallowed the click that should
             * have opened its file. A press on a node is a click, not a pan.
             */
            if (event.target instanceof Element && event.target.closest('[role="button"]')) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            origin.current = { x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y };
            setPanning(true);
          }}
          onPointerMove={(event) => {
            const start = origin.current;
            if (!start) return;
            const rect = event.currentTarget.getBoundingClientRect();
            /*
             * Pointer pixels are viewport pixels; convert to viewBox units.
             * `meet` scales by whichever axis is tighter, so a tall diagram in
             * a wide frame is fitted by height, and dividing by width alone
             * made it drag slower than the pointer.
             */
            const unitsPerPx = Math.max(
              viewWidth / Math.max(1, rect.width),
              viewHeight / Math.max(1, rect.height),
            );
            setView((current) => ({
              ...current,
              x: start.viewX - (event.clientX - start.x) * unitsPerPx,
              y: start.viewY - (event.clientY - start.y) * unitsPerPx,
            }));
          }}
          onPointerUp={() => {
            origin.current = null;
            setPanning(false);
          }}
          onPointerCancel={() => {
            origin.current = null;
            setPanning(false);
          }}
          onWheel={(event) => {
            zoomBy(wheelZoomFactor(event.deltaY, event.deltaMode));
          }}
        >
          {children}
        </svg>
      </div>
    </Modal>
  );
}
