import { describe, expect, it } from 'vitest';
import { parseTierAnswer } from './skim-answer.ts';

const block = (json: string) => `Here are the tiers.\n<hunk_tiers>${json}</hunk_tiers>\n`;

describe('parseTierAnswer', () => {
  it('reads each hunk’s tier, and a skim hunk’s reason', () => {
    const { tiers, problems } = parseTierAnswer(
      block(
        '{"hunks":[{"id":"H0001","tier":"read"},{"id":"H0002","tier":"skim","skimReason":"call sites of the rename"}]}',
      ),
    );
    expect(problems).toEqual([]);
    expect([...tiers.values()]).toEqual([
      { id: 'H0001', tier: 'read' },
      { id: 'H0002', tier: 'skim', skimReason: 'call sites of the rename' },
    ]);
  });

  it('takes the last block, which is the answer the model settled on', () => {
    const text =
      block('{"hunks":[{"id":"H0001","tier":"skim","skimReason":"docs"}]}') +
      block('{"hunks":[{"id":"H0001","tier":"read"}]}');
    expect(parseTierAnswer(text).tiers.get('H0001')).toEqual({ id: 'H0001', tier: 'read' });
  });

  it('records what it could not read rather than guessing a tier', () => {
    const { tiers, problems } = parseTierAnswer(
      block(
        '{"hunks":[{"id":"H0001"},{"id":"H0002","tier":"maybe"},{"tier":"read"},"H0004",{"id":"H0005","tier":"skim"},{"id":"H0005","tier":"read"},{"id":"H0006","tier":"read","skimReason":"x"}]}',
      ),
    );
    expect([...tiers.keys()]).toEqual(['H0005', 'H0006']);
    expect(problems).toEqual([
      'H0001 has tier undefined, not read or skim',
      'H0002 has tier "maybe", not read or skim',
      'hunks[2] has no hunk id',
      'hunks[3] is not an object',
      'H0005 is skim with no reason',
      'H0005 is tiered twice; the first kept',
      'H0006 is read with a skim reason',
    ]);
  });

  it('reports an answer with no block, or a block that is not JSON', () => {
    expect(parseTierAnswer('I cannot tier these.').problems).toEqual([
      'no <hunk_tiers> block in the answer',
    ]);
    const broken = parseTierAnswer(block('{"hunks": [}'));
    expect(broken.tiers.size).toBe(0);
    expect(broken.problems[0]).toMatch(/^the block is not JSON/);
    expect(parseTierAnswer(block('{"tiers": []}')).problems).toEqual([
      'the block has no "hunks" array',
    ]);
  });
});
