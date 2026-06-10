import { describe, it, expect } from 'vitest';
import * as T from './transforms';
import { measureTextLabel } from '../geometry/textMeasure';
import {
  makeDoc,
  makeLine,
  makeStation,
  makeStop,
  makeTextLabel,
  stationWithStop,
} from '../test/fixtures';
import type { MapDoc, RouteBullet, Station, TextLabel } from './types';

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
      offsetPerp: 0,
      align: 'auto',
      valign: 'auto-down',
    });
  });
});

describe('cycleLabelValign', () => {
  // Cycle order: auto-down → top → middle → bottom → auto-up → auto-down.
  // 'auto-down' leads so a user advancing forward immediately reaches the
  // (new) default; the symmetric 'auto-up' option lives at the tail so it
  // sits next to 'bottom', which it geometrically resembles.
  it('walks the auto-down → top → middle → bottom → auto-up → auto-down cycle', () => {
    let doc = makeDoc({ stations: [makeStation({ id: 's1' })] });
    doc = {
      ...doc,
      stations: {
        ...doc.stations,
        s1: { ...doc.stations.s1, label: { ...doc.stations.s1.label, valign: 'auto-down' } },
      },
    };
    doc = T.cycleLabelValign(doc, 's1');
    expect(doc.stations.s1.label.valign).toBe('top');
    doc = T.cycleLabelValign(doc, 's1');
    expect(doc.stations.s1.label.valign).toBe('middle');
    doc = T.cycleLabelValign(doc, 's1');
    expect(doc.stations.s1.label.valign).toBe('bottom');
    doc = T.cycleLabelValign(doc, 's1');
    expect(doc.stations.s1.label.valign).toBe('auto-up');
    doc = T.cycleLabelValign(doc, 's1');
    expect(doc.stations.s1.label.valign).toBe('auto-down');
  });

  it('is a no-op for missing ids', () => {
    const doc = makeDoc({ stations: [makeStation({ id: 's1' })] });
    expect(T.cycleLabelValign(doc, 'nope')).toEqual(doc);
  });
});

describe('setLabelOffsetPerp', () => {
  it('writes the value to the label', () => {
    let doc = makeDoc({ stations: [makeStation({ id: 's1' })] });
    doc = T.setLabelOffsetPerp(doc, 's1', 5);
    expect(doc.stations.s1.label.offsetPerp).toBe(5);
    doc = T.setLabelOffsetPerp(doc, 's1', -12);
    expect(doc.stations.s1.label.offsetPerp).toBe(-12);
  });

  it('is reference-equal to input when the value is unchanged (treats missing as 0)', () => {
    // makeStation labels omit offsetPerp — setting it to 0 should be a
    // no-op so undo/history-batching equality checks short-circuit instead
    // of accumulating cosmetic identity churn.
    const doc = makeDoc({ stations: [makeStation({ id: 's1' })] });
    expect(T.setLabelOffsetPerp(doc, 's1', 0)).toBe(doc);
  });

  it('is a no-op for missing ids', () => {
    const doc = makeDoc({ stations: [makeStation({ id: 's1' })] });
    expect(T.setLabelOffsetPerp(doc, 'nope', 9)).toBe(doc);
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
          stops: [makeStop('L1', { row: 1, col: 2, orientation: 'auto-vertical' })],
          label: { row: 0, col: -1, rotation: 1, offset: 0, align: 'auto', valign: 'middle' },
        }),
      ],
    });
    const round = T.rotateStationAndLayout(T.rotateStationAndLayout(doc0, 's1', 1), 's1', -1);
    expect(round.stations.s1.rotation).toBe(doc0.stations.s1.rotation);
    expect(round.stations.s1.stops).toEqual(doc0.stations.s1.stops);
    expect(round.stations.s1.label).toEqual(doc0.stations.s1.label);
  });

  it('swaps auto-vertical ↔ auto-horizontal under ±90°', () => {
    for (const dir of [1, -1] as const) {
      const doc = makeDoc({
        stations: [
          makeStation({
            id: 's1',
            stops: [makeStop('L1', { orientation: 'auto-vertical' })],
          }),
        ],
      });
      const next = T.rotateStationAndLayout(doc, 's1', dir);
      expect(next.stations.s1.stops[0].orientation).toBe('auto-horizontal');
    }
  });

  it('swaps auto-ne-sw ↔ auto-nw-se under ±90°', () => {
    for (const dir of [1, -1] as const) {
      const docNeSw = makeDoc({
        stations: [
          makeStation({
            id: 's1',
            stops: [makeStop('L1', { orientation: 'auto-ne-sw' })],
          }),
        ],
      });
      expect(T.rotateStationAndLayout(docNeSw, 's1', dir).stations.s1.stops[0].orientation).toBe(
        'auto-nw-se',
      );
      const docNwSe = makeDoc({
        stations: [
          makeStation({
            id: 's1',
            stops: [makeStop('L1', { orientation: 'auto-nw-se' })],
          }),
        ],
      });
      expect(T.rotateStationAndLayout(docNwSe, 's1', dir).stations.s1.stops[0].orientation).toBe(
        'auto-ne-sw',
      );
    }
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

  it('swaps with another stop at a float-equal diagonal position', () => {
    // With true 8-way adjacency, row/col are no longer integers — diagonal
    // moves use ±√2/2. Two stops at the same diagonal position must still
    // be detected as swap candidates despite float arithmetic.
    const h = Math.SQRT1_2;
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          stops: [
            // L1 at the origin; L2 at NE-tangent (one diagonal hop away).
            makeStop('L1', { row: 0, col: 0 }),
            makeStop('L2', { row: -h, col: h }),
          ],
        }),
      ],
    });
    // Move L1 by exactly the NE delta. Even though (-h, +h) arose from a
    // different arithmetic path than L2's stored position, the swap-detection
    // tolerance must recognize them as the same cell.
    const next = T.moveStop(doc, 's1', 'L1', -h, h);
    const byLine = (id: string) => next.stations.s1.stops.find((c) => c.lineId === id)!;
    expect(byLine('L1').row).toBeCloseTo(-h, 6);
    expect(byLine('L1').col).toBeCloseTo(h, 6);
    // L2 should have been pushed back to L1's old (0, 0) cell.
    expect(byLine('L2')).toMatchObject({ row: 0, col: 0 });
  });

  it('refuses to move into a label sitting at a float-equal diagonal position', () => {
    const h = Math.SQRT1_2;
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          stops: [makeStop('L1', { row: 0, col: 0 })],
          label: { row: -h, col: h, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
        }),
      ],
    });
    // Move would land on the label's cell (within EPS). Should be a no-op.
    const next = T.moveStop(doc, 's1', 'L1', -h, h);
    expect(next).toEqual(doc);
  });
});

