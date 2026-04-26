import { describe, expect, it } from 'vitest';

import { parseNarrativeReview } from './parse-narrative';

describe('parseNarrativeReview', () => {
  it('sanitizes the risk assessment fields', () => {
    const result = parseNarrativeReview(
      `<narrative_review>${JSON.stringify({
        prTitle: 'Risk test',
        overviewSummary: 'Summary',
        riskAssessment: {
          score: 4,
          summary: 'High risk because data can be affected.',
          rationale: 'The change touches persistence and lacks visible rollback detail.',
          factors: [
            {
              name: 'Data safety',
              impact: 'raises',
              detail: 'Persistence behavior changed.',
            },
            {
              name: 'Unknown',
              impact: 'unexpected',
              detail: 'Unexpected impact values fall back to neutral.',
            },
          ],
        },
        chapters: [],
      })}</narrative_review>`,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.riskAssessment).toEqual({
      score: 4,
      summary: 'High risk because data can be affected.',
      rationale: 'The change touches persistence and lacks visible rollback detail.',
      factors: [
        {
          name: 'Data safety',
          impact: 'raises',
          detail: 'Persistence behavior changed.',
        },
        {
          name: 'Unknown',
          impact: 'neutral',
          detail: 'Unexpected impact values fall back to neutral.',
        },
      ],
    });
  });

  it('omits invalid risk assessments for backwards compatibility', () => {
    const result = parseNarrativeReview(
      `<narrative_review>${JSON.stringify({
        prTitle: 'Old review',
        overviewSummary: 'Summary',
        riskAssessment: { score: 9 },
        chapters: [],
      })}</narrative_review>`,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.riskAssessment).toBeUndefined();
  });
});
