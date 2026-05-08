import { describe, it, expect } from 'vitest';
import * as T from './transforms';
import { makeDoc, makeLine, makeStation, makeStop, stationWithStop } from '../test/fixtures';
import type { MapDoc, RouteBullet, Station } from './types';

describe('addStation', () => {
  it('inserts a station with default rotation/stops/label at the given coords', () => {
    const doc0 = makeDoc({});
    const doc = T.addStation(doc0, 50, 100, 's1', 'Foo');
    expect(doc.stations.s1).toMatchObject({
      id: 's1',
      name: 'Foo',
      x: 50,
      y: 100,
      rotation: 0,
      stops: [],
    });
    expect(doc.stations.s1.label).toEqual({
      row: 0,
      col: -1,
      rotation: 0,
      offset: 0,
      align: 'auto',
      valign: 'middle',
    });
  });
});

describe('renameStation', () => {
  it('updates the name of an existing station', () => {
    const doc = makeDoc({ stations: [makeStation({ id: 's1', name: 'A' })] });
    expect(T.renameStation(doc, 's1', 'B').stations.s1.name).toBe('B');
  });
  it('is a no-op for missing ids', () => {
    const doc = makeDoc({});
    expect(T.renameStation(doc, 'nope', 'X')).toEqual(doc);
  });
});

describe('moveStation', () => {
  it('updates x/y while preserving the rest', () => {
    const doc = makeDoc({ stations: [makeStation({ id: 's1', x: 0, y: 0, name: 'A' })] });
    const next = T.moveStation(doc, 's1', 10, 20);
    expect(next.stations.s1).toMatchObject({ x: 10, y: 20, name: 'A' });
  });
});

describe('rotateStation', () => {
  it('cycles 0..7 and wraps', () => {
    let doc = makeDoc({ stations: [makeStation({ id: 's1', rotation: 7 })] });
    doc = T.rotateStation(doc, 's1');
    expect(doc.stations.s1.rotation).toBe(0);
  });
});