describe('rotateStop', () => {
  it('cycles through the 4-axis order N/S → NE/SW → E/W → NW/SE → N/S', () => {
    let doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          stops: [makeStop('L1', { orientation: 'auto-vertical' })],
        }),
      ],
    });
    doc = T.rotateStop(doc, 's1', 'L1');
    expect(doc.stations.s1.stops[0].orientation).toBe('auto-ne-sw');
    doc = T.rotateStop(doc, 's1', 'L1');
    expect(doc.stations.s1.stops[0].orientation).toBe('auto-horizontal');
    doc = T.rotateStop(doc, 's1', 'L1');
    expect(doc.stations.s1.stops[0].orientation).toBe('auto-nw-se');
    doc = T.rotateStop(doc, 's1', 'L1');
    expect(doc.stations.s1.stops[0].orientation).toBe('auto-vertical');
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

  it('jumps past a stop at a float-equal diagonal position', () => {
    // Label at NW-tangent of the station; a stop sits directly E of the
    // label at a diagonal-arithmetic position. Stepping the label one E
    // should land beyond the blocking stop.
    const h = Math.SQRT1_2;
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          // Stop at (0, 1·SQRT2) — relative to label, exactly +√2 east.
          // (The exact value doesn't matter; what matters is that moveLabel
          //  uses sameCell to detect collision regardless of float drift.)
          stops: [makeStop('L1', { row: -h, col: h + Math.SQRT2 })],
          label: { row: -h, col: h, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
        }),
      ],
    });
    // Step +√2 east. Without epsilon tolerance, the stops.some(...) check
    // would miss the blocker and the label would land on top of the stop.
    const next = T.moveLabel(doc, 's1', 0, Math.SQRT2);
    // Label should have stepped PAST the stop, landing at +2·SQRT2 east.
    expect(next.stations.s1.label.col).toBeCloseTo(h + 2 * Math.SQRT2, 6);
    expect(next.stations.s1.label.row).toBeCloseTo(-h, 6);
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
  it('defaults the line name to "${service} line"', () => {
    const doc = makeDoc({});
    const next = T.addLine(doc, 'L1', 'A', '#000');
    expect(next.lines.L1.name).toBe('A line');
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
  it('patches the line name', () => {
    const doc = makeDoc({
      lines: [makeLine({ id: 'L1', service: 'A', name: 'A line' })],
    });
    const next = T.updateLine(doc, 'L1', { name: 'Eighth Avenue Express' });
    expect(next.lines.L1.name).toBe('Eighth Avenue Express');
    expect(next.lines.L1.service).toBe('A');
  });

  describe('service-code rename rewrites inline bullets', () => {
    it('rewrites <oldService> bullets in TextLabel.text', () => {
      const doc = makeDoc({
        lines: [makeLine({ id: 'L1', service: 'L1' })],
        textLabels: [makeTextLabel({ id: 't1', text: 'Take the <L1> uptown' })],
      });
      const next = T.updateLine(doc, 'L1', { service: 'A' });
      expect(next.textLabels.t1.text).toBe('Take the <A> uptown');
    });

    it('rewrites <oldService> bullets in Station.name', () => {
      const doc = makeDoc({
        stations: [makeStation({ id: 's1', name: '<L1> Station' })],
        lines: [makeLine({ id: 'L1', service: 'L1' })],
      });
      const next = T.updateLine(doc, 'L1', { service: 'A' });
      expect(next.stations.s1.name).toBe('<A> Station');
    });

    it('replaces every occurrence in a single text', () => {
      const doc = makeDoc({
        lines: [makeLine({ id: 'L1', service: 'L1' })],
        textLabels: [makeTextLabel({ id: 't1', text: '<L1> and <L1> meet at <L1>' })],
      });
      const next = T.updateLine(doc, 'L1', { service: 'A' });
      expect(next.textLabels.t1.text).toBe('<A> and <A> meet at <A>');
    });

    it('leaves bullets for other service codes untouched', () => {
      const doc = makeDoc({
        lines: [makeLine({ id: 'L1', service: 'L1' }), makeLine({ id: 'L2', service: 'L2' })],
        textLabels: [makeTextLabel({ id: 't1', text: '<L1> <L2> <L11>' })],
      });
      const next = T.updateLine(doc, 'L1', { service: 'A' });
      // <L11> is a different bullet code (not L1) — must not be rewritten.
      expect(next.textLabels.t1.text).toBe('<A> <L2> <L11>');
    });

    it('rewrites across multiple textLabels and stations', () => {
      const doc = makeDoc({
        stations: [
          makeStation({ id: 's1', name: '<L1> North' }),
          makeStation({ id: 's2', name: 'No bullet here' }),
        ],
        lines: [makeLine({ id: 'L1', service: 'L1' })],
        textLabels: [
          makeTextLabel({ id: 't1', text: 'Ride <L1>' }),
          makeTextLabel({ id: 't2', text: 'Also <L1>' }),
        ],
      });
      const next = T.updateLine(doc, 'L1', { service: 'A' });
      expect(next.stations.s1.name).toBe('<A> North');
      expect(next.stations.s2.name).toBe('No bullet here');
      expect(next.textLabels.t1.text).toBe('Ride <A>');
      expect(next.textLabels.t2.text).toBe('Also <A>');
    });

    it('does nothing to texts when the patch does not change the service code', () => {
      const doc = makeDoc({
        stations: [makeStation({ id: 's1', name: '<L1> North' })],
        lines: [makeLine({ id: 'L1', service: 'L1' })],
        textLabels: [makeTextLabel({ id: 't1', text: '<L1>' })],
      });
      const next = T.updateLine(doc, 'L1', { name: 'Renamed' });
      expect(next.stations.s1).toBe(doc.stations.s1);
      expect(next.textLabels.t1).toBe(doc.textLabels.t1);
    });

    it('does nothing when the new service equals the old', () => {
      const doc = makeDoc({
        stations: [makeStation({ id: 's1', name: '<L1>' })],
        lines: [makeLine({ id: 'L1', service: 'L1' })],
        textLabels: [makeTextLabel({ id: 't1', text: '<L1>' })],
      });
      const next = T.updateLine(doc, 'L1', { service: 'L1' });
      expect(next.stations.s1).toBe(doc.stations.s1);
      expect(next.textLabels.t1).toBe(doc.textLabels.t1);
    });
  });
});

describe('setLineWidth', () => {
  it('stores a non-default width', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    const next = T.setLineWidth(doc, 'L1', 20);
    expect(next.lines.L1.width).toBe(20);
  });

  it('drops the field entirely when set back to the default', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1', width: 20 })] });
    const next = T.setLineWidth(doc, 'L1', 14);
    expect('width' in next.lines.L1).toBe(false);
  });

  it('returns the input doc unchanged when setting the default on a width-less line', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    expect(T.setLineWidth(doc, 'L1', 14)).toBe(doc);
  });

  it('returns the input doc unchanged when the width is already stored', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1', width: 20 })] });
    expect(T.setLineWidth(doc, 'L1', 20)).toBe(doc);
  });

  it('clamps to the floor and rounds to an integer', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    expect(T.setLineWidth(doc, 'L1', 0).lines.L1.width).toBe(1);
    expect(T.setLineWidth(doc, 'L1', -3).lines.L1.width).toBe(1);
    expect(T.setLineWidth(doc, 'L1', 9.6).lines.L1.width).toBe(10);
    // Rounds-to-default drops the field, same as an exact 14.
    expect('width' in T.setLineWidth(doc, 'L1', 14.4).lines.L1).toBe(false);
  });

  it('ignores non-finite input (same reference out)', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1', width: 20 })] });
    expect(T.setLineWidth(doc, 'L1', NaN)).toBe(doc);
    expect(T.setLineWidth(doc, 'L1', Infinity)).toBe(doc);
  });

  it('returns the input doc for an unknown line id', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    expect(T.setLineWidth(doc, 'ghost', 20)).toBe(doc);
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

  it('nudges an auto-placed label that sits where the new stop is landing', () => {
    // Stop on L1 at (0,0), label moved to (0,1) (right side, auto mode).
    // Adding L2 places a stop at (0, 1) — the label cell. The label should
    // step to (0, 2) so the new line doesn't paint over it.
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          stops: [makeStop('L1', { row: 0, col: 0 })],
          label: { row: 0, col: 1, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
        }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1'] }), makeLine({ id: 'L2', stations: [] })],
    });
    const next = T.toggleStationOnLine(doc, 'L2', 's1');
    expect(next.stations.s1.stops).toEqual(
      expect.arrayContaining([expect.objectContaining({ lineId: 'L2', row: 0, col: 1 })]),
    );
    expect(next.stations.s1.label).toMatchObject({ row: 0, col: 2 });
  });

  it('leaves a manually-aligned label alone even when the new stop overlaps it', () => {
    // Same setup as above but align='end' — user has pinned the label, so
    // we don't move it out from under them.
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          stops: [makeStop('L1', { row: 0, col: 0 })],
          label: { row: 0, col: 1, rotation: 0, offset: 0, align: 'end', valign: 'middle' },
        }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1'] }), makeLine({ id: 'L2', stations: [] })],
    });
    const next = T.toggleStationOnLine(doc, 'L2', 's1');
    expect(next.stations.s1.label).toMatchObject({ row: 0, col: 1, align: 'end' });
  });

  it('leaves the label alone when the new stop lands elsewhere', () => {
    // Default label at (0, -1); new stop lands at (0, 1). No collision.
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          stops: [makeStop('L1', { row: 0, col: 0 })],
        }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1'] }), makeLine({ id: 'L2', stations: [] })],
    });
    const next = T.toggleStationOnLine(doc, 'L2', 's1');
    expect(next.stations.s1.label).toMatchObject({ row: 0, col: -1 });
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
    expect(T.DEFAULT_DOC.labelWeight).toBe(400);
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

  it('setLabelWeight accepts the supported Helvetica Neue weights', () => {
    const doc = makeDoc({});
    expect(T.setLabelWeight(doc, 100).labelWeight).toBe(100);
    expect(T.setLabelWeight(doc, 700).labelWeight).toBe(700);
    expect(T.setLabelWeight(doc, 900).labelWeight).toBe(900);
  });

  it('setLabelWeight is a no-op when the value is unchanged (reference equality)', () => {
    const doc = makeDoc({ labelWeight: 500 });
    expect(T.setLabelWeight(doc, 500)).toBe(doc);
  });

  it('setLabelItalic flips the boolean', () => {
    const doc = makeDoc({});
    expect(T.setLabelItalic(doc, true).labelItalic).toBe(true);
    expect(T.setLabelItalic(T.setLabelItalic(doc, true), false).labelItalic).toBe(false);
  });
});

