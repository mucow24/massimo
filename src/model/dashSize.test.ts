import { describe, expect, it } from 'vitest';
import {
  DASH_LENGTH_RATIO,
  DASH_WIDTH_RATIO,
  dashRenderLength,
  dashRenderWidth,
  lineDashLengthOf,
  lineDashWidthOf,
  lineUsesDashTicks,
} from './dashSize';
import { DOT_SHAPE_PRESETS } from './dotStyle';
import { makeLine, makeStop } from '../test/fixtures';

describe('lineUsesDashTicks (the dash-rows visibility predicate)', () => {
  const stationsWith = (stop: ReturnType<typeof makeStop>) => ({
    s1: { stops: [stop] },
    s2: { stops: [makeStop('L1')] },
  });

  it('false for a line with no dash defaults and no dash overrides', () => {
    const line = makeLine({ id: 'L1', stations: ['s1', 's2'] });
    expect(lineUsesDashTicks(line, stationsWith(makeStop('L1')))).toBe(false);
  });

  it('true when either line-level default is the dash shape', () => {
    const singleton = makeLine({
      id: 'L1',
      stations: ['s1', 's2'],
      singletonDotStyle: DOT_SHAPE_PRESETS.dash,
    });
    expect(lineUsesDashTicks(singleton, stationsWith(makeStop('L1')))).toBe(true);
    const multi = makeLine({
      id: 'L1',
      stations: ['s1', 's2'],
      multiDotStyle: DOT_SHAPE_PRESETS.dash,
    });
    expect(lineUsesDashTicks(multi, stationsWith(makeStop('L1')))).toBe(true);
  });

  it('true when a member stop carries an explicit dash override', () => {
    const line = makeLine({ id: 'L1', stations: ['s1', 's2'] });
    expect(
      lineUsesDashTicks(line, stationsWith(makeStop('L1', { dotStyle: DOT_SHAPE_PRESETS.dash }))),
    ).toBe(true);
  });

  it("ignores other lines' dash overrides at shared stations", () => {
    const line = makeLine({ id: 'L1', stations: ['s1', 's2'] });
    const stations = {
      s1: { stops: [makeStop('L1'), makeStop('L2', { dotStyle: DOT_SHAPE_PRESETS.dash })] },
      s2: { stops: [makeStop('L1')] },
    };
    expect(lineUsesDashTicks(line, stations)).toBe(false);
  });

  it('tolerates a member station missing from the record (mid-edit states)', () => {
    const line = makeLine({ id: 'L1', stations: ['ghost'] });
    expect(lineUsesDashTicks(line, {})).toBe(false);
  });
});

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