describe('rotateItemsAround', () => {
  const SQRT2_2 = Math.SQRT2 / 2;
  const st = (id: string): T.ItemRef => ({ type: 'station', id });
  const bu = (id: string): T.ItemRef => ({ type: 'bullet', id });
  const docWithBullet = (parts: {
    stations?: Station[];
    routeBullets: Record<string, RouteBullet>;
  }): MapDoc => {
    const base = makeDoc({ stations: parts.stations ?? [] });
    return { ...base, routeBullets: parts.routeBullets };
  };

  it('station pivot, station sibling: pivot stays put, sibling orbits', () => {
    const doc = makeDoc({
      stations: [
        makeStation({ id: 'p', x: 0, y: 0, rotation: 0 }),
        makeStation({ id: 's', x: 100, y: 0, rotation: 0 }),
      ],
    });
    const next = T.rotateItemsAround(doc, st('p'), [st('p'), st('s')]);
    expect(next.stations.p).toMatchObject({ rotation: 1, x: 0, y: 0 });
    expect(next.stations.s.rotation).toBe(1);
    expect(next.stations.s.x).toBeCloseTo(100 * SQRT2_2, 5);
    expect(next.stations.s.y).toBeCloseTo(100 * SQRT2_2, 5);
  });

  it('preserves relative geometry across stations', () => {
    const doc = makeDoc({
      stations: [
        makeStation({ id: 'a', x: 0, y: 0 }),
        makeStation({ id: 'b', x: 100, y: 0 }),
        makeStation({ id: 'c', x: 100, y: 100 }),
      ],
    });
    const dist = (s1: string, s2: string, d: MapDoc) => {
      const a = d.stations[s1];
      const b = d.stations[s2];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const next = T.rotateItemsAround(doc, st('a'), [st('a'), st('b'), st('c')]);
    expect(dist('a', 'b', next)).toBeCloseTo(dist('a', 'b', doc), 5);
    expect(dist('b', 'c', next)).toBeCloseTo(dist('b', 'c', doc), 5);
    expect(dist('a', 'c', next)).toBeCloseTo(dist('a', 'c', doc), 5);
  });

  it('eight rotations is an identity (stations only)', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'p', x: 50, y: 50 }), makeStation({ id: 's', x: 150, y: 50 })],
    });
    let next = doc;
    for (let i = 0; i < 8; i++) next = T.rotateItemsAround(next, st('p'), [st('p'), st('s')]);
    expect(next.stations.p.rotation).toBe(0);
    expect(next.stations.s.rotation).toBe(0);
    expect(next.stations.p.x).toBeCloseTo(50, 3);
    expect(next.stations.s.x).toBeCloseTo(150, 3);
  });

  it('no-op when pivot id is missing from the doc', () => {
    const doc = makeDoc({ stations: [makeStation({ id: 's' })] });
    expect(T.rotateItemsAround(doc, st('nope'), [st('s')])).toEqual(doc);
  });

  it('skips members that are not in the doc', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'p', x: 0, y: 0 }), makeStation({ id: 's', x: 100, y: 0 })],
    });
    const next = T.rotateItemsAround(doc, st('p'), [st('p'), st('s'), st('ghost')]);
    expect(next.stations.s.rotation).toBe(1);
    expect(Object.keys(next.stations)).toEqual(['p', 's']);
  });

  it('bullet pivot orbits a station sibling around the bullet position', () => {
    // Bullet at (0, 0), station at (100, 0). Right-click bullet → pivot.
    const doc = docWithBullet({
      stations: [makeStation({ id: 's', x: 100, y: 0, rotation: 0 })],
      routeBullets: {
        b: { id: 'b', x: 0, y: 0, rotation: 0, lineId: null, shape: 'circle', size: 12 },
      },
    });
    const next = T.rotateItemsAround(doc, bu('b'), [bu('b'), st('s')]);
    // Pivot (bullet) rotation incremented, position unchanged.
    expect(next.routeBullets.b.rotation).toBe(1);
    expect(next.routeBullets.b.x).toBe(0);
    expect(next.routeBullets.b.y).toBe(0);
    // Station orbits.
    expect(next.stations.s.rotation).toBe(1);
    expect(next.stations.s.x).toBeCloseTo(100 * SQRT2_2, 5);
    expect(next.stations.s.y).toBeCloseTo(100 * SQRT2_2, 5);
  });

  it('station pivot orbits a bullet sibling around the station position', () => {
    const doc = docWithBullet({
      stations: [makeStation({ id: 's', x: 0, y: 0, rotation: 0 })],
      routeBullets: {
        b: { id: 'b', x: 100, y: 0, rotation: 0, lineId: null, shape: 'circle', size: 12 },
      },
    });
    const next = T.rotateItemsAround(doc, st('s'), [st('s'), bu('b')]);
    expect(next.stations.s).toMatchObject({ rotation: 1, x: 0, y: 0 });
    expect(next.routeBullets.b.rotation).toBe(1);
    expect(next.routeBullets.b.x).toBeCloseTo(100 * SQRT2_2, 5);
    expect(next.routeBullets.b.y).toBeCloseTo(100 * SQRT2_2, 5);
  });

  it('mixed selection: every member rotates and orbits as one rigid body', () => {
    const doc = docWithBullet({
      stations: [makeStation({ id: 'p', x: 0, y: 0 }), makeStation({ id: 's', x: 100, y: 0 })],
      routeBullets: {
        b: { id: 'b', x: 0, y: 100, rotation: 0, lineId: null, shape: 'circle', size: 12 },
      },
    });
    const next = T.rotateItemsAround(doc, st('p'), [st('p'), st('s'), bu('b')]);
    // Pivot stays.
    expect(next.stations.p).toMatchObject({ x: 0, y: 0 });
    // Station sibling at (100, 0) → (70.71, 70.71).
    expect(next.stations.s.x).toBeCloseTo(100 * SQRT2_2, 5);
    expect(next.stations.s.y).toBeCloseTo(100 * SQRT2_2, 5);
    // Bullet sibling at (0, 100) → (-70.71, 70.71).
    expect(next.routeBullets.b.x).toBeCloseTo(-100 * SQRT2_2, 5);
    expect(next.routeBullets.b.y).toBeCloseTo(100 * SQRT2_2, 5);
  });
});

describe('rotateStationAndLayout', () => {
  it('R+ then R- is identity for rotation', () => {
    const doc0 = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          rotation: 3,
          stops: [makeStop('L1', { row: 1, col: 2, orientation: 'up' })],
          label: { row: 0, col: -1, rotation: 1, offset: 0, align: 'auto', valign: 'middle' },
        }),
      ],
    });
    const round = T.rotateStationAndLayout(T.rotateStationAndLayout(doc0, 's1', 1), 's1', -1);
    expect(round.stations.s1.rotation).toBe(doc0.stations.s1.rotation);
    expect(round.stations.s1.stops).toEqual(doc0.stations.s1.stops);
    expect(round.stations.s1.label).toEqual(doc0.stations.s1.label);
  });
});

describe('deleteStation', () => {
  it('removes the station and strips it from every line', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 's1' }), makeStation({ id: 's2' })],
      lines: [
        makeLine({ id: 'L1', stations: ['s1', 's2'] }),
        makeLine({ id: 'L2', stations: ['s1'] }),
      ],
    });
    const next = T.deleteStation(doc, 's1');
    expect(next.stations.s1).toBeUndefined();
    expect(next.stations.s2).toBeDefined();
    expect(next.lines.L1.stations).toEqual(['s2']);
    expect(next.lines.L2.stations).toEqual([]);
  });

  it('cascade-deletes transfers that reference the removed station', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 's1' }), makeStation({ id: 's2' }), makeStation({ id: 's3' })],
      transfers: [
        { id: 'x1', a: { stationId: 's1', lineId: null }, b: { stationId: 's2', lineId: null } },
        { id: 'x2', a: { stationId: 's2', lineId: null }, b: { stationId: 's3', lineId: null } },
      ],
    });
    const next = T.deleteStation(doc, 's1');
    expect(next.transfers.x1).toBeUndefined();
    expect(next.transfers.x2).toBeDefined();
  });
});

