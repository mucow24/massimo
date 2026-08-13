import { describe, it, expect } from 'vitest';
import { STOP_SIZE } from '../geometry/orientation';
import {
  LINE_WIDTH_DEFAULT,
  LINE_WIDTH_MIN,
  LINE_WIDTH_SLIDER_MIN,
  LINE_WIDTH_MAX,
  canonicalLineWidth,
  lineWidthOf,
} from './lineWidth';

describe('line width constants', () => {
  it('defaults to the historical stripe width (STOP_SIZE)', () => {
    expect(LINE_WIDTH_DEFAULT).toBe(STOP_SIZE);
    expect(LINE_WIDTH_DEFAULT).toBe(14);
  });

  it('clamp floor is 1; slider range is 2..28', () => {
    expect(LINE_WIDTH_MIN).toBe(1);
    expect(LINE_WIDTH_SLIDER_MIN).toBe(2);
    expect(LINE_WIDTH_MAX).toBe(28);
  });
});

describe('canonicalLineWidth', () => {
  it('keeps the width it is given — LINE_WIDTH_STEP is the control, not a filter', () => {
    expect(canonicalLineWidth(20.1)).toBe(20.1);
    expect(canonicalLineWidth(20.2)).toBe(20.2);
    expect(canonicalLineWidth(20.25)).toBe(20.25);
    expect(canonicalLineWidth(20.32455)).toBe(20.32455);
  });

  it('clamps below the floor up to LINE_WIDTH_MIN', () => {
    expect(canonicalLineWidth(0)).toBe(LINE_WIDTH_MIN);
    expect(canonicalLineWidth(-5)).toBe(LINE_WIDTH_MIN);
    expect(canonicalLineWidth(0.4)).toBe(LINE_WIDTH_MIN);
    // Just above the floor is kept, not rounded down to it.
    expect(canonicalLineWidth(1.4)).toBe(1.4);
  });

  it('collapses the default to undefined so it is never stored', () => {
    expect(canonicalLineWidth(LINE_WIDTH_DEFAULT)).toBeUndefined();
    // Only the default EXACTLY — a hair off it is a real, stored width.
    expect(canonicalLineWidth(LINE_WIDTH_DEFAULT + 0.1)).toBe(LINE_WIDTH_DEFAULT + 0.1);
  });

  it('keeps non-default widths', () => {
    expect(canonicalLineWidth(21)).toBe(21);
    expect(canonicalLineWidth(2)).toBe(2);
    expect(canonicalLineWidth(2.75)).toBe(2.75);
  });
});

describe('lineWidthOf', () => {
  it('reads the stored width when present', () => {
    expect(lineWidthOf({ width: 21 })).toBe(21);
  });

  it('falls back to the default for a width-less line, null, and undefined', () => {
    expect(lineWidthOf({})).toBe(LINE_WIDTH_DEFAULT);
    expect(lineWidthOf(null)).toBe(LINE_WIDTH_DEFAULT);
    expect(lineWidthOf(undefined)).toBe(LINE_WIDTH_DEFAULT);
  });
});
