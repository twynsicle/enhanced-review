// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { SESSION_MAX_AGE_SEC } from './cookies.server';
import { shouldRoll } from './session.server';

const DAY = 24 * 60 * 60 * 1000;

describe('shouldRoll', () => {
  const now = new Date('2026-09-07T12:00:00Z');

  it('leaves a fresh session alone', () => {
    expect(shouldRoll(new Date(now.getTime() + 7 * DAY), now)).toBe(false);
    expect(shouldRoll(new Date(now.getTime() + 3.5 * DAY + 1000), now)).toBe(false);
  });

  it('rolls once less than half the lifetime remains', () => {
    expect(shouldRoll(new Date(now.getTime() + 3.5 * DAY - 1000), now)).toBe(true);
    expect(shouldRoll(new Date(now.getTime() + DAY), now)).toBe(true);
  });

  it('honours a custom lifetime', () => {
    const oneHour = 60 * 60;
    expect(shouldRoll(new Date(now.getTime() + 45 * 60 * 1000), now, oneHour)).toBe(false);
    expect(shouldRoll(new Date(now.getTime() + 20 * 60 * 1000), now, oneHour)).toBe(true);
    expect(SESSION_MAX_AGE_SEC).toBe(7 * 24 * 60 * 60);
  });
});