describe('addTransfer', () => {
  it('inserts a transfer between two specific dots', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 's1' }), makeStation({ id: 's2' })],
    });
    const next = T.addTransfer(
      doc,
      'x1',
      { stationId: 's1', lineId: 'L1' },
      { stationId: 's2', lineId: 'L2' },
    );
    expect(next.transfers.x1).toEqual({
      id: 'x1',
      a: { stationId: 's1', lineId: 'L1' },
      b: { stationId: 's2', lineId: 'L2' },
    });
  });

  it('accepts null lineId for stations that have no relevant stop', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 's1' }), makeStation({ id: 's2' })],
    });
    const next = T.addTransfer(
      doc,
      'x1',
      { stationId: 's1', lineId: null },
      { stationId: 's2', lineId: null },
    );
    expect(next.transfers.x1.a.lineId).toBeNull();
    expect(next.transfers.x1.b.lineId).toBeNull();
  });

  it('allows a same-station transfer between two distinct dots', () => {
    // Interlined station case: two different lines have stops on the same
    // station and the user wants a short transfer indicator between those
    // two dots. Same-station + same-lineId is the only true self-transfer.
    const doc = makeDoc({ stations: [makeStation({ id: 's1' })] });
    const next = T.addTransfer(
      doc,
      'x1',
      { stationId: 's1', lineId: 'L1' },
      { stationId: 's1', lineId: 'L2' },
    );
    expect(next.transfers.x1).toEqual({
      id: 'x1',
      a: { stationId: 's1', lineId: 'L1' },
      b: { stationId: 's1', lineId: 'L2' },
    });
  });

  it('refuses a same-station, same-lineId self-transfer', () => {
    const doc = makeDoc({ stations: [makeStation({ id: 's1' })] });
    expect(
      T.addTransfer(
        doc,
        'x1',
        { stationId: 's1', lineId: 'L1' },
        { stationId: 's1', lineId: 'L1' },
      ),
    ).toBe(doc);
    expect(
      T.addTransfer(
        doc,
        'x1',
        { stationId: 's1', lineId: null },
        { stationId: 's1', lineId: null },
      ),
    ).toBe(doc);
  });

  it('refuses if either endpoint station does not exist', () => {
    const doc = makeDoc({ stations: [makeStation({ id: 's1' })] });
    expect(
      T.addTransfer(
        doc,
        'x1',
        { stationId: 's1', lineId: null },
        { stationId: 'missing', lineId: null },
      ),
    ).toBe(doc);
  });
});

describe('deleteTransfer', () => {
  it('removes a transfer by id', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 's1' }), makeStation({ id: 's2' })],
      transfers: [
        { id: 'x1', a: { stationId: 's1', lineId: null }, b: { stationId: 's2', lineId: null } },
      ],
    });
    expect(T.deleteTransfer(doc, 'x1').transfers.x1).toBeUndefined();
  });

  it('is a no-op for unknown ids', () => {
    const doc = makeDoc({});
    expect(T.deleteTransfer(doc, 'nope')).toBe(doc);
  });
});

describe('deleteLine: transfers', () => {
  it('nulls out lineId on transfer endpoints that referenced the line', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 's1' }), makeStation({ id: 's2' })],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2'] })],
      transfers: [
        { id: 'x1', a: { stationId: 's1', lineId: 'L1' }, b: { stationId: 's2', lineId: 'L1' } },
        { id: 'x2', a: { stationId: 's1', lineId: null }, b: { stationId: 's2', lineId: 'L2' } },
      ],
    });
    const next = T.deleteLine(doc, 'L1');
    // x1 endpoints both nulled out; transfer survives.
    expect(next.transfers.x1.a.lineId).toBeNull();
    expect(next.transfers.x1.b.lineId).toBeNull();
    // x2 didn't reference L1 — untouched.
    expect(next.transfers.x2.a.lineId).toBeNull();
    expect(next.transfers.x2.b.lineId).toBe('L2');
  });
});

