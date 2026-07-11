import { describe, it, expect } from 'vitest';
import { STOP_SIZE } from '../geometry/orientation';
import {
  LINE_WIDTH_DEFAULT,
  LINE_WIDTH_MIN,
  LINE_WIDTH_SLIDER_MIN,
  LINE_WIDTH_MAX,
  canonicalLineWidth,
  lineWidthOf,
  stopHalfOf,
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
  it('rounds to an integer', () => {
    expect(canonicalLineWidth(20.4)).toBe(20);
    expect(canonicalLineWidth(20.6)).toBe(21);
  });

  it('clamps below the floor up to LINE_WIDTH_MIN', () => {
    expect(canonicalLineWidth(0)).toBe(LINE_WIDTH_MIN);
    expect(canonicalLineWidth(-5)).toBe(LINE_WIDTH_MIN);
    expect(canonicalLineWidth(0.4)).toBe(LINE_WIDTH_MIN);
  });

  it('collapses the default to undefined so it is never stored', () => {
    expect(canonicalLineWidth(LINE_WIDTH_DEFAULT)).toBeUndefined();
    expect(canonicalLineWidth(LINE_WIDTH_DEFAULT + 0.3)).toBeUndefined();
  });

  it('keeps non-default widths as the rounded integer', () => {
    expect(canonicalLineWidth(21)).toBe(21);
    expect(canonicalLineWidth(2)).toBe(2);
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

describe('stopHalfOf', () => {
  it('returns half the effective width per line id, defaulting unknown ids', () => {
    const half = stopHalfOf({ L1: { width: 28 }, L2: {} });
    expect(half('L1')).toBe(14);
    expect(half('L2')).toBe(7);
    expect(half('ghost')).toBe(7);
  });
});
