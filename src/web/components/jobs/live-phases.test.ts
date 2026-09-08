import { describe, expect, it } from 'vitest';
import { derivePhases, phaseEyebrow, phaseHeading } from './live-phases';
import { whatNowFor } from './what-now';

const empty = { titles: [], inProgressTitle: null };
const states = (phases: ReturnType<typeof derivePhases>) => phases.map((p) => p.state);

describe('derivePhases', () => {
  it('pending: setting up is active, the rest pending', () => {
    const phases = derivePhases({
      status: 'pending',
      startedAt: null,
      completedAt: null,
      chunkCount: 0,
      snapshot: empty,
    });
    expect(states(phases)).toEqual(['active', 'pending', 'pending']);
    expect(phases[0]?.stamp).toBe('now');
    expect(phases[2]?.detail).toBe('Pending — starts when reading settles.');
  });

  it('running without chunks: reading the diff is active', () => {
    const phases = derivePhases({
      status: 'running',
      startedAt: '2026-01-01T00:00:00Z',
      completedAt: null,
      chunkCount: 0,
      snapshot: empty,
    });
    expect(states(phases)).toEqual(['done', 'active', 'pending']);
    expect(phases[1]?.detail).toBe('Mapping changed files…');
  });

  it('running with chunks: composing shows the streamed titles and a cursor', () => {
    const phases = derivePhases({
      status: 'running',
      startedAt: '2026-01-01T00:00:00Z',
      completedAt: null,
      chunkCount: 3,
      snapshot: { titles: ['Intro', 'Auth'], inProgressTitle: 'Tes' },
    });
    expect(states(phases)).toEqual(['done', 'done', 'active']);
    // The in-progress title counts.
    expect(phases[2]?.detail).toBe('3 chapters so far.');
    expect(phases[2]?.titles).toEqual([
      { state: 'done', text: 'Intro' },
      { state: 'done', text: 'Auth' },
      { state: 'active', text: 'Tes' },
    ]);
  });

  it('done: totals the duration and folds the last title in', () => {
    const phases = derivePhases({
      status: 'done',
      startedAt: '2026-01-01T00:00:00Z',
      completedAt: '2026-01-01T00:00:32.9Z',
      chunkCount: 9,
      snapshot: { titles: ['Intro'], inProgressTitle: 'Cut off' },
    });
    expect(states(phases)).toEqual(['done', 'done', 'done']);
    expect(phases[2]?.stamp).toBe('32s');
    expect(phases[2]?.detail).toBe('2 chapters finalized.');
    expect(phases[2]?.titles).toBeUndefined();
  });

  it('error and cancelled land on the composing phase', () => {
    const errored = derivePhases({
      status: 'error',
      startedAt: null,
      completedAt: null,
      chunkCount: 0,
      snapshot: empty,
    });
    expect(states(errored)).toEqual(['done', 'done', 'error']);
    expect(errored[2]?.detail).toBe('Streaming halted — see error below.');
    const cancelled = derivePhases({
      status: 'cancelled',
      startedAt: null,
      completedAt: null,
      chunkCount: 2,
      snapshot: empty,
    });
    expect(cancelled[2]?.state).toBe('cancelled');
    expect(cancelled[2]?.detail).toBe('Cancelled · partial output preserved.');
  });
});

describe('eyebrow and heading', () => {
  const pr = {
    kind: 'pr' as const,
    owner: 'o',
    repo: 'r',
    number: 1,
    headSha: 'h',
    baseSha: 'b',
    title: 'Add thing',
  };
  it('follows the status', () => {
    expect(phaseEyebrow('running')).toBe('Composing your review');
    expect(phaseEyebrow('done')).toBe('Review complete');
    expect(phaseEyebrow('error')).toBe('Review errored');
    expect(phaseEyebrow('cancelled')).toBe('Review cancelled');
    expect(phaseHeading('running', pr)).toBe('Reading Add thing');
    expect(phaseHeading('done', pr)).toBe('Read Add thing');
    expect(phaseHeading('running', { ...pr, kind: 'branch', ref: 'feat/x', baseRef: 'main' })).toBe(
      'Reading feat/x',
    );
  });
});

describe('whatNowFor', () => {
  it('matches the expected prefixes', () => {
    expect(whatNowFor('timeout: exceeded 20m')).toMatch(/time limit/);
    expect(whatNowFor('token rejected')).toMatch(/re-link/);
    expect(whatNowFor('clone: head sha mismatch')).toMatch(/PR moved/);
    expect(whatNowFor('git: exit 128')).toMatch(/Clone failed/);
    // `git` is tested before `github`, so a `github:` failure still reads as a
    // clone failure rather than falling through.
    expect(whatNowFor('github: 502')).toMatch(/Clone failed/);
    expect(whatNowFor('stream cap exceeded')).toMatch(/streaming cap/);
    expect(whatNowFor('executor: parse failed')).toMatch(/unparseable/);
    expect(whatNowFor('something else')).toMatch(/Click Re-run/);
  });
});