describe('moveStop', () => {
  it('moves a stop into an empty cell', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          stops: [makeStop('L1', { row: 0, col: 0 })],
        }),
      ],
    });
    const next = T.moveStop(doc, 's1', 'L1', 0, 1);
    expect(next.stations.s1.stops[0]).toMatchObject({ row: 0, col: 1 });
  });

  it('swaps with another stop in the destination cell', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          stops: [makeStop('L1', { row: 0, col: 0 }), makeStop('L2', { row: 0, col: 1 })],
        }),
      ],
    });
    const next = T.moveStop(doc, 's1', 'L1', 0, 1);
    const byLine = (id: string) => next.stations.s1.stops.find((c) => c.lineId === id)!;
    expect(byLine('L1')).toMatchObject({ row: 0, col: 1 });
    expect(byLine('L2')).toMatchObject({ row: 0, col: 0 });
  });

  it('refuses to move into the label cell', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          stops: [makeStop('L1', { row: 0, col: 0 })],
          label: { row: 0, col: 1, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
        }),
      ],
    });
    const next = T.moveStop(doc, 's1', 'L1', 0, 1);
    expect(next).toEqual(doc);
  });
});

describe('rotateStop', () => {
  it('toggles between auto-vertical and auto-horizontal', () => {
    let doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          stops: [makeStop('L1', { orientation: 'auto-vertical' })],
        }),
      ],
    });
    doc = T.rotateStop(doc, 's1', 'L1');
    expect(doc.stations.s1.stops[0].orientation).toBe('auto-horizontal');
    doc = T.rotateStop(doc, 's1', 'L1');
    expect(doc.stations.s1.stops[0].orientation).toBe('auto-vertical');
  });

  it('collapses explicit vertical orientations (up/down) to auto-horizontal', () => {
    for (const start of ['up', 'down'] as const) {
      const doc = makeDoc({
        stations: [
          makeStation({
            id: 's1',
            stops: [makeStop('L1', { orientation: start })],
          }),
        ],
      });
      const next = T.rotateStop(doc, 's1', 'L1');
      expect(next.stations.s1.stops[0].orientation).toBe('auto-horizontal');
    }
  });

  it('collapses explicit horizontal orientations (left/right) to auto-vertical', () => {
    for (const start of ['left', 'right'] as const) {
      const doc = makeDoc({
        stations: [
          makeStation({
            id: 's1',
            stops: [makeStop('L1', { orientation: start })],
          }),
        ],
      });
      const next = T.rotateStop(doc, 's1', 'L1');
      expect(next.stations.s1.stops[0].orientation).toBe('auto-vertical');
    }
  });
});

describe('moveLabel', () => {
  it('jumps past blocking stops', () => {
    // Label at (0, 0); stop at (0, 1). Move +col: should land at (0, 2).
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          stops: [makeStop('L1', { row: 0, col: 1 })],
          label: { row: 0, col: 0, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
        }),
      ],
    });
    const next = T.moveLabel(doc, 's1', 0, 1);
    expect(next.stations.s1.label).toMatchObject({ row: 0, col: 2 });
  });

  it('is a no-op for (0,0)', () => {
    const doc = makeDoc({ stations: [makeStation({ id: 's1' })] });
    expect(T.moveLabel(doc, 's1', 0, 0)).toEqual(doc);
  });
});

describe('rotateLabel / flipLabel', () => {
  it('rotateLabel adds 1 mod 8', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          label: { row: 0, col: -1, rotation: 7, offset: 0, align: 'auto', valign: 'middle' },
        }),
      ],
    });
    expect(T.rotateLabel(doc, 's1').stations.s1.label.rotation).toBe(0);
  });

  it('flipLabel adds 4 mod 8 without moving', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          label: { row: 5, col: 7, rotation: 1, offset: 3, align: 'auto', valign: 'middle' },
        }),
      ],
    });
    const next = T.flipLabel(doc, 's1').stations.s1.label;
    expect(next).toMatchObject({ row: 5, col: 7, rotation: 5, offset: 3 });
  });
});

describe('mirrorLabel', () => {
  it('with no stops: only flips rotation', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
        }),
      ],
    });
    const next = T.mirrorLabel(doc, 's1').stations.s1.label;
    expect(next).toMatchObject({ row: 0, col: -1, rotation: 4 });
  });

  it('with stops: moves to the opposite side of the footprint', () => {
    // Label at (0, -1), stops at (0, 0), (0, 1), (0, 2). Mirroring along
    // +col: label should end up at (0, 3).
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          stops: [
            makeStop('L1', { row: 0, col: 0 }),
            makeStop('L1', { row: 0, col: 1 }),
            makeStop('L1', { row: 0, col: 2 }),
          ],
          label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
        }),
      ],
    });
    const next = T.mirrorLabel(doc, 's1').stations.s1.label;
    expect(next).toMatchObject({ row: 0, col: 3, rotation: 4 });
  });
});

describe('setLabelOffset', () => {
  it('updates the offset only', () => {
    const doc = makeDoc({ stations: [makeStation({ id: 's1' })] });
    expect(T.setLabelOffset(doc, 's1', 12).stations.s1.label.offset).toBe(12);
  });
});