describe('transfer styling settings', () => {
  it('exposes thickness bounds as constants', () => {
    expect(T.TRANSFER_THICKNESS_MIN).toBe(1);
    expect(T.TRANSFER_THICKNESS_MAX).toBe(14);
  });

  it('exposes stroke-width bounds as constants', () => {
    expect(T.TRANSFER_STROKE_WIDTH_MIN).toBe(0);
    expect(T.TRANSFER_STROKE_WIDTH_MAX).toBe(5);
  });

  it('DEFAULT_DOC has the legacy hard-coded look as defaults', () => {
    expect(T.DEFAULT_DOC.transferThickness).toBe(2);
    expect(T.DEFAULT_DOC.transferColor).toBe('#000000');
    // Stroke defaults to off; classic white when opted in.
    expect(T.DEFAULT_DOC.transferStrokeWidth).toBe(0);
    expect(T.DEFAULT_DOC.transferStrokeColor).toBe('#ffffff');
  });

  it('setTransferThickness sets a valid value', () => {
    const doc = makeDoc({});
    expect(T.setTransferThickness(doc, 5).transferThickness).toBe(5);
  });

  it('setTransferThickness clamps below the minimum', () => {
    const doc = makeDoc({});
    expect(T.setTransferThickness(doc, 0).transferThickness).toBe(1);
    expect(T.setTransferThickness(doc, -3).transferThickness).toBe(1);
  });

  it('setTransferThickness does NOT clamp above the slider max (textbox accepts arbitrary)', () => {
    const doc = makeDoc({});
    expect(T.setTransferThickness(doc, 25).transferThickness).toBe(25);
    expect(T.setTransferThickness(doc, 100).transferThickness).toBe(100);
  });

  it('setTransferThickness rounds fractional values', () => {
    const doc = makeDoc({});
    expect(T.setTransferThickness(doc, 4.7).transferThickness).toBe(5);
    expect(T.setTransferThickness(doc, 4.4).transferThickness).toBe(4);
  });

  it('setTransferThickness ignores non-finite values', () => {
    const doc = makeDoc({ transferThickness: 5 });
    expect(T.setTransferThickness(doc, Number.NaN)).toBe(doc);
    expect(T.setTransferThickness(doc, Number.POSITIVE_INFINITY)).toBe(doc);
  });

  it('setTransferThickness is a no-op when the value is unchanged (reference equality)', () => {
    const doc = makeDoc({ transferThickness: 6 });
    expect(T.setTransferThickness(doc, 6)).toBe(doc);
  });

  it('setTransferColor sets the value', () => {
    const doc = makeDoc({});
    expect(T.setTransferColor(doc, '#ff0080').transferColor).toBe('#ff0080');
  });

  it('setTransferColor is a no-op when unchanged (reference equality)', () => {
    const doc = makeDoc({ transferColor: '#123456' });
    expect(T.setTransferColor(doc, '#123456')).toBe(doc);
  });

  it('setTransferStrokeWidth sets a valid value', () => {
    const doc = makeDoc({});
    expect(T.setTransferStrokeWidth(doc, 3).transferStrokeWidth).toBe(3);
  });

  it('setTransferStrokeWidth clamps below MIN (0)', () => {
    const doc = makeDoc({});
    expect(T.setTransferStrokeWidth(doc, -2).transferStrokeWidth).toBe(0);
  });

  it('setTransferStrokeWidth clamps above MAX (5)', () => {
    // Unlike transferThickness, stroke width has both bounds enforced —
    // the spec gives a fixed [0, 5] range with no "arbitrary" textbox.
    const doc = makeDoc({});
    expect(T.setTransferStrokeWidth(doc, 12).transferStrokeWidth).toBe(5);
  });

  it('setTransferStrokeWidth rounds fractional values', () => {
    const doc = makeDoc({});
    expect(T.setTransferStrokeWidth(doc, 2.7).transferStrokeWidth).toBe(3);
  });

  it('setTransferStrokeWidth ignores non-finite values', () => {
    const doc = makeDoc({ transferStrokeWidth: 2 });
    expect(T.setTransferStrokeWidth(doc, Number.NaN)).toBe(doc);
  });

  it('setTransferStrokeWidth is a no-op when unchanged (reference equality)', () => {
    const doc = makeDoc({ transferStrokeWidth: 2 });
    expect(T.setTransferStrokeWidth(doc, 2)).toBe(doc);
  });

  it('setTransferStrokeColor sets the value', () => {
    const doc = makeDoc({});
    expect(T.setTransferStrokeColor(doc, '#abcdef').transferStrokeColor).toBe('#abcdef');
  });

  it('setTransferStrokeColor is a no-op when unchanged (reference equality)', () => {
    const doc = makeDoc({ transferStrokeColor: '#abcdef' });
    expect(T.setTransferStrokeColor(doc, '#abcdef')).toBe(doc);
  });
});

describe('LABEL_WEIGHT_VALUES', () => {
  it('lists the Helvetica Neue weights we ship in /public/fonts/, in ascending order', () => {
    // No 600 — we don't ship a SemiBold face.
    expect(T.LABEL_WEIGHT_VALUES).toEqual([100, 200, 300, 400, 500, 700, 800, 900]);
  });

  it('LABEL_WEIGHT_NAMES is parallel to LABEL_WEIGHT_VALUES', () => {
    expect(T.LABEL_WEIGHT_NAMES.map((w) => w.value)).toEqual(T.LABEL_WEIGHT_VALUES);
    expect(T.LABEL_WEIGHT_NAMES.map((w) => w.name)).toEqual([
      'UltraLight',
      'Thin',
      'Light',
      'Roman',
      'Medium',
      'Bold',
      'Heavy',
      'Black',
    ]);
  });
});

describe('bumpWeightByIndex', () => {
  it('walks +N steps through LABEL_WEIGHT_VALUES', () => {
    expect(T.bumpWeightByIndex(400, 2)).toBe(700); // Regular → Bold
    expect(T.bumpWeightByIndex(300, 1)).toBe(400); // Light → Roman
    expect(T.bumpWeightByIndex(100, 2)).toBe(300);
    expect(T.bumpWeightByIndex(500, 2)).toBe(800);
  });

  it('walks -N steps through LABEL_WEIGHT_VALUES', () => {
    expect(T.bumpWeightByIndex(700, -2)).toBe(400);
    expect(T.bumpWeightByIndex(400, -1)).toBe(300);
  });

  it('clamps at Black (900) when stepping past the top', () => {
    expect(T.bumpWeightByIndex(800, 2)).toBe(900);
    expect(T.bumpWeightByIndex(900, 2)).toBe(900);
    expect(T.bumpWeightByIndex(900, 10)).toBe(900);
  });

  it('clamps at UltraLight (100) when stepping past the bottom', () => {
    expect(T.bumpWeightByIndex(200, -5)).toBe(100);
    expect(T.bumpWeightByIndex(100, -1)).toBe(100);
  });

  it('returns the input unchanged for delta=0', () => {
    expect(T.bumpWeightByIndex(400, 0)).toBe(400);
    expect(T.bumpWeightByIndex(900, 0)).toBe(900);
  });
});

