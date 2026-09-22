import { Box, Group, Stack, Text, Title } from '@mantine/core';
import type {
  ReviewRiskAssessment,
  ReviewRiskFactorImpact,
  ReviewRiskScore,
} from '@/review/narrative';
import { Caption } from '@/report/chrome/caption';
import { token, type TokenName } from '@/report/theme/tokens';

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
        <Text component="span" fz={isLg ? 'sm' : 'xs'} fw={600} style={{ color: tint }}>
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
    <Text component="span" fz="sm" fw={600} style={{ color: token(RAMP[normalized]) }}>
      {normalized}/5 · {riskLabel(normalized)}
    </Text>
  );
}

function factorTone(impact: ReviewRiskFactorImpact): TokenName {
  if (impact === 'raises') return 'risk';
  if (impact === 'lowers') return 'praise';
  return 'muted-foreground';
}

/**
 * The risk assessment's body: meter, verdict, rationale, and the factors
 * behind the score.
 *
 * There is no card around it. This used to be a bordered panel wedged between
 * the summary's title and its prose, where the border was what separated risk
 * from everything else competing for the same page. Risk is its own section
 * now, so the border would draw a box around the only thing on the page —
 * furniture around nothing. The factors expand by default for the same
 * reason: they are the argument for the score, not an aside to it.
 */
export function RiskAssessmentBody({ assessment }: { assessment: ReviewRiskAssessment }) {
  return (
    <>
      <Stack gap={16}>
        <RiskScoreBars score={assessment.score} size="lg" />

        <Title order={2} fz="xl" fw={600} lh={1.25} style={{ textWrap: 'pretty' }}>
          {assessment.summary}
        </Title>

        {assessment.rationale.trim().length > 0 && (
          <Text fz="md" c="dimmed">
            {assessment.rationale}
          </Text>
        )}
      </Stack>

      {assessment.factors.length > 0 && (
        <Stack component="section" gap={16}>
          <Group
            component="header"
            justify="space-between"
            align="baseline"
            pb={8}
            style={{ borderBottom: `1px solid ${token('border')}` }}
          >
            <Caption>What moved the score</Caption>
            <Text component="span" ff="monospace" fz="xs" c="dimmed">
              {assessment.factors.length}
            </Text>
          </Group>
          <Stack component="dl" gap={16} m={0}>
            {assessment.factors.map((factor, index) => (
              <Box key={`${factor.name}-${index}`} miw={0}>
                <Group component="dt" gap={8} wrap="nowrap">
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
                  <Text component="span" fz="sm" fw={600} truncate>
                    {factor.name}
                  </Text>
                </Group>
                <Text component="dd" mt={4} m={0} fz="sm" c="dimmed">
                  {factor.detail}
                </Text>
              </Box>
            ))}
          </Stack>
        </Stack>
      )}
    </>
  );
}
