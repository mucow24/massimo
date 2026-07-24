import { describe, it, expect } from 'vitest';
import { clamp, roundClamp, snapToStep } from './grid';

describe('clamp', () => {
  it('passes an in-range value through untouched', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    // Exact float preserved — no rounding.
    expect(clamp(0.30000000000000004, 0, 1)).toBe(0.30000000000000004);
  });

  it('clamps to the lower and upper bounds', () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(-2, -1, 1)).toBe(-1);
    expect(clamp(2, -1, 1)).toBe(1);
  });

  it('returns the boundary values exactly at the edges', () => {
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });
});

describe('roundClamp', () => {
  it('rounds to the step grid and clamps at the bottom only', () => {
    expect(roundClamp(1.13, 0.25, 0)).toBe(1.25);
    expect(roundClamp(-5, 0.25, 0)).toBe(0);
    expect(roundClamp(1000, 0.25, 0)).toBe(1000); // no upper clamp
  });

  it('kills binary float artifacts to three decimals', () => {
    expect(roundClamp(1.15, 0.05, 0)).toBe(1.15);
  });

  it('does NOT guard finiteness — that is the callers job (unlike snapToStep)', () => {
    // The per-field canonicalizers own the finiteness guard because they
    // diverge on non-finite input, so the shared primitive must pass NaN
    // through rather than swallow it to `min`.
    expect(roundClamp(NaN, 0.25, 3)).toBeNaN();
  });
});

describe('snapToStep', () => {
  it('snaps to the nearest multiple of the step', () => {
    expect(snapToStep(1.1, 0.25, 0)).toBe(1);
    expect(snapToStep(1.13, 0.25, 0)).toBe(1.25);
    expect(snapToStep(7.4, 1, 0)).toBe(7);
  });

  it('clamps at the min but never at the top', () => {
    expect(snapToStep(-5, 0.25, 0)).toBe(0);
    expect(snapToStep(0.1, 0.25, 2)).toBe(2);
    expect(snapToStep(1000, 0.25, 0)).toBe(1000); // no upper clamp
  });

  it('kills binary float artifacts to three decimals', () => {
    // Both inputs are already on the 0.05 grid, but the raw round-trip lands on
    // a float artifact (14 * 0.05 = 0.7000000000000001, 23 * 0.05 =
    // 1.1500000000000001); the ×1000 rounding cleans them.
    expect(snapToStep(0.7, 0.05, 0)).toBe(0.7);
    expect(snapToStep(1.15, 0.05, 0)).toBe(1.15);
  });

  it('preserves a legitimate third decimal (finest 0.001 step)', () => {
    expect(snapToStep(0.123, 0.001, 0)).toBe(0.123);
  });

  it('falls back to min on a non-finite input', () => {
    expect(snapToStep(NaN, 0.25, 3)).toBe(3);
    expect(snapToStep(Infinity, 0.25, 3)).toBe(3);
  });
});
