import { describe, expect, it } from 'vitest';
import {
  DASH_LENGTH_RATIO,
  DASH_WIDTH_RATIO,
  dashRenderLength,
  dashRenderWidth,
  lineDashLengthOf,
  lineDashWidthOf,
} from './dashSize';

describe('dash dimension resolution', () => {
  it('derives both dimensions from the line width when unset', () => {
    expect(dashRenderLength({ width: 20 })).toBe(20 * DASH_LENGTH_RATIO);
    expect(dashRenderWidth({ width: 20 })).toBe(20 * DASH_WIDTH_RATIO);
  });

  it('a default-width line (field absent) derives from LINE_WIDTH_DEFAULT', () => {
    // LINE_WIDTH_DEFAULT = 14; ratios 1.0 / 0.5 keep the TfL proportions.
    expect(dashRenderLength({})).toBe(14);
    expect(dashRenderWidth({})).toBe(7);
    expect(dashRenderLength(undefined)).toBe(14);
    expect(dashRenderWidth(null)).toBe(7);
  });

  it('an explicit stored value wins over the width derivation', () => {
    expect(dashRenderLength({ width: 20, dashLength: 5 })).toBe(5);
    expect(dashRenderWidth({ width: 20, dashWidth: 3 })).toBe(3);
    // …and the two dimensions resolve independently.
    expect(dashRenderLength({ width: 20, dashWidth: 3 })).toBe(20);
    expect(dashRenderWidth({ width: 20, dashLength: 5 })).toBe(10);
  });

  it('raw getters return only the stored field (undefined = derive at render)', () => {
    expect(lineDashLengthOf({ dashLength: 5 })).toBe(5);
    expect(lineDashLengthOf({})).toBeUndefined();
    expect(lineDashLengthOf(undefined)).toBeUndefined();
    expect(lineDashWidthOf({ dashWidth: 3 })).toBe(3);
    expect(lineDashWidthOf(null)).toBeUndefined();
  });
});
