import { describe, expect, it } from 'vitest';
import { buildBands } from './interlining';
import { makeDoc, makeLine, makeStation, makeStop } from '../test/fixtures';

// Per-line curve radius (Line.curveRadius, missing ⇒ 24 — the retired
// doc-global default). A band's configured R comes from its member lines;
// interlined lines that disagree share the LARGEST member radius, so no line
// curves tighter than it asked for.

const stationWithStop = (id: string, lineId: string, at: { x: number; y: number }) =>
  makeStation({ id, ...at, stops: [makeStop(lineId)] });

describe('buildBands — per-line curve radius', () => {
  it('a lone line renders at its own radius', () => {
    const doc = makeDoc({
      stations: [
        stationWithStop('s1', 'L1', { x: 0, y: 0 }),
        stationWithStop('s2', 'L1', { x: 0, y: 200 }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2'], curveRadius: 40 })],
    });
    const bands = buildBands(doc.stations, doc.lines, doc.lineOrder);
    expect(bands).toHaveLength(1);
    // Single stripe on a straight corridor: no bump, no marker cap.
    expect(bands[0].radius).toBe(40);
  });

  it('a radius-less line keeps the historical default 24', () => {
    const doc = makeDoc({
      stations: [
        stationWithStop('s1', 'L1', { x: 0, y: 0 }),
        stationWithStop('s2', 'L1', { x: 0, y: 200 }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2'] })],
    });
    const bands = buildBands(doc.stations, doc.lines, doc.lineOrder);
    expect(bands).toHaveLength(1);
    expect(bands[0].radius).toBe(24);
  });

  it('interlined lines with different radii share a band at the LARGEST radius', () => {
    const twoStops = (id: string, at: { x: number; y: number }) =>
      makeStation({
        id,
        ...at,
        stops: [makeStop('L1', { col: 0 }), makeStop('L2', { col: 1 })],
      });
    const doc = makeDoc({
      stations: [twoStops('s1', { x: 0, y: 0 }), twoStops('s2', { x: 0, y: 200 })],
      lines: [
        makeLine({ id: 'L1', stations: ['s1', 's2'], curveRadius: 12 }),
        makeLine({ id: 'L2', stations: ['s1', 's2'], curveRadius: 40 }),
      ],
    });
    const bands = buildBands(doc.stations, doc.lines, doc.lineOrder);
    expect(bands).toHaveLength(1);
    expect(bands[0].lines).toHaveLength(2);
    // Straight corridor, n=2 → maxAbsOffset = STOP_SIZE/2 = 7; configured
    // R = max(12, 40) = 40, bumped for the inner stripe: 40 + 7 = 47.
    expect(bands[0].radius).toBe(47);
  });
});