describe('addLine', () => {
  it('inserts the line at the FRONT of lineOrder', () => {
    const doc = makeDoc({
      lines: [makeLine({ id: 'A' }), makeLine({ id: 'B' })],
      lineOrder: ['A', 'B'],
    });
    const next = T.addLine(doc, 'C', 'C', '#fff');
    expect(next.lineOrder).toEqual(['C', 'A', 'B']);
    expect(next.lines.C).toMatchObject({ id: 'C', service: 'C', color: '#fff', stations: [] });
  });
});

describe('updateLine', () => {
  it('patches the named fields and leaves others alone', () => {
    const doc = makeDoc({
      lines: [makeLine({ id: 'L1', service: 'A', color: '#000', stations: ['s1'] })],
    });
    const next = T.updateLine(doc, 'L1', { service: 'B' });
    expect(next.lines.L1).toMatchObject({ service: 'B', color: '#000', stations: ['s1'] });
  });
});

describe('toggleStationOnLine', () => {
  it('adds a station + stop cell when not present', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 's1' })],
      lines: [makeLine({ id: 'L1', stations: [] })],
    });
    const next = T.toggleStationOnLine(doc, 'L1', 's1');
    expect(next.lines.L1.stations).toEqual(['s1']);
    expect(next.stations.s1.stops).toHaveLength(1);
    expect(next.stations.s1.stops[0].lineId).toBe('L1');
  });

  it('inserts at insertAfterIndex+1', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a' }), makeStation({ id: 'b' }), makeStation({ id: 'c' })],
      lines: [makeLine({ id: 'L1', stations: ['a', 'b'] })],
    });
    const next = T.toggleStationOnLine(doc, 'L1', 'c', 0);
    // After 'a' (index 0) → at position 1.
    expect(next.lines.L1.stations).toEqual(['a', 'c', 'b']);
  });

  it('removes the station + stop cell when already present (single-line case)', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          stops: [makeStop('L1')],
        }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1'] })],
    });
    const next = T.toggleStationOnLine(doc, 'L1', 's1');
    expect(next.lines.L1.stations).toEqual([]);
    expect(next.stations.s1.stops).toEqual([]);
  });
});

describe('removeStationFromLine', () => {
  it('drops the stop cell only when the station is no longer on the line', () => {
    // Station is on L1 twice; removing one occurrence keeps the stop cell.
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          stops: [makeStop('L1')],
        }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's1'] })],
    });
    const next = T.removeStationFromLine(doc, 'L1', 0);
    expect(next.lines.L1.stations).toEqual(['s1']);
    expect(next.stations.s1.stops).toHaveLength(1);
  });

  it('drops the stop cell when the last occurrence is removed', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          stops: [makeStop('L1')],
        }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1'] })],
    });
    const next = T.removeStationFromLine(doc, 'L1', 0);
    expect(next.stations.s1.stops).toEqual([]);
  });
});

describe('reorderLineStations', () => {
  it('replaces line.stations and re-runs auto-orient', () => {
    // Auto-orient: on a 2-station line of single-line stations, the rotation
    // is recomputed from line tangent.
    const doc = makeDoc({
      stations: [
        stationWithStop('s1', 'L1', { x: 0, y: 0 }),
        stationWithStop('s2', 'L1', { x: 0, y: 100 }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2'] })],
    });
    const next = T.reorderLineStations(doc, 'L1', ['s2', 's1']);
    expect(next.lines.L1.stations).toEqual(['s2', 's1']);
  });
});

describe('deleteLine', () => {
  it('removes the line, the stop cells, and the lineOrder entry', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          stops: [makeStop('L1'), makeStop('L2', { col: 1 })],
        }),
      ],
      lines: [makeLine({ id: 'L1' }), makeLine({ id: 'L2' })],
      lineOrder: ['L1', 'L2'],
    });
    const next = T.deleteLine(doc, 'L1');
    expect(next.lines.L1).toBeUndefined();
    expect(next.lines.L2).toBeDefined();
    expect(next.lineOrder).toEqual(['L2']);
    expect(next.stations.s1.stops.map((c) => c.lineId)).toEqual(['L2']);
  });
});

describe('moveLineInOrder', () => {
  it('swaps adjacent indices and clamps at boundaries', () => {
    const doc = makeDoc({
      lines: [makeLine({ id: 'A' }), makeLine({ id: 'B' }), makeLine({ id: 'C' })],
      lineOrder: ['A', 'B', 'C'],
    });
    expect(T.moveLineInOrder(doc, 'A', -1).lineOrder).toEqual(['A', 'B', 'C']); // already at front
    expect(T.moveLineInOrder(doc, 'A', 1).lineOrder).toEqual(['B', 'A', 'C']);
    expect(T.moveLineInOrder(doc, 'C', 1).lineOrder).toEqual(['A', 'B', 'C']); // already at back
  });
});

