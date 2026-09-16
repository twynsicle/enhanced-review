import { describe, expect, it } from 'vitest';
import { wheelZoomFactor } from './diagram-modal';

describe('wheelZoomFactor', () => {
  it('zooms in on a scroll up and out on a scroll down', () => {
    expect(wheelZoomFactor(-100, 0)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100, 0)).toBeLessThan(1);
  });

  it('reads a line-mode tick as the pixels it stands for', () => {
    // Firefox's mouse wheel: deltaMode 1, deltaY ±3. Untranslated that is a
    // fraction of a percent, which is a control the reader cannot feel.
    expect(wheelZoomFactor(-3, 1)).toBeCloseTo(wheelZoomFactor(-48, 0), 10);
    expect(wheelZoomFactor(-3, 1)).toBeGreaterThan(1.05);
  });

  it('reads a page-mode delta as a screenful', () => {
    // A quarter page, small enough to stay inside the clamp, so the screenful
    // it is measured against is what the assertion actually pins. A whole page
    // tick saturates and would pass whatever a page were worth.
    expect(wheelZoomFactor(-0.25, 2)).toBeCloseTo(wheelZoomFactor(-100, 0), 10);
    expect(wheelZoomFactor(-1, 2)).toBeCloseTo(wheelZoomFactor(-200, 0), 10);
  });

  it('clamps one enormous event so it cannot cross the whole range', () => {
    expect(wheelZoomFactor(-100000, 0)).toBeCloseTo(wheelZoomFactor(-200, 0), 10);
    expect(wheelZoomFactor(100000, 0)).toBeCloseTo(wheelZoomFactor(200, 0), 10);
    expect(wheelZoomFactor(-100000, 0)).toBeLessThan(1.5);
  });

  it('leaves the view alone when there is no usable delta', () => {
    expect(wheelZoomFactor(0, 0)).toBe(1);
    expect(wheelZoomFactor(Number.NaN, 0)).toBe(1);
  });
});
