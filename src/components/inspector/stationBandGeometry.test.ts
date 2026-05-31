import { describe, it, expect } from 'vitest';
import { stationBandLayout, STATION_ROW_H, GAP_ROW_H, BAND_W } from './stationBandGeometry';
import { makeDoc, makeStation, makeLine, makeStop } from '../../test/fixtures';
import type { LineStyle } from '../../model/types';

const docWith = (ids: string[], segmentStyles: Record<string, LineStyle> = {}) =>
  makeDoc({
    stations: ids.map((id) => makeStation({ id, stops: [makeStop('L1')] })),
    lines: [makeLine({ id: 'L1', stations: ids, segmentStyles })],
  });

describe('stationBandLayout', () => {
  it('computes row centers, total height, and capped end segments', () => {
    const doc = docWith(['a', 'b', 'c']);
    const layout = stationBandLayout(doc.lines.L1, doc.stations);
    const step = STATION_ROW_H + GAP_ROW_H;
    const cap = BAND_W / 2;
    expect(layout.centerOf(0)).toBe(STATION_ROW_H / 2);
    expect(layout.centerOf(1)).toBe(step + STATION_ROW_H / 2);
    expect(layout.totalHeight).toBe(3 * STATION_ROW_H + 2 * GAP_ROW_H);
    expect(layout.segments).toHaveLength(2);
    // First segment caps above the first dot; last caps below the last dot.
    expect(layout.segments[0]).toMatchObject({ sid: 'a', nextSid: 'b', style: 'solid' });
    expect(layout.segments[0].y1).toBe(layout.centerOf(0) - cap);
    expect(layout.segments[1].y2).toBe(layout.centerOf(2) + cap);
  });

  it('skips segments touching a station that no longer exists', () => {
    const doc = makeDoc({
      stations: [
        makeStation({ id: 'a', stops: [makeStop('L1')] }),
        makeStation({ id: 'c', stops: [makeStop('L1')] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['a', 'ghost', 'c'] })],
    });
    expect(stationBandLayout(doc.lines.L1, doc.stations).segments).toHaveLength(0);
  });

  it('carries per-segment styles through', () => {
    const doc = docWith(['a', 'b', 'c'], { 'a|b': 'hatched' });
    const layout = stationBandLayout(doc.lines.L1, doc.stations);
    expect(layout.segments[0].style).toBe('hatched');
    expect(layout.segments[1].style).toBe('solid');
  });
});