describe('resolveStationLabelWeight', () => {
  it('returns the default weight when stationBold is undefined or false', () => {
    expect(T.resolveStationLabelWeight(400, undefined)).toBe(400);
    expect(T.resolveStationLabelWeight(400, false)).toBe(400);
    expect(T.resolveStationLabelWeight(500, undefined)).toBe(500);
  });

  it('bumps two indices heavier when stationBold is true', () => {
    expect(T.resolveStationLabelWeight(400, true)).toBe(700); // Regular → Bold
    expect(T.resolveStationLabelWeight(300, true)).toBe(500); // Light → Medium
    expect(T.resolveStationLabelWeight(200, true)).toBe(400); // UltraLight → Roman
  });

  it('saturates at Black (900) when default is near or at the top', () => {
    expect(T.resolveStationLabelWeight(800, true)).toBe(900);
    expect(T.resolveStationLabelWeight(900, true)).toBe(900);
  });
});

describe('setStationLabelBold', () => {
  it('writes labelBold:true on the station when called with true', () => {
    const doc = makeDoc({ stations: [makeStation({ id: 'a' })] });
    const next = T.setStationLabelBold(doc, 'a', true);
    expect(next.stations.a.labelBold).toBe(true);
  });

  it('clears labelBold from the station when called with false', () => {
    const doc = makeDoc({
      stations: [{ ...makeStation({ id: 'a' }), labelBold: true }],
    });
    const next = T.setStationLabelBold(doc, 'a', false);
    expect(next.stations.a.labelBold).toBeFalsy();
    // Specifically: omitted, not set to false. Keeps existing saves clean.
    expect('labelBold' in next.stations.a).toBe(false);
  });

  it('is a no-op (reference equality) when the value is unchanged', () => {
    const doc = makeDoc({ stations: [makeStation({ id: 'a' })] });
    expect(T.setStationLabelBold(doc, 'a', false)).toBe(doc);
    const bolded = T.setStationLabelBold(doc, 'a', true);
    expect(T.setStationLabelBold(bolded, 'a', true)).toBe(bolded);
  });

  it('is a no-op for missing ids', () => {
    const doc = makeDoc({ stations: [makeStation({ id: 'a' })] });
    expect(T.setStationLabelBold(doc, 'nope', true)).toBe(doc);
  });
});

describe('setStationLabelItalic', () => {
  it('writes labelItalic:true on the station when called with true', () => {
    const doc = makeDoc({ stations: [makeStation({ id: 'a' })] });
    const next = T.setStationLabelItalic(doc, 'a', true);
    expect(next.stations.a.labelItalic).toBe(true);
  });

  it('clears labelItalic from the station when called with false', () => {
    const doc = makeDoc({
      stations: [{ ...makeStation({ id: 'a' }), labelItalic: true }],
    });
    const next = T.setStationLabelItalic(doc, 'a', false);
    expect(next.stations.a.labelItalic).toBeFalsy();
    // Specifically: omitted, not set to false. Keeps existing saves clean.
    expect('labelItalic' in next.stations.a).toBe(false);
  });

  it('is a no-op (reference equality) when the value is unchanged', () => {
    const doc = makeDoc({ stations: [makeStation({ id: 'a' })] });
    expect(T.setStationLabelItalic(doc, 'a', false)).toBe(doc);
    const italicized = T.setStationLabelItalic(doc, 'a', true);
    expect(T.setStationLabelItalic(italicized, 'a', true)).toBe(italicized);
  });

  it('is a no-op for missing ids', () => {
    const doc = makeDoc({ stations: [makeStation({ id: 'a' })] });
    expect(T.setStationLabelItalic(doc, 'nope', true)).toBe(doc);
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
  it('cycles text 0→1→2→3 → chevron fwd → chevron rev → text 0', () => {
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
    // Legacy tags lack `kind`; the first three steps stay text.
    doc = T.cycleLineTagOrientation(doc, 't1');
    expect(doc.lineTags.t1).toMatchObject({ kind: 'text', orientation: 1 });
    doc = T.cycleLineTagOrientation(doc, 't1');
    expect(doc.lineTags.t1).toMatchObject({ kind: 'text', orientation: 2 });
    doc = T.cycleLineTagOrientation(doc, 't1');
    expect(doc.lineTags.t1).toMatchObject({ kind: 'text', orientation: 3 });
    // Past the four text orientations come the two chevron directions.
    doc = T.cycleLineTagOrientation(doc, 't1');
    expect(doc.lineTags.t1).toMatchObject({ kind: 'chevron', orientation: 0 });
    doc = T.cycleLineTagOrientation(doc, 't1');
    expect(doc.lineTags.t1).toMatchObject({ kind: 'chevron', orientation: 2 });
    // ...then wrap back to text up.
    doc = T.cycleLineTagOrientation(doc, 't1');
    expect(doc.lineTags.t1).toMatchObject({ kind: 'text', orientation: 0 });
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
      lines: [makeLine({ id: 'L1' }), makeLine({ id: 'L2' })],
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
          stops: [makeStop('L1', { row: 2, col: 3, orientation: 'auto-horizontal' })],
        }),
      ],
      lines: [makeLine({ id: 'L1' })],
    });
    const next = T.setDotShape(doc, 'a', 'L1', 'filled-black-diamond');
    expect(next.stations.a.stops[0]).toMatchObject({
      lineId: 'L1',
      row: 2,
      col: 3,
      orientation: 'auto-horizontal',
      dotShape: 'filled-black-diamond',
    });
  });

  it('leaves sibling stations untouched', () => {
    const doc = makeDoc({
      stations: [
        makeStation({ id: 'a', stops: [makeStop('L1')] }),
        makeStation({ id: 'b', stops: [makeStop('L1')] }),
      ],
      lines: [makeLine({ id: 'L1' })],
    });
    const next = T.setDotShape(doc, 'a', 'L1', 'open-white');
    expect(next.stations.a.stops[0].dotShape).toBe('open-white');
    expect(next.stations.b.stops[0].dotShape).toBeUndefined();
  });

  it('silently no-ops on unknown station id', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
      lines: [makeLine({ id: 'L1' })],
    });
    const next = T.setDotShape(doc, 'ghost', 'L1', 'filled-white');
    expect(next).toEqual(doc);
  });

  it('silently no-ops when the station has no stop on lineId', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
      lines: [makeLine({ id: 'L1' })],
    });
    const next = T.setDotShape(doc, 'a', 'L99', 'open-white');
    expect(next).toEqual(doc);
  });

  it("'none' is a plain assignment, not a removal", () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
      lines: [makeLine({ id: 'L1' })],
    });
    const next = T.setDotShape(doc, 'a', 'L1', 'none');
    expect(next.stations.a.stops[0].dotShape).toBe('none');
  });

  it("clears an existing override when the new shape matches the line's default", () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1', { dotShape: 'open-white' })] })],
      lines: [makeLine({ id: 'L1', defaultDotShape: 'open-white' })],
    });
    const next = T.setDotShape(doc, 'a', 'L1', 'open-white');
    expect(next.stations.a.stops[0].dotShape).toBeUndefined();
  });

  it("clears an existing override when the new shape matches the implicit 'filled-black' default", () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1', { dotShape: 'open-white' })] })],
      lines: [makeLine({ id: 'L1' })],
    });
    const next = T.setDotShape(doc, 'a', 'L1', 'filled-black');
    expect(next.stations.a.stops[0].dotShape).toBeUndefined();
  });

  it("leaves dotShape undefined when picking the line's default on a stop with no override", () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
      lines: [makeLine({ id: 'L1', defaultDotShape: 'open-white' })],
    });
    const next = T.setDotShape(doc, 'a', 'L1', 'open-white');
    expect(next.stations.a.stops[0].dotShape).toBeUndefined();
  });

  it("stores 'filled-black' as an explicit override when the line's default is something else", () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
      lines: [makeLine({ id: 'L1', defaultDotShape: 'open-white' })],
    });
    const next = T.setDotShape(doc, 'a', 'L1', 'filled-black');
    expect(next.stations.a.stops[0].dotShape).toBe('filled-black');
  });
});

