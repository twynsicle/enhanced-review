import {
  Box,
  Collapse,
  Group,
  SimpleGrid,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { useState } from 'react';
import type {
  ReviewRiskAssessment,
  ReviewRiskFactorImpact,
  ReviewRiskScore,
} from '@/domain/review/narrative';
import { token, type TokenName } from '@/web/theme/tokens';

export function normalizeRiskScore(score: number | null | undefined): ReviewRiskScore | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  const rounded = Math.round(score);
  if (rounded < 1 || rounded > 5) return null;
  return rounded as ReviewRiskScore;
}

const LABELS: Record<ReviewRiskScore, string> = {
  1: 'Minimal',
  2: 'Low',
  3: 'Moderate',
  4: 'High',
  5: 'Critical',
};

export function riskLabel(score: ReviewRiskScore): string {
  return LABELS[score];
}

/** mint → mint → amber → coral → coral; mirrors the design's `T` ramp. */
type RiskTone = 'praise' | 'suggestion' | 'risk';

const RAMP: Record<ReviewRiskScore, RiskTone> = {
  1: 'praise',
  2: 'praise',
  3: 'suggestion',
  4: 'risk',
  5: 'risk',
};

const SOFT: Record<RiskTone, TokenName> = {
  praise: 'praise-soft',
  suggestion: 'suggestion-soft',
  risk: 'risk-soft',
};

const CAPTION = { fz: 10.5, fw: 500, tt: 'uppercase', style: { letterSpacing: '0.16em' } } as const;

function riskTitle(score: ReviewRiskScore): string {
  return `Risk ${score} of 5: ${riskLabel(score)}`;
}

/**
 * Compact 1–5 bar meter with caption. `size="lg"` is used in the summary
 * hero panel; the default sits inline with row content.
 */
export function RiskScoreBars({
  score,
  size = 'md',
  hideLabel = false,
}: {
  score: number | null | undefined;
  size?: 'md' | 'lg';
  /** Render only the bars — the caller renders the label separately. */
  hideLabel?: boolean;
}) {
  const normalized = normalizeRiskScore(score);
  if (normalized === null) return null;
  const tint = token(RAMP[normalized]);
  const isLg = size === 'lg';
  return (
    <Group gap={8} wrap="nowrap" title={riskTitle(normalized)}>
      <Box component="span" aria-hidden style={{ display: 'flex', alignItems: 'flex-end', gap: 2 }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <Box
            key={i}
            component="span"
            style={{
              display: 'block',
              borderRadius: 1,
              width: isLg ? 6 : 4,
              height: isLg ? 6 + i * 4 : 4 + i * 2,
              background: i <= normalized ? tint : token('border'),
              opacity: i <= normalized ? 1 : 0.7,
            }}
          />
        ))}
      </Box>
      {!hideLabel && (
        <Text component="span" fz={isLg ? 13 : 11} fw={isLg ? 600 : 500} style={{ color: tint }}>
          Risk · {normalized}/5 · {riskLabel(normalized)}
        </Text>
      )}
    </Group>
  );
}

/** Just the "3/5 · Moderate" caption, coloured by the same ramp. */
export function RiskInlineLabel({ score }: { score: number | null | undefined }) {
  const normalized = normalizeRiskScore(score);
  if (normalized === null) return null;
  return (
    <Text component="span" fz={12} fw={600} style={{ color: token(RAMP[normalized]) }}>
      {normalized}/5 · {riskLabel(normalized)}
    </Text>
  );
}

export function RiskScorePill({
  score,
  showLabel = true,
}: {
  score: number | null | undefined;
  showLabel?: boolean;
}) {
  const normalized = normalizeRiskScore(score);
  if (normalized === null) return null;
  const tone = RAMP[normalized];
  return (
    <Box
      component="span"
      title={riskTitle(normalized)}
      px={10}
      py={2}
      ff="monospace"
      fz={10.5}
      fw={600}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        flexShrink: 0,
        borderRadius: 999,
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        border: `1px solid color-mix(in oklab, ${token(tone)} 40%, transparent)`,
        background: token(SOFT[tone]),
        color: token(tone),
      }}
    >
      R{normalized}
      {showLabel && (
        <Text component="span" ml={6} ff="text" tt="none" style={{ letterSpacing: 'normal' }}>
          {riskLabel(normalized)}
        </Text>
      )}
    </Box>
  );
}

