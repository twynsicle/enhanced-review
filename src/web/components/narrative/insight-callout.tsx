import { Stack, Text, Title } from '@mantine/core';
import type { Insight, InsightType } from '@/domain/review/narrative';
import { token, type TokenName } from '@/web/theme/tokens';

/**
 * Colour-coded by kind: highlight reads as risk (coral), rationale as praise
 * (mint), reference as suggestion (amber), context as question (cobalt). The
 * kind shows as a 3px left rail in the accent hue — editorial marginalia
 * sitting directly on the page, with no card chrome of its own.
 */
const TYPE_TONE: Record<InsightType, { label: string; tone: TokenName }> = {
  context: { label: 'Context', tone: 'question' },
  rationale: { label: 'Praise', tone: 'praise' },
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
      <Text
        component="span"
        fz={10.5}
        fw={600}
        tt="uppercase"
        style={{ letterSpacing: '0.14em', color: token(tone) }}
      >
        {label}
      </Text>
      {hasTitle && (
        <Title order={3} ff="text" fz={15} fw={600} lh={1.375} style={{ textWrap: 'pretty' }}>
          {insight.title}
        </Title>
      )}
      <Text
        fz={13.5}
        lh={1.55}
        style={{
          color: `color-mix(in oklab, ${token('foreground')} 80%, transparent)`,
          textWrap: 'pretty',
        }}
      >
        {insight.text}
      </Text>
    </Stack>
  );
}