describe('setLineDefaultDotShape', () => {
  it('sets the field when the new shape is not filled-black', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    const next = T.setLineDefaultDotShape(doc, 'L1', 'open-white');
    expect(next.lines.L1.defaultDotShape).toBe('open-white');
  });

  it("drops the field when the new shape is the historical default 'filled-black'", () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1', defaultDotShape: 'open-white' })] });
    const next = T.setLineDefaultDotShape(doc, 'L1', 'filled-black');
    expect(next.lines.L1.defaultDotShape).toBeUndefined();
    expect('defaultDotShape' in next.lines.L1).toBe(false);
  });

  it('silently no-ops on unknown line id', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    expect(T.setLineDefaultDotShape(doc, 'ghost', 'open-white')).toBe(doc);
  });

  it('returns the same doc reference when the value is unchanged', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1', defaultDotShape: 'open-white' })] });
    expect(T.setLineDefaultDotShape(doc, 'L1', 'open-white')).toBe(doc);
  });

  it('returns the same doc reference when clearing an already-cleared default', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    expect(T.setLineDefaultDotShape(doc, 'L1', 'filled-black')).toBe(doc);
  });

  it('clears per-stop overrides that match the NEW default', () => {
    const doc = makeDoc({
      stations: [
        makeStation({ id: 'a', stops: [makeStop('L1', { dotShape: 'open-white' })] }),
        makeStation({ id: 'b', stops: [makeStop('L1', { dotShape: 'filled-black-diamond' })] }),
        makeStation({ id: 'c', stops: [makeStop('L1')] }),
      ],
      lines: [makeLine({ id: 'L1' })],
    });
    const next = T.setLineDefaultDotShape(doc, 'L1', 'open-white');
    // 'a' matched the new default — override cleared.
    expect(next.stations.a.stops[0].dotShape).toBeUndefined();
    expect('dotShape' in next.stations.a.stops[0]).toBe(false);
    // 'b' had a different explicit shape — left alone.
    expect(next.stations.b.stops[0].dotShape).toBe('filled-black-diamond');
    // 'c' had no override — still none.
    expect(next.stations.c.stops[0].dotShape).toBeUndefined();
  });

  it("clears per-stop 'filled-black' overrides when the default is reset to filled-black", () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1', { dotShape: 'filled-black' })] })],
      lines: [makeLine({ id: 'L1', defaultDotShape: 'open-white' })],
    });
    const next = T.setLineDefaultDotShape(doc, 'L1', 'filled-black');
    expect(next.lines.L1.defaultDotShape).toBeUndefined();
    expect(next.stations.a.stops[0].dotShape).toBeUndefined();
  });

  it('leaves overrides on OTHER lines untouched when a default changes', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 'a',
          stops: [
            makeStop('L1', { dotShape: 'open-white' }),
            makeStop('L2', { col: 1, dotShape: 'open-white' }),
          ],
        }),
      ],
      lines: [makeLine({ id: 'L1' }), makeLine({ id: 'L2' })],
    });
    const next = T.setLineDefaultDotShape(doc, 'L1', 'open-white');
    expect(next.stations.a.stops[0].dotShape).toBeUndefined();
    expect(next.stations.a.stops[1].dotShape).toBe('open-white');
  });
});

describe('setStationWaypoint', () => {
  it('sets isWaypoint to true', () => {
    const doc = makeDoc({ stations: [makeStation({ id: 'a' })] });
    const next = T.setStationWaypoint(doc, 'a', true);
    expect(next.stations.a.isWaypoint).toBe(true);
  });

  it('sets isWaypoint to false (clears the flag)', () => {
    const doc = makeDoc({ stations: [makeStation({ id: 'a', isWaypoint: true })] });
    const next = T.setStationWaypoint(doc, 'a', false);
    expect(next.stations.a.isWaypoint).toBe(false);
  });

  it('preserves the rest of the station (name, stops, label)', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 'a',
          name: 'Anvil',
          stops: [makeStop('L1', { dotShape: 'filled-white' })],
        }),
      ],
    });
    const next = T.setStationWaypoint(doc, 'a', true);
    expect(next.stations.a).toMatchObject({
      id: 'a',
      name: 'Anvil',
      isWaypoint: true,
    });
    expect(next.stations.a.stops[0].dotShape).toBe('filled-white');
  });

  it('returns the same doc reference (no-op) when value is unchanged', () => {
    const doc = makeDoc({ stations: [makeStation({ id: 'a', isWaypoint: true })] });
    expect(T.setStationWaypoint(doc, 'a', true)).toBe(doc);
  });

  it('treats undefined isWaypoint and false as equivalent for no-op detection', () => {
    const doc = makeDoc({ stations: [makeStation({ id: 'a' })] });
    expect(T.setStationWaypoint(doc, 'a', false)).toBe(doc);
  });

  it('silently no-ops on unknown station id', () => {
    const doc = makeDoc({ stations: [makeStation({ id: 'a' })] });
    expect(T.setStationWaypoint(doc, 'ghost', true)).toBe(doc);
  });
});