describe('setCurveRadius / clearAll', () => {
  it('setCurveRadius updates curveRadius', () => {
    const doc = makeDoc({});
    expect(T.setCurveRadius(doc, 42).curveRadius).toBe(42);
  });
  it('clearAll returns a fresh DEFAULT_DOC', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 's1' })],
      lines: [makeLine({ id: 'L1' })],
    });
    const cleared = T.clearAll(doc);
    expect(cleared.stations).toEqual({});
    expect(cleared.lines).toEqual({});
    expect(cleared.lineOrder).toEqual([]);
    expect(cleared.lineCounter).toBe(0);
  });
});

describe('label font/style settings', () => {
  it('exposes font-size bounds and default as constants', () => {
    expect(T.LABEL_FONT_SIZE_MIN).toBe(2);
    expect(T.LABEL_FONT_SIZE_MAX).toBe(24);
    expect(T.LABEL_FONT_SIZE_DEFAULT).toBe(12);
  });

  it('DEFAULT_DOC has sensible defaults', () => {
    expect(T.DEFAULT_DOC.labelFontSize).toBe(12);
    expect(T.DEFAULT_DOC.labelBold).toBe(false);
    expect(T.DEFAULT_DOC.labelItalic).toBe(false);
  });

  it('setLabelFontSize sets a valid value', () => {
    const doc = makeDoc({});
    expect(T.setLabelFontSize(doc, 16).labelFontSize).toBe(16);
  });

  it('setLabelFontSize clamps below the minimum', () => {
    const doc = makeDoc({});
    expect(T.setLabelFontSize(doc, 0).labelFontSize).toBe(2);
    expect(T.setLabelFontSize(doc, -5).labelFontSize).toBe(2);
  });

  it('setLabelFontSize clamps above the maximum', () => {
    const doc = makeDoc({});
    expect(T.setLabelFontSize(doc, 99).labelFontSize).toBe(24);
  });

  it('setLabelFontSize rounds fractional values', () => {
    const doc = makeDoc({});
    expect(T.setLabelFontSize(doc, 12.7).labelFontSize).toBe(13);
    expect(T.setLabelFontSize(doc, 12.4).labelFontSize).toBe(12);
  });

  it('setLabelBold flips the boolean', () => {
    const doc = makeDoc({});
    expect(T.setLabelBold(doc, true).labelBold).toBe(true);
    expect(T.setLabelBold(T.setLabelBold(doc, true), false).labelBold).toBe(false);
  });

  it('setLabelItalic flips the boolean', () => {
    const doc = makeDoc({});
    expect(T.setLabelItalic(doc, true).labelItalic).toBe(true);
    expect(T.setLabelItalic(T.setLabelItalic(doc, true), false).labelItalic).toBe(false);
  });
});

describe('activePalettes', () => {
  it('DEFAULT_DOC.activePalettes is exactly [mta]', () => {
    expect(T.DEFAULT_DOC.activePalettes).toEqual(['mta']);
  });

  it('setActivePalettes accepts a list and stores it in PALETTES declaration order', () => {
    const doc = makeDoc({});
    // BART precedes MTA alphabetically within North America.
    expect(T.setActivePalettes(doc, ['mta', 'bart']).activePalettes).toEqual(['bart', 'mta']);
  });

  it('setActivePalettes deduplicates input', () => {
    const doc = makeDoc({});
    expect(T.setActivePalettes(doc, ['bart', 'mta', 'mta', 'bart']).activePalettes).toEqual([
      'bart',
      'mta',
    ]);
  });

  it('setActivePalettes returns the input doc unchanged when the input is empty', () => {
    const doc = T.setActivePalettes(makeDoc({}), ['mta', 'bart']);
    expect(T.setActivePalettes(doc, [])).toBe(doc);
  });

  it('setActivePalettes returns the input doc unchanged when only unknown ids are given', () => {
    const doc = T.setActivePalettes(makeDoc({}), ['mta', 'bart']);
    // @ts-expect-error - exercising the runtime guard with an unknown id
    expect(T.setActivePalettes(doc, ['nope'])).toBe(doc);
  });

  it('togglePalette adds an absent id', () => {
    const doc = T.setActivePalettes(makeDoc({}), ['mta']);
    // Result is normalised to PALETTES order — BART precedes MTA in N. America.
    expect(T.togglePalette(doc, 'bart').activePalettes).toEqual(['bart', 'mta']);
  });

  it('togglePalette removes a present id', () => {
    const doc = T.setActivePalettes(makeDoc({}), ['mta', 'bart']);
    expect(T.togglePalette(doc, 'bart').activePalettes).toEqual(['mta']);
  });

  it('togglePalette refuses to remove the last palette (invariant)', () => {
    const doc = T.setActivePalettes(makeDoc({}), ['mta']);
    expect(T.togglePalette(doc, 'mta')).toBe(doc);
  });
});

