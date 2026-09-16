import { Stack, Text, Title } from '@mantine/core';
import type { Insight, InsightType } from '@/domain/review/narrative';
import { Caption } from '@/web/components/caption';
import { token, type TokenName } from '@/web/theme/tokens';

/**
 * Colour-coded by kind: highlight reads as risk (coral), rationale as
 * reasoning (mint), reference as suggestion (amber), context as question
 * (cobalt). The kind shows as a 3px left rail in the accent hue — editorial
 * marginalia sitting directly on the page, with no card chrome of its own.
 */
const TYPE_TONE: Record<InsightType, { label: string; tone: TokenName }> = {
  context: { label: 'Context', tone: 'question' },
  rationale: { label: 'Reasoning', tone: 'praise' },
  highlight: { label: 'Risk', tone: 'risk' },
  reference: { label: 'Suggestion', tone: 'suggestion' },
};

export function InsightCallout({ insight }: { insight: Insight }) {
  const { label, tone } = TYPE_TONE[insight.type] ?? TYPE_TONE.context;
  const hasTitle = typeof insight.title === 'string' && insight.title.trim().length > 0;
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
          {insight.title}
        </Title>
      )}
      <Text fz="md" style={{ textWrap: 'pretty' }}>
        {insight.text}
      </Text>
    </Stack>
  );
}
