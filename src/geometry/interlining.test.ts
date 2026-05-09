import { describe, it, expect } from 'vitest';
import { buildBands, buildLineIndex, buildStopMarkers } from './interlining';
import { makeDoc, makeLine, makeStation, makeStop, stationWithStop } from '../test/fixtures';

describe('buildLineIndex', () => {
  it('numbers IDs in lineOrder front-to-back', () => {
    const lines = {
      a: makeLine({ id: 'a' }),
      b: makeLine({ id: 'b' }),
      c: makeLine({ id: 'c' }),
    };
    expect(buildLineIndex(['c', 'a', 'b'], lines)).toEqual({ c: 0, a: 1, b: 2 });
  });

  it('appends IDs missing from lineOrder', () => {
    const lines = {
      a: makeLine({ id: 'a' }),
      b: makeLine({ id: 'b' }),
    };
    const idx = buildLineIndex(['a'], lines);
    expect(idx.a).toBe(0);
    expect(idx.b).toBe(1);
  });

  it('filters dead IDs out of lineOrder', () => {
    const lines = { a: makeLine({ id: 'a' }) };
    const idx = buildLineIndex(['ghost', 'a'], lines);
    expect(idx).toEqual({ a: 0 });
  });
});

describe('buildBands — single line', () => {
  it('produces one band with one path for a 2-station line', () => {
    const doc = makeDoc({
      stations: [
        stationWithStop('s1', 'L1', { x: 0, y: 0 }),
        stationWithStop('s2', 'L1', { x: 0, y: 100 }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2'] })],
    });
    const bands = buildBands(doc.stations, doc.lines, 24, doc.lineOrder);
    expect(bands).toHaveLength(1);
    expect(bands[0].lines).toHaveLength(1);
    expect(bands[0].paths).toHaveLength(1);
    expect(bands[0].fromId).toBe('s1');
    expect(bands[0].toId).toBe('s2');
  });

  it('skips segments with a missing stop cell on either end', () => {
    const doc = makeDoc({
      stations: [
        stationWithStop('s1', 'L1', { x: 0, y: 0 }),
        // s2 has no stop cell for L1
        makeStation({ id: 's2', x: 0, y: 100 }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2'] })],
    });
    const bands = buildBands(doc.stations, doc.lines, 24, doc.lineOrder);
    expect(bands).toHaveLength(0);
  });
});

describe('buildBands — interlining', () => {
  it('merges two parallel-adjacent lines on a shared pair into one band', () => {
    // Two stations, both with stops for L1 at col=0 and L2 at col=1 (adjacent
    // perpendicular to vertical travel). Same axis → single band, 2 paths.
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          x: 0,
          y: 0,
          stops: [makeStop('L1', { col: 0 }), makeStop('L2', { col: 1 })],
        }),
        makeStation({
          id: 's2',
          x: 0,
          y: 100,
          stops: [makeStop('L1', { col: 0 }), makeStop('L2', { col: 1 })],
        }),
      ],
      lines: [
        makeLine({ id: 'L1', stations: ['s1', 's2'] }),
        makeLine({ id: 'L2', stations: ['s1', 's2'] }),
      ],
    });
    const bands = buildBands(doc.stations, doc.lines, 24, doc.lineOrder);
    expect(bands).toHaveLength(1);
    expect(bands[0].lines).toHaveLength(2);
    expect(bands[0].paths).toHaveLength(2);
  });

  it('merges opposite-traverse lines on the same axis into one band', () => {
    // L1 traverses s1→s2; L2 traverses s2→s1. Same world axis → one band.
    // (Regression for the interline-bands-across-opposite-direction fix.)
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          x: 0,
          y: 0,
          stops: [makeStop('L1', { col: 0 }), makeStop('L2', { col: 1 })],
        }),
        makeStation({
          id: 's2',
          x: 0,
          y: 100,
          stops: [makeStop('L1', { col: 0 }), makeStop('L2', { col: 1 })],
        }),
      ],
      lines: [
        makeLine({ id: 'L1', stations: ['s1', 's2'] }),
        makeLine({ id: 'L2', stations: ['s2', 's1'] }),
      ],
    });
    const bands = buildBands(doc.stations, doc.lines, 24, doc.lineOrder);
    expect(bands).toHaveLength(1);
    expect(bands[0].lines).toHaveLength(2);
  });

  it('keeps non-adjacent lines on a shared pair in separate bands', () => {
    // L1 at col=0, L2 at col=5 (non-adjacent → no interline merge).
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          x: 0,
          y: 0,
          stops: [makeStop('L1', { col: 0 }), makeStop('L2', { col: 5 })],
        }),
        makeStation({
          id: 's2',
          x: 0,
          y: 100,
          stops: [makeStop('L1', { col: 0 }), makeStop('L2', { col: 5 })],
        }),
      ],
      lines: [
        makeLine({ id: 'L1', stations: ['s1', 's2'] }),
        makeLine({ id: 'L2', stations: ['s1', 's2'] }),
      ],
    });
    const bands = buildBands(doc.stations, doc.lines, 24, doc.lineOrder);
    expect(bands).toHaveLength(2);
  });
});