describe('addLine — lineCounter', () => {
  it('increments lineCounter on each addLine', () => {
    let doc = makeDoc({});
    doc = T.addLine(doc, 'A', 'A', '#000');
    expect(doc.lineCounter).toBe(1);
    doc = T.addLine(doc, 'B', 'B', '#fff');
    expect(doc.lineCounter).toBe(2);
  });
});

// ---------- Line tags ----------

describe('addLineTag', () => {
  it('inserts a tag with the given fields', () => {
    const doc = makeDoc({
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2'] })],
    });
    const next = T.addLineTag(doc, 't1', 'L1', 's1', 's2', 'from', 25, 0);
    expect(next.lineTags.t1).toEqual({
      id: 't1',
      lineId: 'L1',
      fromStationId: 's1',
      toStationId: 's2',
      anchorEnd: 'from',
      distance: 25,
      orientation: 0,
    });
  });

  it('does not mutate the original doc', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    T.addLineTag(doc, 't1', 'L1', 's1', 's2', 'from', 25, 0);
    expect(doc.lineTags).toEqual({});
  });
});

describe('moveLineTag', () => {
  it('updates pair, anchor, and distance while preserving orientation', () => {
    const doc = makeDoc({
      lines: [makeLine({ id: 'L1' })],
      lineTags: [
        {
          id: 't1',
          lineId: 'L1',
          fromStationId: 's1',
          toStationId: 's2',
          anchorEnd: 'from',
          distance: 10,
          orientation: 1,
        },
      ],
    });
    const next = T.moveLineTag(doc, 't1', 's3', 's4', 'to', 50);
    expect(next.lineTags.t1).toEqual({
      id: 't1',
      lineId: 'L1',
      fromStationId: 's3',
      toStationId: 's4',
      anchorEnd: 'to',
      distance: 50,
      orientation: 1,
    });
  });

  it('is a no-op for unknown ids', () => {
    const doc = makeDoc({});
    expect(T.moveLineTag(doc, 'nope', 'a', 'b', 'from', 5)).toEqual(doc);
  });
});

describe('cycleLineTagOrientation', () => {
  it('cycles 0 → 1 → 2 → 3 → 0', () => {
    let doc = makeDoc({
      lineTags: [
        {
          id: 't1',
          lineId: 'L1',
          fromStationId: 'a',
          toStationId: 'b',
          anchorEnd: 'from',
          distance: 0,
          orientation: 0,
        },
      ],
    });
    doc = T.cycleLineTagOrientation(doc, 't1');
    expect(doc.lineTags.t1.orientation).toBe(1);
    doc = T.cycleLineTagOrientation(doc, 't1');
    expect(doc.lineTags.t1.orientation).toBe(2);
    doc = T.cycleLineTagOrientation(doc, 't1');
    expect(doc.lineTags.t1.orientation).toBe(3);
    doc = T.cycleLineTagOrientation(doc, 't1');
    expect(doc.lineTags.t1.orientation).toBe(0);
  });
});

describe('deleteLineTag', () => {
  it('removes the tag by id', () => {
    const doc = makeDoc({
      lineTags: [
        {
          id: 't1',
          lineId: 'L1',
          fromStationId: 'a',
          toStationId: 'b',
          anchorEnd: 'from',
          distance: 0,
          orientation: 0,
        },
        {
          id: 't2',
          lineId: 'L1',
          fromStationId: 'a',
          toStationId: 'b',
          anchorEnd: 'from',
          distance: 25,
          orientation: 0,
        },
      ],
    });
    const next = T.deleteLineTag(doc, 't1');
    expect(next.lineTags.t1).toBeUndefined();
    expect(next.lineTags.t2).toBeDefined();
  });
});

describe('deleteLine — line tag cascade', () => {
  it('drops tags on the deleted line; leaves others alone', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 's1', stops: [makeStop('L1'), makeStop('L2', { col: 1 })] })],
      lines: [makeLine({ id: 'L1' }), makeLine({ id: 'L2' })],
      lineOrder: ['L1', 'L2'],
      lineTags: [
        {
          id: 't1',
          lineId: 'L1',
          fromStationId: 's1',
          toStationId: 's2',
          anchorEnd: 'from',
          distance: 0,
          orientation: 0,
        },
        {
          id: 't2',
          lineId: 'L2',
          fromStationId: 's1',
          toStationId: 's2',
          anchorEnd: 'from',
          distance: 0,
          orientation: 0,
        },
      ],
    });
    const next = T.deleteLine(doc, 'L1');
    expect(next.lineTags.t1).toBeUndefined();
    expect(next.lineTags.t2).toBeDefined();
  });
});

