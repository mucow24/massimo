import { describe, it, expect } from 'vitest';
import { pairKeyOf } from './pairKey';

describe('pairKeyOf', () => {
  it('joins two ids with a pipe in alphabetic order', () => {
    expect(pairKeyOf('a', 'b')).toBe('a|b');
  });

  it('is commutative: argument order does not matter', () => {
    expect(pairKeyOf('b', 'a')).toBe('a|b');
    expect(pairKeyOf('s10', 's2')).toBe(pairKeyOf('s2', 's10'));
  });

  it('handles equal ids (degenerate case)', () => {
    expect(pairKeyOf('x', 'x')).toBe('x|x');
  });
});
