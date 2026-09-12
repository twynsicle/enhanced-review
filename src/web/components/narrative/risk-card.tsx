import { Stack, Title } from '@mantine/core';
import { RISK_SECTION_ID, type ReviewRiskAssessment } from '@/domain/review/narrative';
import { Caption } from '@/web/components/caption';
import classes from '@/web/components/narrative/article.module.css';
import {
  RiskAssessmentBody,
  riskLabel,
  normalizeRiskScore,
} from '@/web/components/narrative/risk-score';
import { sectionCardId, sectionHeadingId } from '@/web/components/narrative/sections';
import { DISPLAY_SIZE } from '@/web/theme/tokens';

/**
 * The risk assessment as a section of its own, alongside the summary and the
 * chapters rather than stacked inside the summary.
 *
 * It was three things deep in one scroll before — the rating, the reviewer's
 * overview and the author's PR description — none of which is a heading the
 * reader can aim at. Splitting it out is what gives the score, its rationale
 * and its factors room to be read as an argument.
 */
export function RiskCard({ assessment }: { assessment: ReviewRiskAssessment }) {
  const normalized = normalizeRiskScore(assessment.score);

  return (
    <article
      className={classes.article}
      id={sectionCardId(RISK_SECTION_ID)}
      aria-labelledby={sectionHeadingId(RISK_SECTION_ID)}
    >
      <Stack component="header" gap={12}>
        <Caption tone="before">Risk</Caption>
        <Title
          order={1}
          id={sectionHeadingId(RISK_SECTION_ID)}
          tabIndex={-1}
          fz={DISPLAY_SIZE}
          fw={600}
          lh={1.1}
          style={{ letterSpacing: '-0.02em', outline: 'none' }}
        >
          {normalized === null ? 'Risk assessment' : `${riskLabel(normalized)} risk`}
        </Title>
      </Stack>

      <RiskAssessmentBody assessment={assessment} />
    </article>
  );
}