describe('removeStationFromLine — line tag cascade', () => {
  it('drops tags whose corridor is no longer an edge on the line', () => {
    const doc = makeDoc({
      stations: [
        makeStation({ id: 's1', stops: [makeStop('L1')] }),
        makeStation({ id: 's2', stops: [makeStop('L1')] }),
        makeStation({ id: 's3', stops: [makeStop('L1')] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2', 's3'] })],
      lineTags: [
        {
          id: 't12',
          lineId: 'L1',
          fromStationId: 's1',
          toStationId: 's2',
          anchorEnd: 'from',
          distance: 25,
          orientation: 0,
        },
        {
          id: 't23',
          lineId: 'L1',
          fromStationId: 's2',
          toStationId: 's3',
          anchorEnd: 'from',
          distance: 25,
          orientation: 0,
        },
      ],
    });
    const next = T.removeStationFromLine(doc, 'L1', 1);
    expect(next.lineTags.t12).toBeUndefined();
    expect(next.lineTags.t23).toBeUndefined();
  });

  it('keeps tags whose corridor remains an edge', () => {
    const doc = makeDoc({
      stations: [
        makeStation({ id: 's1', stops: [makeStop('L1')] }),
        makeStation({ id: 's2', stops: [makeStop('L1')] }),
        makeStation({ id: 's3', stops: [makeStop('L1')] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2', 's3'] })],
      lineTags: [
        {
          id: 't12',
          lineId: 'L1',
          fromStationId: 's1',
          toStationId: 's2',
          anchorEnd: 'from',
          distance: 25,
          orientation: 0,
        },
      ],
    });
    const next = T.removeStationFromLine(doc, 'L1', 2);
    expect(next.lineTags.t12).toBeDefined();
  });
});

describe('deleteStation — line tag cascade', () => {
  it('drops tags whose corridor referenced the deleted station on any line', () => {
    const doc = makeDoc({
      stations: [
        makeStation({ id: 's1', stops: [makeStop('L1')] }),
        makeStation({ id: 's2', stops: [makeStop('L1')] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2'] })],
      lineTags: [
        {
          id: 't1',
          lineId: 'L1',
          fromStationId: 's1',
          toStationId: 's2',
          anchorEnd: 'from',
          distance: 25,
          orientation: 0,
        },
      ],
    });
    const next = T.deleteStation(doc, 's2');
    expect(next.lineTags.t1).toBeUndefined();
  });
});

describe('clearAll — line tags', () => {
  it('clears lineTags', () => {
    const doc = makeDoc({
      lineTags: [
        {
          id: 't1',
          lineId: 'L1',
          fromStationId: 'a',
          toStationId: 'b',
          anchorEnd: 'from',
          distance: 0,
          orientation: 0,
        },
      ],
    });
    expect(T.clearAll(doc).lineTags).toEqual({});
  });
});

describe('setDotShape', () => {
  it('writes the new shape onto the targeted stop only', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1'), makeStop('L2', { col: 1 })] })],
    });
    const next = T.setDotShape(doc, 'a', 'L1', 'filled-black-diamond');
    expect(next.stations.a.stops[0].dotShape).toBe('filled-black-diamond');
    expect(next.stations.a.stops[1].dotShape).toBeUndefined();
  });

  it('preserves lineId/row/col/orientation on the targeted cell', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 'a',
          stops: [makeStop('L1', { row: 2, col: 3, orientation: 'left' })],
        }),
      ],
    });
    const next = T.setDotShape(doc, 'a', 'L1', 'filled-black-diamond');
    expect(next.stations.a.stops[0]).toMatchObject({
      lineId: 'L1',
      row: 2,
      col: 3,
      orientation: 'left',
      dotShape: 'filled-black-diamond',
    });
  });

  it('leaves sibling stations untouched', () => {
    const doc = makeDoc({
      stations: [
        makeStation({ id: 'a', stops: [makeStop('L1')] }),
        makeStation({ id: 'b', stops: [makeStop('L1')] }),
      ],
    });
    const next = T.setDotShape(doc, 'a', 'L1', 'open-white');
    expect(next.stations.a.stops[0].dotShape).toBe('open-white');
    expect(next.stations.b.stops[0].dotShape).toBeUndefined();
  });

  it('silently no-ops on unknown station id', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
    });
    const next = T.setDotShape(doc, 'ghost', 'L1', 'filled-white');
    expect(next).toEqual(doc);
  });

  it('silently no-ops when the station has no stop on lineId', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
    });
    const next = T.setDotShape(doc, 'a', 'L99', 'open-white');
    expect(next).toEqual(doc);
  });

  it("'none' is a plain assignment, not a removal", () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
    });
    const next = T.setDotShape(doc, 'a', 'L1', 'none');
    expect(next.stations.a.stops[0].dotShape).toBe('none');
  });
});
