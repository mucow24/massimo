import { describe, it, expect } from 'vitest';
import { STOP_DOT_RADIUS } from '../geometry/orientation';
import {
  DOT_SIZE_DEFAULT,
  DOT_SIZE_MIN,
  DOT_SIZE_MAX,
  canonicalDotSize,
  dotSizeOverride,
  resolveDotSize,
  lineDefaultDotSizeOf,
} from './dotSize';

describe('dot size constants', () => {
  it('defaults to the integer diameter 8 (2 × STOP_DOT_RADIUS, pinned to 4)', () => {
    // The pin matters: an integer default is what makes "value equals
    // default" reachable from the step-1 slider.
    expect(STOP_DOT_RADIUS).toBe(4);
    expect(DOT_SIZE_DEFAULT).toBe(2 * STOP_DOT_RADIUS);
    expect(DOT_SIZE_DEFAULT).toBe(8);
  });

  it('clamp floor is 0 (invisible is legal); slider max is 20', () => {
    expect(DOT_SIZE_MIN).toBe(0);
    expect(DOT_SIZE_MAX).toBe(20);
  });
});

describe('canonicalDotSize', () => {
  it('rounds and clamps to the floor DOT_SIZE_MIN (0 is a legal, visible-free dot)', () => {
    expect(canonicalDotSize(10.4)).toBe(10);
    expect(canonicalDotSize(10.6)).toBe(11);
    expect(canonicalDotSize(-3)).toBe(DOT_SIZE_MIN);
    expect(DOT_SIZE_MIN).toBe(0);
  });

  it('collapses to undefined at the global default when no dropAt is given', () => {
    expect(canonicalDotSize(DOT_SIZE_DEFAULT)).toBeUndefined();
    expect(canonicalDotSize(12)).toBe(12);
  });

  it('collapses at the supplied effective default (per-stop override case)', () => {
    // A stop whose size equals the line's effective default is redundant.
    expect(canonicalDotSize(12, 12)).toBeUndefined();
    // ...but the SAME value is kept when it differs from that default.
    expect(canonicalDotSize(12, DOT_SIZE_DEFAULT)).toBe(12);
    // The global default is a real stored value when the line's default differs.
    expect(canonicalDotSize(DOT_SIZE_DEFAULT, 12)).toBe(DOT_SIZE_DEFAULT);
  });
});

describe('dotSizeOverride', () => {
  it('prefers the stop override over the line default', () => {
    expect(dotSizeOverride({ defaultDotSize: 10 }, { dotSize: 16 })).toBe(16);
  });

  it('falls back to the line default when the stop has none', () => {
    expect(dotSizeOverride({ defaultDotSize: 10 }, {})).toBe(10);
    expect(dotSizeOverride({ defaultDotSize: 10 }, undefined)).toBe(10);
  });

  it('is undefined when fully tracking defaults — the renderer keeps its per-style radii', () => {
    // Load-bearing: collapsing this to DOT_SIZE_DEFAULT would shrink
    // default-tracking service-code discs from r 6 to r 4.
    expect(dotSizeOverride({}, {})).toBeUndefined();
    expect(dotSizeOverride(undefined, undefined)).toBeUndefined();
  });
});

describe('resolveDotSize', () => {
  it('resolves the override chain for UI display', () => {
    expect(resolveDotSize({ defaultDotSize: 10 }, { dotSize: 16 })).toBe(16);
    expect(resolveDotSize({ defaultDotSize: 10 }, {})).toBe(10);
  });

  it('falls back to DOT_SIZE_DEFAULT only when fully tracking', () => {
    expect(resolveDotSize({}, {})).toBe(DOT_SIZE_DEFAULT);
    expect(resolveDotSize(undefined, undefined)).toBe(DOT_SIZE_DEFAULT);
  });
});

describe('lineDefaultDotSizeOf', () => {
  it('reads the stored default when present', () => {
    expect(lineDefaultDotSizeOf({ defaultDotSize: 12 })).toBe(12);
  });

  it('falls back to the default for a size-less line, null, and undefined', () => {
    expect(lineDefaultDotSizeOf({})).toBe(DOT_SIZE_DEFAULT);
    expect(lineDefaultDotSizeOf(null)).toBe(DOT_SIZE_DEFAULT);
    expect(lineDefaultDotSizeOf(undefined)).toBe(DOT_SIZE_DEFAULT);
  });
});
