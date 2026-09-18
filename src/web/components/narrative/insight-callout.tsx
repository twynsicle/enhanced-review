import { Stack, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';
import type { Insight, InsightType, JudgementCall } from '@/domain/review/narrative';
import { Caption } from '@/web/components/caption';
import { token, type TokenName } from '@/web/theme/tokens';

/**
 * Colour-coded by kind: highlight reads as risk (coral), rationale as
 * reasoning (mint), context as question (cobalt), and a judgement call as
 * suggestion (amber). The kind shows as a 3px left rail in the accent hue —
 * editorial marginalia sitting directly on the page, with no card chrome of
 * its own.
 *
 * Amber for the judgement call rather than cobalt, even though cobalt is the
 * token literally named `question`: cobalt is also the chapter eyebrow, and a
 * question sharing that hue reads as part of the chapter's furniture instead
 * of as the one thing on the page addressed to the reader.
 */
const TYPE_TONE: Record<InsightType, { label: string; tone: TokenName }> = {
  context: { label: 'Context', tone: 'question' },
  rationale: { label: 'Reasoning', tone: 'praise' },
  highlight: { label: 'Risk', tone: 'risk' },
};

const JUDGEMENT_TONE: TokenName = 'suggestion';

function Marginalia({
  label,
  tone,
  title,
  children,
}: {
  label: string;
  tone: TokenName;
  title?: string | undefined;
  children: ReactNode;
}) {
  const hasTitle = typeof title === 'string' && title.trim().length > 0;
  return (
    <Stack
      component="aside"
      gap={8}
      pl={20}
      pr={8}
      style={{ borderLeft: `3px solid ${token(tone)}` }}
    >
      <Caption tone={tone}>{label}</Caption>
      {hasTitle && (
        <Title order={3} fz="lg" fw={600} lh={1.35} style={{ textWrap: 'pretty' }}>
          {title}
        </Title>
      )}
      {children}
    </Stack>
  );
}

export function InsightCallout({ insight }: { insight: Insight }) {
  const { label, tone } = TYPE_TONE[insight.type] ?? TYPE_TONE.context;
  return (
    <Marginalia label={label} tone={tone} title={insight.title}>
      <Text fz="md" style={{ textWrap: 'pretty' }}>
        {insight.text}
      </Text>
    </Marginalia>
  );
}

/**
 * A question put to the reader, drawn in the same marginalia as an insight
 * because it belongs to the same column of asides — what differs is the hue
 * and the label, not the shape.
 */
export function JudgementCallout({ call }: { call: JudgementCall }) {
  return (
    <Marginalia label="Judgement call" tone={JUDGEMENT_TONE} title={call.title}>
      <Text fz="md" style={{ textWrap: 'pretty' }}>
        {call.text}
      </Text>
    </Marginalia>
  );
}