describe('setLineSegmentStyle', () => {
  const docWithLine = () =>
    makeDoc({
      stations: [
        makeStation({ id: 's1', stops: [makeStop('L1')] }),
        makeStation({ id: 's2', stops: [makeStop('L1')] }),
        makeStation({ id: 's3', stops: [makeStop('L1')] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2', 's3'] })],
    });

  it('writes a non-solid style under the canonical pair-key', () => {
    const next = T.setLineSegmentStyle(docWithLine(), 'L1', 's1', 's2', 'hatched');
    expect(next.lines.L1.segmentStyles).toEqual({ 's1|s2': 'hatched' });
  });

  it('canonicalizes argument order (b, a) -> a|b', () => {
    const next = T.setLineSegmentStyle(docWithLine(), 'L1', 's2', 's1', 'dashed');
    expect(next.lines.L1.segmentStyles).toEqual({ 's1|s2': 'dashed' });
  });

  it('setting solid deletes the entry rather than storing it', () => {
    let doc = T.setLineSegmentStyle(docWithLine(), 'L1', 's1', 's2', 'hatched');
    doc = T.setLineSegmentStyle(doc, 'L1', 's1', 's2', 'solid');
    expect(doc.lines.L1.segmentStyles).toEqual({});
  });

  it('preserves entries on other segments when one segment changes', () => {
    let doc = T.setLineSegmentStyle(docWithLine(), 'L1', 's1', 's2', 'hatched');
    doc = T.setLineSegmentStyle(doc, 'L1', 's2', 's3', 'dashed');
    expect(doc.lines.L1.segmentStyles).toEqual({
      's1|s2': 'hatched',
      's2|s3': 'dashed',
    });
  });

  it('silently no-ops on unknown line id', () => {
    const doc = docWithLine();
    expect(T.setLineSegmentStyle(doc, 'ghost', 's1', 's2', 'hatched')).toEqual(doc);
  });
});

describe('removeStationFromLine — segmentStyles cascade', () => {
  it('drops segment-style entries whose corridor is no longer an edge', () => {
    const doc = makeDoc({
      stations: [
        makeStation({ id: 's1', stops: [makeStop('L1')] }),
        makeStation({ id: 's2', stops: [makeStop('L1')] }),
        makeStation({ id: 's3', stops: [makeStop('L1')] }),
      ],
      lines: [
        makeLine({
          id: 'L1',
          stations: ['s1', 's2', 's3'],
          segmentStyles: { 's1|s2': 'hatched', 's2|s3': 'dashed' },
        }),
      ],
    });
    const next = T.removeStationFromLine(doc, 'L1', 1);
    // After removing s2, only adjacency s1-s3 remains; both prior entries break.
    expect(next.lines.L1.segmentStyles).toEqual({});
  });

  it('keeps segment-style entries whose corridor remains an edge', () => {
    const doc = makeDoc({
      stations: [
        makeStation({ id: 's1', stops: [makeStop('L1')] }),
        makeStation({ id: 's2', stops: [makeStop('L1')] }),
        makeStation({ id: 's3', stops: [makeStop('L1')] }),
      ],
      lines: [
        makeLine({
          id: 'L1',
          stations: ['s1', 's2', 's3'],
          segmentStyles: { 's1|s2': 'hatched' },
        }),
      ],
    });
    const next = T.removeStationFromLine(doc, 'L1', 2);
    expect(next.lines.L1.segmentStyles).toEqual({ 's1|s2': 'hatched' });
  });
});

describe('cycleSegmentLayer', () => {
  const docWithLine = () =>
    makeDoc({
      stations: [
        makeStation({ id: 's1', stops: [makeStop('L1')] }),
        makeStation({ id: 's2', stops: [makeStop('L1')] }),
        makeStation({ id: 's3', stops: [makeStop('L1')] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2', 's3'] })],
    });

  it('writes a non-zero layer under the canonical pair-key on +1', () => {
    const next = T.cycleSegmentLayer(docWithLine(), 'L1', 's1', 's2', 1);
    expect(next.lines.L1.segmentLayers).toEqual({ 's1|s2': 1 });
  });

  it('writes a negative layer on -1', () => {
    const next = T.cycleSegmentLayer(docWithLine(), 'L1', 's1', 's2', -1);
    expect(next.lines.L1.segmentLayers).toEqual({ 's1|s2': -1 });
  });

  it('canonicalizes argument order (b, a) -> a|b', () => {
    const next = T.cycleSegmentLayer(docWithLine(), 'L1', 's2', 's1', 1);
    expect(next.lines.L1.segmentLayers).toEqual({ 's1|s2': 1 });
  });

  it('accumulates: repeated +1 climbs uncapped', () => {
    let doc = docWithLine();
    for (let i = 0; i < 5; i++) doc = T.cycleSegmentLayer(doc, 'L1', 's1', 's2', 1);
    expect(doc.lines.L1.segmentLayers).toEqual({ 's1|s2': 5 });
  });

  it('returning to 0 deletes the entry rather than storing it', () => {
    let doc = T.cycleSegmentLayer(docWithLine(), 'L1', 's1', 's2', 1);
    doc = T.cycleSegmentLayer(doc, 'L1', 's1', 's2', -1);
    expect(doc.lines.L1.segmentLayers).toEqual({});
  });

  it('preserves entries on other segments when one segment changes', () => {
    let doc = T.cycleSegmentLayer(docWithLine(), 'L1', 's1', 's2', 1);
    doc = T.cycleSegmentLayer(doc, 'L1', 's2', 's3', -1);
    expect(doc.lines.L1.segmentLayers).toEqual({
      's1|s2': 1,
      's2|s3': -1,
    });
  });

  it('silently no-ops on unknown line id', () => {
    const doc = docWithLine();
    expect(T.cycleSegmentLayer(doc, 'ghost', 's1', 's2', 1)).toEqual(doc);
  });
});

describe('removeStationFromLine — segmentLayers cascade', () => {
  it('drops segment-layer entries whose corridor is no longer an edge', () => {
    let doc = makeDoc({
      stations: [
        makeStation({ id: 's1', stops: [makeStop('L1')] }),
        makeStation({ id: 's2', stops: [makeStop('L1')] }),
        makeStation({ id: 's3', stops: [makeStop('L1')] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2', 's3'] })],
    });
    doc = T.cycleSegmentLayer(doc, 'L1', 's1', 's2', 1);
    doc = T.cycleSegmentLayer(doc, 'L1', 's2', 's3', -1);
    const next = T.removeStationFromLine(doc, 'L1', 1);
    // After removing s2, only s1-s3 remains as an edge; both prior keys break.
    expect(next.lines.L1.segmentLayers).toEqual({});
  });

  it('keeps segment-layer entries whose corridor remains an edge', () => {
    let doc = makeDoc({
      stations: [
        makeStation({ id: 's1', stops: [makeStop('L1')] }),
        makeStation({ id: 's2', stops: [makeStop('L1')] }),
        makeStation({ id: 's3', stops: [makeStop('L1')] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2', 's3'] })],
    });
    doc = T.cycleSegmentLayer(doc, 'L1', 's1', 's2', 1);
    doc = T.cycleSegmentLayer(doc, 'L1', 's1', 's2', 1);
    const next = T.removeStationFromLine(doc, 'L1', 2);
    expect(next.lines.L1.segmentLayers).toEqual({ 's1|s2': 2 });
  });
});

describe('addTextLabel', () => {
  it('inserts a label with documented defaults at the given coords', () => {
    const doc0 = makeDoc({});
    const doc = T.addTextLabel(doc0, 'g1', 25, 75);
    expect(doc.textLabels.g1).toEqual({
      id: 'g1',
      x: 25,
      y: 75,
      rotation: 0,
      text: 'New Label',
      fontSize: 16,
      weight: 400,
      italic: false,
      align: 'left',
      color: '#111111',
      darkColor: '#ffffff',
    });
  });
});

describe('addTextLabelWith', () => {
  it('inserts a fully-specified label', () => {
    const doc0 = makeDoc({});
    const fields: Omit<TextLabel, 'id'> = {
      x: 10,
      y: 20,
      rotation: 3,
      text: 'Hello\nWorld',
      fontSize: 32,
      weight: 700,
      italic: true,
      align: 'center',
      color: '#ff0000',
      darkColor: '#00ff00',
    };
    const doc = T.addTextLabelWith(doc0, 'g1', fields);
    expect(doc.textLabels.g1).toEqual({ id: 'g1', ...fields });
  });
});

describe('moveTextLabel', () => {
  it('updates x/y, leaves other fields untouched', () => {
    const doc = makeDoc({
      textLabels: [makeTextLabel({ id: 'g1', x: 0, y: 0, text: 'Hi', rotation: 2 })],
    });
    const next = T.moveTextLabel(doc, 'g1', 50, 60);
    expect(next.textLabels.g1).toMatchObject({ x: 50, y: 60, text: 'Hi', rotation: 2 });
  });
  it('is a no-op when id is missing', () => {
    const doc = makeDoc({});
    expect(T.moveTextLabel(doc, 'nope', 10, 10)).toBe(doc);
  });
});

describe('rotateTextLabel', () => {
  it('cycles rotation 0..7 with wrap', () => {
    let doc = makeDoc({ textLabels: [makeTextLabel({ id: 'g1', rotation: 7 })] });
    doc = T.rotateTextLabel(doc, 'g1');
    expect(doc.textLabels.g1.rotation).toBe(0);
  });
  it('eight rotations is identity', () => {
    let doc = makeDoc({ textLabels: [makeTextLabel({ id: 'g1', rotation: 0 })] });
    for (let i = 0; i < 8; i++) doc = T.rotateTextLabel(doc, 'g1');
    expect(doc.textLabels.g1.rotation).toBe(0);
  });
  it('is a no-op for missing ids', () => {
    const doc = makeDoc({});
    expect(T.rotateTextLabel(doc, 'nope')).toBe(doc);
  });
});

describe('updateTextLabel', () => {
  it('partial-merges into the existing label', () => {
    const doc = makeDoc({
      textLabels: [makeTextLabel({ id: 'g1', text: 'A', fontSize: 16, italic: false })],
    });
    const next = T.updateTextLabel(doc, 'g1', { text: 'B', italic: true });
    expect(next.textLabels.g1).toMatchObject({ text: 'B', italic: true, fontSize: 16 });
  });
  it('clamps fontSize to [1, 96] and rounds to integer', () => {
    const doc = makeDoc({ textLabels: [makeTextLabel({ id: 'g1', fontSize: 16 })] });
    expect(T.updateTextLabel(doc, 'g1', { fontSize: 0 }).textLabels.g1.fontSize).toBe(1);
    expect(T.updateTextLabel(doc, 'g1', { fontSize: 999 }).textLabels.g1.fontSize).toBe(96);
    expect(T.updateTextLabel(doc, 'g1', { fontSize: 23.7 }).textLabels.g1.fontSize).toBe(24);
  });
  it('is a no-op for missing ids', () => {
    const doc = makeDoc({});
    expect(T.updateTextLabel(doc, 'nope', { text: 'X' })).toBe(doc);
  });

  // Resize-preserves-upper-left: text size / lines / weight / italic can all
  // change the bbox. The label's (x, y) is its bbox center, so naive merging
  // grows the bbox symmetrically out of the center — drift the visual top-
  // left every time. Anchor on the upper-left instead.
  const upperLeftOf = (label: TextLabel) => {
    const m = measureTextLabel(label);
    return { x: label.x - m.width / 2, y: label.y - m.height / 2 };
  };
  it('preserves the upper-left corner when fontSize grows', () => {
    const doc = makeDoc({
      textLabels: [makeTextLabel({ id: 'g1', x: 100, y: 100, fontSize: 16 })],
    });
    const before = upperLeftOf(doc.textLabels.g1);
    const next = T.updateTextLabel(doc, 'g1', { fontSize: 32 });
    const after = upperLeftOf(next.textLabels.g1);
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  it('preserves the upper-left corner when text adds new lines', () => {
    const doc = makeDoc({
      textLabels: [makeTextLabel({ id: 'g1', x: 50, y: 50, text: 'A' })],
    });
    const before = upperLeftOf(doc.textLabels.g1);
    const next = T.updateTextLabel(doc, 'g1', { text: 'A\nB\nC' });
    const after = upperLeftOf(next.textLabels.g1);
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  it('preserves the upper-left corner when italic flips', () => {
    const doc = makeDoc({
      textLabels: [makeTextLabel({ id: 'g1', x: 30, y: 30, italic: false })],
    });
    const before = upperLeftOf(doc.textLabels.g1);
    const next = T.updateTextLabel(doc, 'g1', { italic: true });
    const after = upperLeftOf(next.textLabels.g1);
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  it('explicit x/y in the patch overrides upper-left preservation', () => {
    // Caller is moving the label (e.g. drag) — don't second-guess by re-
    // anchoring on the old top-left.
    const doc = makeDoc({
      textLabels: [makeTextLabel({ id: 'g1', x: 0, y: 0, fontSize: 16 })],
    });
    const next = T.updateTextLabel(doc, 'g1', { fontSize: 32, x: 200, y: 300 });
    expect(next.textLabels.g1.x).toBe(200);
    expect(next.textLabels.g1.y).toBe(300);
  });

  it('sets the day and night colors independently of each other', () => {
    const doc = makeDoc({
      textLabels: [makeTextLabel({ id: 'g1', color: '#111111', darkColor: '#ffffff' })],
    });
    const afterDay = T.updateTextLabel(doc, 'g1', { color: '#ff0000' });
    expect(afterDay.textLabels.g1.color).toBe('#ff0000');
    // Night color untouched.
    expect(afterDay.textLabels.g1.darkColor).toBe('#ffffff');
    const afterNight = T.updateTextLabel(afterDay, 'g1', { darkColor: '#00ff00' });
    expect(afterNight.textLabels.g1.darkColor).toBe('#00ff00');
    // Day color untouched.
    expect(afterNight.textLabels.g1.color).toBe('#ff0000');
  });

  it('a color-only edit does not re-anchor (colors are not resize-affecting)', () => {
    const doc = makeDoc({
      textLabels: [makeTextLabel({ id: 'g1', x: 40, y: 60 })],
    });
    const next = T.updateTextLabel(doc, 'g1', { color: '#abcdef', darkColor: '#123456' });
    expect(next.textLabels.g1.x).toBe(40);
    expect(next.textLabels.g1.y).toBe(60);
  });
});

describe('resolveTextLabelColor', () => {
  it('returns the day color in light mode, ignoring the night color', () => {
    const label = makeTextLabel({ id: 'g1', color: '#aaaaaa', darkColor: '#222222' });
    expect(T.resolveTextLabelColor(label, false)).toBe('#aaaaaa');
  });
  it('returns the night color in dark mode', () => {
    const label = makeTextLabel({ id: 'g1', color: '#aaaaaa', darkColor: '#222222' });
    expect(T.resolveTextLabelColor(label, true)).toBe('#222222');
  });
});

describe('deleteTextLabel', () => {
  it('removes the entry', () => {
    const doc = makeDoc({ textLabels: [makeTextLabel({ id: 'g1' })] });
    expect(T.deleteTextLabel(doc, 'g1').textLabels.g1).toBeUndefined();
  });
  it('is a no-op for missing ids (preserves reference)', () => {
    const doc = makeDoc({ textLabels: [makeTextLabel({ id: 'g1' })] });
    expect(T.deleteTextLabel(doc, 'nope')).toBe(doc);
  });
});

describe('rotateItemsAround — labels', () => {
  const SQRT2_2 = Math.SQRT2 / 2;
  const lb = (id: string): T.ItemRef => ({ type: 'label', id });
  const st = (id: string): T.ItemRef => ({ type: 'station', id });

  it('label pivot: pivot stays, label sibling orbits', () => {
    const doc = makeDoc({
      textLabels: [
        makeTextLabel({ id: 'p', x: 0, y: 0, rotation: 0 }),
        makeTextLabel({ id: 's', x: 100, y: 0, rotation: 0 }),
      ],
    });
    const next = T.rotateItemsAround(doc, lb('p'), [lb('p'), lb('s')]);
    expect(next.textLabels.p).toMatchObject({ rotation: 1, x: 0, y: 0 });
    expect(next.textLabels.s.rotation).toBe(1);
    expect(next.textLabels.s.x).toBeCloseTo(100 * SQRT2_2, 5);
    expect(next.textLabels.s.y).toBeCloseTo(100 * SQRT2_2, 5);
  });

  it('label pivot orbits a station sibling around the label position', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 's', x: 100, y: 0 })],
      textLabels: [makeTextLabel({ id: 'p', x: 0, y: 0 })],
    });
    const next = T.rotateItemsAround(doc, lb('p'), [lb('p'), st('s')]);
    expect(next.textLabels.p).toMatchObject({ rotation: 1, x: 0, y: 0 });
    expect(next.stations.s.x).toBeCloseTo(100 * SQRT2_2, 5);
    expect(next.stations.s.y).toBeCloseTo(100 * SQRT2_2, 5);
  });

  it('station pivot orbits a label sibling', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'p', x: 0, y: 0 })],
      textLabels: [makeTextLabel({ id: 's', x: 100, y: 0 })],
    });
    const next = T.rotateItemsAround(doc, st('p'), [st('p'), lb('s')]);
    expect(next.stations.p).toMatchObject({ rotation: 1, x: 0, y: 0 });
    expect(next.textLabels.s.rotation).toBe(1);
    expect(next.textLabels.s.x).toBeCloseTo(100 * SQRT2_2, 5);
    expect(next.textLabels.s.y).toBeCloseTo(100 * SQRT2_2, 5);
  });

  it('skips label members missing from the doc', () => {
    const doc = makeDoc({
      textLabels: [makeTextLabel({ id: 'p', x: 0, y: 0 })],
    });
    const next = T.rotateItemsAround(doc, lb('p'), [lb('p'), lb('ghost')]);
    expect(next.textLabels.p.rotation).toBe(1);
    expect(Object.keys(next.textLabels)).toEqual(['p']);
  });
});

describe('redistributeBetween', () => {
  // Each station has a single stop at its local origin with rotation 0, so the
  // stop world position equals the station center and the expected positions
  // are easy to reason about.
  const doc5 = (positions: Array<[string, number, number]>): MapDoc =>
    makeDoc({
      stations: positions.map(([id, x, y]) => stationWithStop(id, 'L1', { x, y })),
      lines: [makeLine({ id: 'L1', stations: positions.map(([id]) => id) })],
    });

  it('evenly spaces intermediate stops in straight mode', () => {
    const doc = doc5([
      ['a', 0, 0],
      ['m1', 5, 5],
      ['m2', 5, 5],
      ['m3', 5, 5],
      ['b', 40, 0],
    ]);
    const next = T.redistributeBetween(doc, 'a', 'b', 'straight');
    expect(next.stations.m1).toMatchObject({ x: 10, y: 0 });
    expect(next.stations.m2).toMatchObject({ x: 20, y: 0 });
    expect(next.stations.m3).toMatchObject({ x: 30, y: 0 });
    // Endpoints stay put.
    expect(next.stations.a).toMatchObject({ x: 0, y: 0 });
    expect(next.stations.b).toMatchObject({ x: 40, y: 0 });
  });

  it('evenly spaces by arc length along a collinear chain (arc-bends mode)', () => {
    const doc = doc5([
      ['a', 0, 0],
      ['m1', 5, 0],
      ['m2', 15, 0],
      ['m3', 35, 0],
      ['b', 40, 0],
    ]);
    const next = T.redistributeBetween(doc, 'a', 'b', 'arc-bends');
    expect(next.stations.m1).toMatchObject({ x: 10, y: 0 });
    expect(next.stations.m2).toMatchObject({ x: 20, y: 0 });
    expect(next.stations.m3).toMatchObject({ x: 30, y: 0 });
  });

  it('anchors a station at a real (>5°) bend in arc-bends mode — identity return', () => {
    const doc = doc5([
      ['a', 0, 0],
      ['m', 10, 10],
      ['b', 20, 0],
    ]);
    // The 90° corner at m is detected as a bend and anchored; with no other
    // intermediate station there is nothing left to redistribute, so the doc
    // comes back by reference (keeps undo-batching equality cheap).
    expect(T.redistributeBetween(doc, 'a', 'b', 'arc-bends')).toBe(doc);
  });

  it('ignores bends in straight mode and pulls the station onto the A–B line', () => {
    const doc = doc5([
      ['a', 0, 0],
      ['m', 10, 10],
      ['b', 20, 0],
    ]);
    const next = T.redistributeBetween(doc, 'a', 'b', 'straight');
    expect(next.stations.m).toMatchObject({ x: 10, y: 0 });
  });

  it('skips a station two lines disagree about (conflict) — identity return', () => {
    // x and y lie between a and b on two lines but in swapped order, so the two
    // lines propose different positions for each → both conflicts are dropped.
    const doc = makeDoc({
      stations: [
        stationWithStop('a', 'L1', { x: 0, y: 0 }),
        stationWithStop('b', 'L1', { x: 40, y: 0 }),
        makeStation({ id: 'x', x: 5, y: 5, stops: [makeStop('L1'), makeStop('L2')] }),
        makeStation({ id: 'y', x: 5, y: 5, stops: [makeStop('L1'), makeStop('L2')] }),
      ],
      lines: [
        makeLine({ id: 'L1', stations: ['a', 'x', 'y', 'b'] }),
        makeLine({ id: 'L2', stations: ['a', 'y', 'x', 'b'] }),
      ],
    });
    expect(T.redistributeBetween(doc, 'a', 'b', 'straight')).toBe(doc);
  });

  it('returns the same doc when arc-mode targets are already within a pixel', () => {
    const doc = doc5([
      ['a', 0, 0],
      ['m1', 10, 0],
      ['m2', 20, 0],
      ['m3', 30, 0],
      ['b', 40, 0],
    ]);
    expect(T.redistributeBetween(doc, 'a', 'b', 'arc-bends')).toBe(doc);
  });

  it('is a no-op when start === end', () => {
    const doc = doc5([
      ['a', 0, 0],
      ['b', 10, 0],
    ]);
    expect(T.redistributeBetween(doc, 'a', 'a')).toBe(doc);
  });

  it('is a no-op when an endpoint is missing', () => {
    const doc = doc5([
      ['a', 0, 0],
      ['b', 10, 0],
    ]);
    expect(T.redistributeBetween(doc, 'a', 'nope')).toBe(doc);
  });

  it('is a no-op when no single line connects the two stations', () => {
    const doc = makeDoc({
      stations: [
        stationWithStop('a', 'L1', { x: 0, y: 0 }),
        stationWithStop('b', 'L2', { x: 40, y: 0 }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['a'] }), makeLine({ id: 'L2', stations: ['b'] })],
    });
    expect(T.redistributeBetween(doc, 'a', 'b')).toBe(doc);
  });

  describe('hard-grid (gridMode)', () => {
    it("gridMode 'both' rounds each intermediate center to the nearest grid point", () => {
      // Endpoints 44 apart → even centers fall at 11, 22, 33 (all off-grid);
      // grid 'both' rounds each individually to 10, 20, 30.
      const doc = doc5([
        ['a', 0, 0],
        ['m1', 5, 5],
        ['m2', 5, 5],
        ['m3', 5, 5],
        ['b', 44, 0],
      ]);
      const next = T.redistributeBetween(doc, 'a', 'b', 'straight', 'both');
      expect(next.stations.m1).toMatchObject({ x: 10, y: 0 });
      expect(next.stations.m2).toMatchObject({ x: 20, y: 0 });
      expect(next.stations.m3).toMatchObject({ x: 30, y: 0 });
      // Endpoints untouched (the dragged endpoint is gridded by the engine).
      expect(next.stations.a).toMatchObject({ x: 0, y: 0 });
      expect(next.stations.b).toMatchObject({ x: 44, y: 0 });
    });

    it("gridMode 'vertical' notches only X; Y follows the interpolation", () => {
      const doc = doc5([
        ['a', 0, 0],
        ['m1', 0, 0],
        ['m2', 0, 0],
        ['m3', 0, 0],
        ['b', 44, 40],
      ]);
      const next = T.redistributeBetween(doc, 'a', 'b', 'straight', 'vertical');
      // t = 1/4,2/4,3/4 → x = 11,22,33 → grid X 10,20,30; y = 10,20,30 (free).
      expect(next.stations.m1).toMatchObject({ x: 10, y: 10 });
      expect(next.stations.m2).toMatchObject({ x: 20, y: 20 });
      expect(next.stations.m3).toMatchObject({ x: 30, y: 30 });
    });

    it('quantizes unevenly when centers fall near a cell boundary (accepted trade)', () => {
      // Endpoints 33 apart → centers 8.25, 16.5, 24.75 → grid 10, 20, 20. The
      // last two collapse onto the same grid point: spacing is no longer even,
      // and two stations can coincide. This is the explicitly-accepted edge.
      const doc = doc5([
        ['a', 0, 0],
        ['m1', 5, 5],
        ['m2', 5, 5],
        ['m3', 5, 5],
        ['b', 33, 0],
      ]);
      const next = T.redistributeBetween(doc, 'a', 'b', 'straight', 'both');
      expect(next.stations.m1).toMatchObject({ x: 10, y: 0 });
      expect(next.stations.m2).toMatchObject({ x: 20, y: 0 });
      expect(next.stations.m3).toMatchObject({ x: 20, y: 0 });
    });

    it("gridMode 'off' (default) is unchanged — even spacing preserved", () => {
      const doc = doc5([
        ['a', 0, 0],
        ['m1', 5, 5],
        ['m2', 5, 5],
        ['m3', 5, 5],
        ['b', 40, 0],
      ]);
      const next = T.redistributeBetween(doc, 'a', 'b', 'straight', 'off');
      expect(next.stations.m1).toMatchObject({ x: 10, y: 0 });
      expect(next.stations.m2).toMatchObject({ x: 20, y: 0 });
      expect(next.stations.m3).toMatchObject({ x: 30, y: 0 });
    });
  });
});

describe('reorderLineStations', () => {
  it('prunes segment overrides orphaned by a reorder; they do not resurrect on reorder-back', () => {
    const base = makeDoc({
      stations: [
        makeStation({ id: 'a', stops: [makeStop('L1')] }),
        makeStation({ id: 'b', stops: [makeStop('L1')] }),
        makeStation({ id: 'c', stops: [makeStop('L1')] }),
      ],
      lines: [
        makeLine({
          id: 'L1',
          stations: ['a', 'b', 'c'],
          // Canonical pair-key for the (a, b) edge.
          segmentStyles: { 'a|b': 'hatched' },
        }),
      ],
    });
    // Reorder so a and b are no longer adjacent → the a|b override is orphaned.
    const reordered = T.reorderLineStations(base, 'L1', ['a', 'c', 'b']);
    expect(reordered.lines.L1.segmentStyles).toEqual({});
    // Reordering back must NOT resurrect the pruned override.
    const back = T.reorderLineStations(reordered, 'L1', ['a', 'b', 'c']);
    expect(back.lines.L1.segmentStyles).toEqual({});
  });
});
