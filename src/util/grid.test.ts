import { describe, it, expect } from 'vitest';
import {
  clamp,
  cleanFloat,
  clampField,
  snapToStep,
  stepDecimals,
  stepFromValue,
  rot8,
} from './grid';

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

describe('cleanFloat', () => {
  it('kills binary artifacts without quantizing', () => {
    expect(cleanFloat(0.1 + 0.2)).toBe(0.3);
    expect(cleanFloat(10.35 + 0.25)).toBe(10.6);
    expect(cleanFloat(23 * 0.05)).toBe(1.15);
  });

  it('leaves a value with real precision exactly alone', () => {
    expect(cleanFloat(0.32455)).toBe(0.32455);
    expect(cleanFloat(123.456789)).toBe(123.456789);
  });
});

describe('clampField', () => {
  it('keeps what it is given — a field value is NOT snapped to any grid', () => {
    // The bug this exists for: every dimensional setter used to round its
    // input onto the field's slider step, so typing 0.32455 gave 0.325 and
    // typing 10.2 into a quarter-step box gave 10.25.
    expect(clampField(0.32455, -1)).toBe(0.32455);
    expect(clampField(10.2, 1)).toBe(10.2);
    expect(clampField(13.129, 2)).toBe(13.129);
  });

  it('clamps at the min but never at the top', () => {
    expect(clampField(-5, 0)).toBe(0);
    expect(clampField(0.1, 2)).toBe(2);
    expect(clampField(1000, 0)).toBe(1000); // no upper clamp
  });

  it('still kills binary float artifacts', () => {
    expect(clampField(0.1 + 0.2, 0)).toBe(0.3);
  });

  it('collapses a non-finite input to min', () => {
    // Callers still decide what garbage means before calling (a transform keeps
    // the current value, a sanitizer drops the field); this is the backstop.
    expect(clampField(NaN, 3)).toBe(3);
    expect(clampField(Infinity, 3)).toBe(3);
  });
});

describe('snapToStep', () => {
  // Snapping survives only where a GESTURE wants a grid (the line-circle
  // radius drag), never for a typed field.
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

  it('kills binary float artifacts', () => {
    // Both inputs are already on the 0.05 grid, but the raw round-trip lands on
    // a float artifact (14 * 0.05 = 0.7000000000000001, 23 * 0.05 =
    // 1.1500000000000001).
    expect(snapToStep(0.7, 0.05, 0)).toBe(0.7);
    expect(snapToStep(1.15, 0.05, 0)).toBe(1.15);
  });

  it('falls back to min on a non-finite input', () => {
    expect(snapToStep(NaN, 0.25, 3)).toBe(3);
    expect(snapToStep(Infinity, 0.25, 3)).toBe(3);
  });
});

describe('stepFromValue', () => {
  it('steps along the grid anchored at min when the value is already on it', () => {
    expect(stepFromValue(16, 0.25, 1, 1)).toBe(16.25);
    expect(stepFromValue(16, 0.25, 1, -1)).toBe(15.75);
  });

  it('lands ON the grid from an off-grid value instead of carrying the offset', () => {
    // Native <input type=number> stepUp/stepDown and Radix's slider arrows both
    // do this; adding the step would walk 10.2 → 10.45 → 10.7 and never return
    // to a round number.
    expect(stepFromValue(10.2, 0.25, 1, 1)).toBe(10.25);
    expect(stepFromValue(10.25, 0.25, 1, 1)).toBe(10.5);
    expect(stepFromValue(10.2, 0.25, 1, -1)).toBe(10);
    expect(stepFromValue(10, 0.25, 1, -1)).toBe(9.75);
  });

  it('anchors the grid at min, not at zero', () => {
    // A guide-style field (min 0) and a font size (min 1) put the quarter grid
    // in the same place; a min of 0.1 shifts it.
    expect(stepFromValue(0.32455, 0.001, -0.1, 1)).toBe(0.325);
    expect(stepFromValue(0.32455, 0.001, -0.1, -1)).toBe(0.324);
  });

  it('never returns float dust', () => {
    expect(stepFromValue(1.15, 0.05, 0, 1)).toBe(1.2);
    expect(stepFromValue(0.7, 0.05, 0, -1)).toBe(0.65);
  });
});

describe('stepDecimals', () => {
  it('reads the decimals a step implies', () => {
    expect(stepDecimals(1)).toBe(0);
    expect(stepDecimals(0.5)).toBe(1);
    expect(stepDecimals(0.25)).toBe(2);
    expect(stepDecimals(0.05)).toBe(2);
    expect(stepDecimals(0.001)).toBe(3);
  });

  it('treats a non-positive or non-finite step as whole units', () => {
    expect(stepDecimals(0)).toBe(0);
    expect(stepDecimals(-1)).toBe(0);
    expect(stepDecimals(NaN)).toBe(0);
  });
});

describe('rot8', () => {
  it('passes an already-canonical octant through untouched', () => {
    for (let n = 0; n <= 7; n++) expect(rot8(n)).toBe(n);
  });

  it('wraps a negative octant up into 0..7 (unlike bare %)', () => {
    // The whole reason rot8 exists over `n % 8`: JS `%` keeps the sign, so
    // -1 % 8 === -1. A hand-edited/persisted −1 must key like 7.
    expect(rot8(-1)).toBe(7);
    expect(rot8(-8)).toBe(0);
    expect(rot8(-9)).toBe(7);
  });

  it('wraps an over-range octant down into 0..7', () => {
    expect(rot8(8)).toBe(0);
    expect(rot8(9)).toBe(1);
    expect(rot8(15)).toBe(7);
  });
});