describe('buildBands — priority', () => {
  it('assigns the front-most line index as the band priority', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          x: 0,
          y: 0,
          stops: [makeStop('L1', { col: 0 }), makeStop('L2', { col: 1 })],
        }),
        makeStation({
          id: 's2',
          x: 0,
          y: 100,
          stops: [makeStop('L1', { col: 0 }), makeStop('L2', { col: 1 })],
        }),
      ],
      lines: [
        makeLine({ id: 'L1', stations: ['s1', 's2'] }),
        makeLine({ id: 'L2', stations: ['s1', 's2'] }),
      ],
      lineOrder: ['L2', 'L1'], // L2 in front
    });
    const bands = buildBands(doc.stations, doc.lines, 24, doc.lineOrder);
    expect(bands).toHaveLength(1);
    expect(bands[0].priority).toBe(0); // min(L2=0, L1=1)
  });
});

describe('buildStopMarkers', () => {
  it('emits one marker per stop cell across all stations', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          x: 0,
          y: 0,
          stops: [makeStop('L1'), makeStop('L2', { col: 1 })],
        }),
        stationWithStop('s2', 'L1', { x: 0, y: 100 }),
      ],
      lines: [makeLine({ id: 'L1' }), makeLine({ id: 'L2' })],
    });
    const markers = buildStopMarkers(doc.stations, doc.lines, doc.lineOrder);
    expect(markers).toHaveLength(3);
  });

  it('encodes the station rotation as degrees in rotationDeg', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          x: 0,
          y: 0,
          rotation: 2, // 90°
          stops: [makeStop('L1')],
        }),
      ],
      lines: [makeLine({ id: 'L1' })],
    });
    const markers = buildStopMarkers(doc.stations, doc.lines, doc.lineOrder);
    expect(markers).toHaveLength(1);
    expect(markers[0].rotationDeg).toBe(90);
  });

  it('skips stop cells whose line was deleted', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          x: 0,
          y: 0,
          stops: [makeStop('ghost')],
        }),
      ],
      lines: [],
    });
    const markers = buildStopMarkers(doc.stations, doc.lines, doc.lineOrder);
    expect(markers).toHaveLength(0);
  });

  describe('style derivation from segmentStyles', () => {
    const lineThrough = (segmentStyles?: Record<string, 'solid' | 'dashed' | 'hatched'>) =>
      makeLine({ id: 'L1', stations: ['s1', 's2', 's3'], segmentStyles });
    const docWith = (segmentStyles?: Record<string, 'solid' | 'dashed' | 'hatched'>) =>
      makeDoc({
        stations: [
          stationWithStop('s1', 'L1', { x: 0, y: 0 }),
          stationWithStop('s2', 'L1', { x: 100, y: 0 }),
          stationWithStop('s3', 'L1', { x: 200, y: 0 }),
        ],
        lines: [lineThrough(segmentStyles)],
      });
    const markerForStation = (
      doc: ReturnType<typeof docWith>,
      stationId: string,
      lineId = 'L1',
    ) => {
      const ms = buildStopMarkers(doc.stations, doc.lines, doc.lineOrder);
      const station = doc.stations[stationId];
      return ms.find(
        (m) => m.lineId === lineId && Math.abs(m.cx - station.x) < 1 && Math.abs(m.cy - station.y) < 1,
      );
    };

    it('defaults to solid when no segmentStyles are set', () => {
      const doc = docWith();
      expect(markerForStation(doc, 's2')?.style).toBe('solid');
    });

    it('hatched if any incident adjacency is hatched (interior station)', () => {
      const doc = docWith({ 's1|s2': 'hatched' });
      expect(markerForStation(doc, 's2')?.style).toBe('hatched');
    });

    it('hatched at a terminus when its only adjacency is hatched', () => {
      const doc = docWith({ 's1|s2': 'hatched' });
      expect(markerForStation(doc, 's1')?.style).toBe('hatched');
    });

    it('hatched wins over dashed at a junction (one hatched + one dashed adjacency)', () => {
      const doc = docWith({ 's1|s2': 'hatched', 's2|s3': 'dashed' });
      expect(markerForStation(doc, 's2')?.style).toBe('hatched');
    });

    it('dashed only when EVERY adjacency is dashed (interior between two dashed)', () => {
      const doc = docWith({ 's1|s2': 'dashed', 's2|s3': 'dashed' });
      expect(markerForStation(doc, 's2')?.style).toBe('dashed');
    });

    it('solid at an interior station with one dashed and one solid adjacency', () => {
      const doc = docWith({ 's1|s2': 'dashed' });
      expect(markerForStation(doc, 's2')?.style).toBe('solid');
    });

    it('dashed at a terminus when its only adjacency is dashed', () => {
      const doc = docWith({ 's1|s2': 'dashed' });
      expect(markerForStation(doc, 's1')?.style).toBe('dashed');
    });
  });

  describe('outward direction (dashed terminus cap-extension)', () => {
    const dashedDoc = () =>
      makeDoc({
        stations: [
          stationWithStop('s1', 'L1', { x: 0, y: 0 }),
          stationWithStop('s2', 'L1', { x: 100, y: 0 }),
          stationWithStop('s3', 'L1', { x: 200, y: 0 }),
        ],
        lines: [
          makeLine({
            id: 'L1',
            stations: ['s1', 's2', 's3'],
            segmentStyles: { 's1|s2': 'dashed', 's2|s3': 'dashed' },
          }),
        ],
      });
    const findMarker = (
      doc: ReturnType<typeof dashedDoc>,
      stationId: string,
    ) => {
      const bands = buildBands(doc.stations, doc.lines, 24, doc.lineOrder);
      const ms = buildStopMarkers(doc.stations, doc.lines, doc.lineOrder, bands);
      const st = doc.stations[stationId];
      return ms.find(
        (m) => m.lineId === 'L1' && Math.abs(m.cx - st.x) < 1 && Math.abs(m.cy - st.y) < 1,
      );
    };

    it('outward at the start terminus points away from the next station', () => {
      const doc = dashedDoc();
      const m = findMarker(doc, 's1');
      // s1 is at (0,0); the line continues to s2 at (100,0). Outward (-x).
      expect(m?.outward?.x).toBeLessThan(0);
      expect(Math.abs(m?.outward?.y ?? 1)).toBeLessThan(0.01);
    });

    it('outward at the end terminus points away from the previous station', () => {
      const doc = dashedDoc();
      const m = findMarker(doc, 's3');
      // s3 is at (200,0); the line came from s2 at (100,0). Outward (+x).
      expect(m?.outward?.x).toBeGreaterThan(0);
      expect(Math.abs(m?.outward?.y ?? 1)).toBeLessThan(0.01);
    });

    it('outward is null at an interior dashed station', () => {
      const doc = dashedDoc();
      expect(findMarker(doc, 's2')?.outward).toBeNull();
    });

    it('outward is null on a non-dashed terminus', () => {
      const doc = makeDoc({
        stations: [
          stationWithStop('s1', 'L1', { x: 0, y: 0 }),
          stationWithStop('s2', 'L1', { x: 100, y: 0 }),
        ],
        lines: [makeLine({ id: 'L1', stations: ['s1', 's2'] })],
      });
      expect(findMarker(doc, 's1')?.outward).toBeNull();
    });

    it('outward is null when bands are not supplied', () => {
      const doc = dashedDoc();
      // Calling without bands — terminus marker has no source for tangent.
      const ms = buildStopMarkers(doc.stations, doc.lines, doc.lineOrder);
      const m = ms.find((x) => x.lineId === 'L1' && Math.abs(x.cx) < 1);
      expect(m?.outward).toBeNull();
    });
  });
});
