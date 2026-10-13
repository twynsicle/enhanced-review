import { createFadePreference } from '@/report/stores/fade';

/**
 * How far skim marks push a skim hunk back: the share of the text's strength
 * taken away, and near enough the share of the diff's band washed out behind
 * it. Whether to mark skim hunks at all is `skim-marks.ts`; this is only how
 * hard, since how faint is too faint depends on the screen, the scheme and the
 * reader. Capped at 75 because past it the text is gone, and a skim line
 * should stay readable on demand.
 *
 * Persisted raw under `er-skim-fade`, painted as `--review-skim-fade`.
 */
export const SKIM_FADE_KEY = 'er-skim-fade';

export const SKIM_FADES = { min: 20, max: 75, step: 5, default: 60 } as const;

export const { useFade: useSkimFade, follow: followSkimFade } = createFadePreference({
  key: SKIM_FADE_KEY,
  variable: '--review-skim-fade',
  range: SKIM_FADES,
});