export interface RiskSummaryStat {
  label: string;
  value: string | number;
  sub?: string;
}

function factorTone(impact: ReviewRiskFactorImpact): TokenName {
  if (impact === 'raises') return 'risk';
  if (impact === 'lowers') return 'praise';
  return 'muted-foreground';
}

export function RiskSummaryPanel({
  assessment,
  stats,
}: {
  assessment?: ReviewRiskAssessment;
  stats?: RiskSummaryStat[];
}) {
  const [open, setOpen] = useState(false);
  if (!assessment) return null;
  const divider = { borderTop: `1px solid ${token('border')}` };

  return (
    <Stack
      component="section"
      gap={16}
      p={20}
      style={{
        borderRadius: 12,
        border: `1px solid ${token('border')}`,
        background: token('card'),
      }}
    >
      <Group justify="space-between" align="baseline" gap={12}>
        <Text {...CAPTION} c={token('subtle')}>
          Risk rating
        </Text>
        <Text component="span" ff="monospace" fz={10.5} c={token('subtle')}>
          computed by reviewer
        </Text>
      </Group>

      <RiskScoreBars score={assessment.score} size="lg" />

      <Title order={2} fz={18} fw={600} lh={1.375} style={{ letterSpacing: '-0.005em' }}>
        {assessment.summary}
      </Title>

      {assessment.rationale.trim().length > 0 && (
        <Text maw="82ch" fz={13.5} lh={1.6} c="dimmed">
          {assessment.rationale}
        </Text>
      )}

      {stats && stats.length > 0 && (
        <SimpleGrid
          component="dl"
          cols={{ base: 1, sm: 2 }}
          spacing={16}
          pt={16}
          m={0}
          style={divider}
        >
          {stats.map((stat) => (
            <Box key={stat.label} miw={0}>
              <Text component="dt" {...CAPTION} c={token('subtle')}>
                {stat.label}
              </Text>
              <Text component="dd" mt={4} m={0} ff="heading" fz={28} fw={600} lh={1}>
                {stat.value}
              </Text>
              {stat.sub && (
                <Text component="dd" mt={4} m={0} fz={12} c="dimmed">
                  {stat.sub}
                </Text>
              )}
            </Box>
          ))}
        </SimpleGrid>
      )}

      {assessment.factors.length > 0 && (
        <Box pt={16} style={divider}>
          <UnstyledButton
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            {...CAPTION}
            c={token('subtle')}
            style={{ display: 'flex', alignItems: 'center', gap: 8, letterSpacing: '0.16em' }}
          >
            <Box
              component="span"
              aria-hidden
              style={{
                display: 'inline-block',
                transition: 'transform 120ms',
                transform: open ? 'rotate(90deg)' : undefined,
              }}
            >
              ▸
            </Box>
            <span>{open ? 'Hide breakdown' : 'Show breakdown'}</span>
          </UnstyledButton>
          <Collapse expanded={open}>
            <SimpleGrid component="dl" cols={{ base: 1, sm: 2 }} spacing={12} mt={16} m={0}>
              {assessment.factors.map((factor, index) => (
                <Box key={`${factor.name}-${index}`} miw={0}>
                  <Group component="dt" gap={8} wrap="nowrap" fz={12} fw={600}>
                    <Box
                      component="span"
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        flexShrink: 0,
                        background: token(factorTone(factor.impact)),
                      }}
                    />
                    <Text component="span" fz={12} fw={600} truncate>
                      {factor.name}
                    </Text>
                  </Group>
                  <Text component="dd" mt={4} m={0} fz={12.5} lh={1.5} c="dimmed">
                    {factor.detail}
                  </Text>
                </Box>
              ))}
            </SimpleGrid>
          </Collapse>
        </Box>
      )}
    </Stack>
  );
}
