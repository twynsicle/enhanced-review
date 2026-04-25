import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('joins truthy class names', () => {
    expect(cn('a', 'b', false && 'c', undefined, 'd')).toBe('a b d');
  });

  it('merges conflicting tailwind utilities (last wins)', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });
});
