import { Text } from '@mantine/core';
import type { ElementType, ReactNode } from 'react';
import { CAPTION_TYPE, token, type TokenName } from '@/web/theme/tokens';

/**
 * The app's one uppercase label: eyebrows ("Chapter Two"), field captions
 * ("Risk rating"), section rules ("Insights") and dt cells are all this
 * component, and differ only in `tone`.
 *
 * It exists because the reader previously grew nine of these — 10px, 10.5px
 * and 11px, weight 500 and 600, tracking from 0.1em to 0.18em, in three
 * different greys. None of those differences carried meaning, so the eye read
 * them as noise while looking for a hierarchy that wasn't there.
 *
 * Pass `component` to give the label its real semantics (`h2`, `dt`, `legend`)
 * without changing how it looks.
 */
export function Caption({
  children,
  tone = 'muted-foreground',
  component = 'span',
  id,
  pt,
}: {
  children: ReactNode;
  /** Colour token: the default reads as chrome, `before` as an accent eyebrow. */
  tone?: TokenName;
  component?: ElementType;
  id?: string;
  /** Optical nudge for labels aligned against a taller neighbour. */
  pt?: number;
}) {
  return (
    <Text
      // Mantine types `component` per call site; this component forwards it.
      component={component as 'span'}
      id={id}
      pt={pt}
      fz={CAPTION_TYPE.size}
      fw={CAPTION_TYPE.weight}
      tt="uppercase"
      c={token(tone)}
      style={{ letterSpacing: CAPTION_TYPE.tracking, margin: 0 }}
    >
      {children}
    </Text>
  );
}
