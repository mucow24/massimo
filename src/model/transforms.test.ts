import { describe, it, expect } from 'vitest';
import * as T from './transforms';
import { DEFAULT_DOT_STYLE, DOT_SHAPE_PRESETS } from './dotStyle';
import { DOT_SIZE_DEFAULT } from './dotSize';
import { measureTextLabel } from '../geometry/textMeasure';
import {
  makeDoc,
  makeLine,
  makeStation,
  makeStop,
  makeTextLabel,
  stationWithStop,
} from '../test/fixtures';
import type { DotStyle, MapDoc, RouteBullet, Station, TextLabel } from './types';

// Structural clone for dot styles — proves the transforms compare by value,
// never by reference. (JSON round-trip; styles are plain data.)
const cloneStyle = (s: DotStyle): DotStyle => JSON.parse(JSON.stringify(s)) as DotStyle;

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

describe('setLabelAlign', () => {
  it('sets the requested align value', () => {
    const doc = makeDoc({ stations: [makeStation({ id: 's1' })] });
    expect(T.setLabelAlign(doc, 's1', 'middle').stations.s1.label.align).toBe('middle');
  });

  it('returns the same doc reference when the align is unchanged (no-op)', () => {
    // The referential no-op short-circuit is load-bearing for undo grouping.
    const doc = makeDoc({ stations: [makeStation({ id: 's1' })] }); // label.align === 'auto'
    expect(T.setLabelAlign(doc, 's1', 'auto')).toBe(doc);
  });
});

describe('setLabelAutoAlign', () => {
  it('turns the flag on', () => {
    const doc = makeDoc({ stations: [makeStation({ id: 's1' })] });
    expect(T.setLabelAutoAlign(doc, 's1', true).stations.s1.label.autoAlign).toBe(true);
  });

  it('turning it off removes the key (optional flags are omitted when off)', () => {
    const on = T.setLabelAutoAlign(makeDoc({ stations: [makeStation({ id: 's1' })] }), 's1', true);
    const off = T.setLabelAutoAlign(on, 's1', false);
    expect('autoAlign' in off.stations.s1.label).toBe(false);
  });

  it('returns the same doc reference when unchanged (no-op)', () => {
    const doc = makeDoc({ stations: [makeStation({ id: 's1' })] }); // flag absent = off
    expect(T.setLabelAutoAlign(doc, 's1', false)).toBe(doc);
    const on = T.setLabelAutoAlign(doc, 's1', true);
    expect(T.setLabelAutoAlign(on, 's1', true)).toBe(on);
  });
});

describe('rotateRouteBullet', () => {
  it('advances the rotation by one 45°-step', () => {
    const doc = T.addRouteBullet(makeDoc({}), 'b', 0, 0, null);
    expect(doc.routeBullets.b.rotation).toBe(0);
    expect(T.rotateRouteBullet(doc, 'b').routeBullets.b.rotation).toBe(1);
  });

  it('wraps 7 → 0 (mod 8)', () => {
    let doc = T.addRouteBullet(makeDoc({}), 'b', 0, 0, null);
    for (let i = 0; i < 7; i++) doc = T.rotateRouteBullet(doc, 'b');
    expect(doc.routeBullets.b.rotation).toBe(7);
    expect(T.rotateRouteBullet(doc, 'b').routeBullets.b.rotation).toBe(0);
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

  it('steps counter-clockwise with dir -1 and wraps 0 → 7', () => {
    let doc = makeDoc({ stations: [makeStation({ id: 's1', rotation: 0 })] });
    doc = T.rotateStation(doc, 's1', -1);
    expect(doc.stations.s1.rotation).toBe(7);
    doc = T.rotateStation(doc, 's1', -1);
    expect(doc.stations.s1.rotation).toBe(6);
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
  it('deletes transfers anchored at a stop of the removed line', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 's1' }), makeStation({ id: 's2' })],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2'] })],
      transfers: [
        // both endpoints anchored at L1 stops — gone with the line.
        { id: 'x1', a: { stationId: 's1', lineId: 'L1' }, b: { stationId: 's2', lineId: 'L1' } },
        // one endpoint anchored at an L1 stop — also gone.
        { id: 'x2', a: { stationId: 's1', lineId: null }, b: { stationId: 's2', lineId: 'L1' } },
        // neither endpoint references L1 — survives untouched.
        { id: 'x3', a: { stationId: 's1', lineId: null }, b: { stationId: 's2', lineId: 'L2' } },
      ],
    });
    const next = T.deleteLine(doc, 'L1');
    expect(next.transfers.x1).toBeUndefined();
    expect(next.transfers.x2).toBeUndefined();
    expect(next.transfers.x3).toBeDefined();
    expect(next.transfers.x3.a.lineId).toBeNull();
    expect(next.transfers.x3.b.lineId).toBe('L2');
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

  it('label centered on a symmetric pair mirrors along its reading axis, not east', () => {
    // Stops at (0,-1) and (0,1) (centroid (0,0)); label at (0,0) reading
    // vertically (rotation 2 = S). drRaw === dcRaw === 0, so the old code forced
    // dCol=1 and stepped east through the footprint to (0,2). The fix mirrors
    // along the label's own reading axis (south) → (1,0).
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          stops: [makeStop('L1', { row: 0, col: -1 }), makeStop('L1', { row: 0, col: 1 })],
          label: { row: 0, col: 0, rotation: 2, offset: 0, align: 'auto', valign: 'middle' },
        }),
      ],
    });
    const next = T.mirrorLabel(doc, 's1').stations.s1.label;
    expect(next).toMatchObject({ row: 1, col: 0, rotation: 6 });
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
    it('rewrites |oldService| bullets in TextLabel.text', () => {
      const doc = makeDoc({
        lines: [makeLine({ id: 'L1', service: 'L1' })],
        textLabels: [makeTextLabel({ id: 't1', text: 'Take the |L1| uptown' })],
      });
      const next = T.updateLine(doc, 'L1', { service: 'A' });
      expect(next.textLabels.t1.text).toBe('Take the |A| uptown');
    });

    it('rewrites |oldService| bullets in Station.name', () => {
      const doc = makeDoc({
        stations: [makeStation({ id: 's1', name: '|L1| Station' })],
        lines: [makeLine({ id: 'L1', service: 'L1' })],
      });
      const next = T.updateLine(doc, 'L1', { service: 'A' });
      expect(next.stations.s1.name).toBe('|A| Station');
    });

    it('replaces every occurrence in a single text', () => {
      const doc = makeDoc({
        lines: [makeLine({ id: 'L1', service: 'L1' })],
        textLabels: [makeTextLabel({ id: 't1', text: '|L1| and |L1| meet at |L1|' })],
      });
      const next = T.updateLine(doc, 'L1', { service: 'A' });
      expect(next.textLabels.t1.text).toBe('|A| and |A| meet at |A|');
    });

    it('rewrites square, diamond, and unfilled bullet forms too', () => {
      const doc = makeDoc({
        lines: [makeLine({ id: 'L1', service: 'L1' })],
        textLabels: [makeTextLabel({ id: 't1', text: '[L1] {L1} ||L1|| [[L1]] {{L1}}' })],
      });
      const next = T.updateLine(doc, 'L1', { service: 'A' });
      expect(next.textLabels.t1.text).toBe('[A] {A} ||A|| [[A]] {{A}}');
    });

    it('leaves bullets for other service codes untouched', () => {
      const doc = makeDoc({
        lines: [makeLine({ id: 'L1', service: 'L1' }), makeLine({ id: 'L2', service: 'L2' })],
        textLabels: [makeTextLabel({ id: 't1', text: '|L1| |L2| |L11|' })],
      });
      const next = T.updateLine(doc, 'L1', { service: 'A' });
      // |L11| is a different bullet code (not L1) — must not be rewritten.
      expect(next.textLabels.t1.text).toBe('|A| |L2| |L11|');
    });

    it('leaves escaped (literal-text) tokens untouched', () => {
      const doc = makeDoc({
        lines: [makeLine({ id: 'L1', service: 'L1' })],
        textLabels: [makeTextLabel({ id: 't1', text: 'bullet |L1|, literal \\|L1| and \\[L1]' })],
      });
      const next = T.updateLine(doc, 'L1', { service: 'A' });
      expect(next.textLabels.t1.text).toBe('bullet |A|, literal \\|L1| and \\[L1]');
    });

    it('rewrites across multiple textLabels and stations', () => {
      const doc = makeDoc({
        stations: [
          makeStation({ id: 's1', name: '|L1| North' }),
          makeStation({ id: 's2', name: 'No bullet here' }),
        ],
        lines: [makeLine({ id: 'L1', service: 'L1' })],
        textLabels: [
          makeTextLabel({ id: 't1', text: 'Ride |L1|' }),
          makeTextLabel({ id: 't2', text: 'Also |L1|' }),
        ],
      });
      const next = T.updateLine(doc, 'L1', { service: 'A' });
      expect(next.stations.s1.name).toBe('|A| North');
      expect(next.stations.s2.name).toBe('No bullet here');
      expect(next.textLabels.t1.text).toBe('Ride |A|');
      expect(next.textLabels.t2.text).toBe('Also |A|');
    });

    it('does nothing to texts when the patch does not change the service code', () => {
      const doc = makeDoc({
        stations: [makeStation({ id: 's1', name: '|L1| North' })],
        lines: [makeLine({ id: 'L1', service: 'L1' })],
        textLabels: [makeTextLabel({ id: 't1', text: '|L1|' })],
      });
      const next = T.updateLine(doc, 'L1', { name: 'Renamed' });
      expect(next.stations.s1).toBe(doc.stations.s1);
      expect(next.textLabels.t1).toBe(doc.textLabels.t1);
    });

    it('does nothing when the new service equals the old', () => {
      const doc = makeDoc({
        stations: [makeStation({ id: 's1', name: '|L1|' })],
        lines: [makeLine({ id: 'L1', service: 'L1' })],
        textLabels: [makeTextLabel({ id: 't1', text: '|L1|' })],
      });
      const next = T.updateLine(doc, 'L1', { service: 'L1' });
      expect(next.stations.s1).toBe(doc.stations.s1);
      expect(next.textLabels.t1).toBe(doc.textLabels.t1);
    });

    it('skips the rewrite when the old service contains a delimiter character', () => {
      const doc = makeDoc({
        lines: [makeLine({ id: 'L1', service: 'a|b' })],
        textLabels: [makeTextLabel({ id: 't1', text: 'a|b stays' })],
      });
      const next = T.updateLine(doc, 'L1', { service: 'A' });
      expect(next.lines.L1.service).toBe('A');
      expect(next.textLabels.t1.text).toBe('a|b stays');
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

describe('setLineStrokeWidth', () => {
  it('stores a non-default stroke width, including half steps', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    expect(T.setLineStrokeWidth(doc, 'L1', 4).lines.L1.strokeWidth).toBe(4);
    expect(T.setLineStrokeWidth(doc, 'L1', 1.5).lines.L1.strokeWidth).toBe(1.5);
  });

  it('drops the field entirely when set back to 0', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1', strokeWidth: 4 })] });
    const next = T.setLineStrokeWidth(doc, 'L1', 0);
    expect('strokeWidth' in next.lines.L1).toBe(false);
  });

  it('returns the input doc unchanged when setting 0 on a stroke-less line', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    expect(T.setLineStrokeWidth(doc, 'L1', 0)).toBe(doc);
  });

  it('returns the input doc unchanged when the stroke width is already stored', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1', strokeWidth: 4 })] });
    expect(T.setLineStrokeWidth(doc, 'L1', 4)).toBe(doc);
  });

  it('clamps to the floor and rounds to the 0.5 grid', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    // Below-floor clamps to 0 = the default, so the field is never stored.
    expect(T.setLineStrokeWidth(doc, 'L1', -3)).toBe(doc);
    expect(T.setLineStrokeWidth(doc, 'L1', 3.6).lines.L1.strokeWidth).toBe(3.5);
    expect(T.setLineStrokeWidth(doc, 'L1', 3.8).lines.L1.strokeWidth).toBe(4);
    // Rounds-to-zero is dropped like an exact 0.
    expect(T.setLineStrokeWidth(doc, 'L1', 0.2)).toBe(doc);
  });

  it('ignores non-finite input (same reference out)', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1', strokeWidth: 4 })] });
    expect(T.setLineStrokeWidth(doc, 'L1', NaN)).toBe(doc);
    expect(T.setLineStrokeWidth(doc, 'L1', Infinity)).toBe(doc);
  });

  it('returns the input doc for an unknown line id', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    expect(T.setLineStrokeWidth(doc, 'ghost', 4)).toBe(doc);
  });
});

describe('setLineStrokeColor', () => {
  it('stores a non-default stroke color', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    const next = T.setLineStrokeColor(doc, 'L1', '#ff0000');
    expect(next.lines.L1.strokeColor).toBe('#ff0000');
  });

  it('normalizes to lowercase before storing', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    const next = T.setLineStrokeColor(doc, 'L1', '#AB12CD');
    expect(next.lines.L1.strokeColor).toBe('#ab12cd');
  });

  it('drops the field when set to the default, in any case', () => {
    for (const def of ['#ffffff', '#FFFFFF']) {
      const doc = makeDoc({ lines: [makeLine({ id: 'L1', strokeColor: '#ff0000' })] });
      const next = T.setLineStrokeColor(doc, 'L1', def);
      expect('strokeColor' in next.lines.L1).toBe(false);
    }
  });

  it('returns the input doc unchanged when the color is already stored', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1', strokeColor: '#ff0000' })] });
    expect(T.setLineStrokeColor(doc, 'L1', '#ff0000')).toBe(doc);
    expect(T.setLineStrokeColor(doc, 'L1', '#FF0000')).toBe(doc);
  });

  it('returns the input doc unchanged when setting the default on a bare line', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    expect(T.setLineStrokeColor(doc, 'L1', '#ffffff')).toBe(doc);
  });

  it('returns the input doc for an unknown line id', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    expect(T.setLineStrokeColor(doc, 'ghost', '#ff0000')).toBe(doc);
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

  it('nudges an autoAlign label off a landing stop even with an explicit align', () => {
    // autoAlign re-derives placement from the stops, so it counts as
    // auto-placed for the collision nudge regardless of the align field.
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          stops: [makeStop('L1', { row: 0, col: 0 })],
          label: {
            row: 0,
            col: 1,
            rotation: 0,
            offset: 0,
            align: 'middle',
            valign: 'middle',
            autoAlign: true,
          },
        }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1'] }), makeLine({ id: 'L2', stations: [] })],
    });
    const next = T.toggleStationOnLine(doc, 'L2', 's1');
    expect(next.stations.s1.label).toMatchObject({ row: 0, col: 2 });
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

  it('deletes transfers anchored at the stop when the stop is dropped', () => {
    const doc = makeDoc({
      stations: [
        makeStation({ id: 's1', stops: [makeStop('L1')] }),
        makeStation({ id: 's2', stops: [makeStop('L1')] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2'] })],
      transfers: [
        // anchored at the (s1, L1) stop being removed — deleted.
        { id: 'x1', a: { stationId: 's1', lineId: 'L1' }, b: { stationId: 's2', lineId: 'L1' } },
        // anchored at the station, not the stop — survives.
        { id: 'x2', a: { stationId: 's1', lineId: null }, b: { stationId: 's2', lineId: null } },
      ],
    });
    const next = T.removeStationFromLine(doc, 'L1', 0);
    expect(next.stations.s1.stops).toEqual([]);
    expect(next.transfers.x1).toBeUndefined();
    expect(next.transfers.x2).toBeDefined();
  });

  it('keeps anchored transfers when the stop survives (station still on the line)', () => {
    // s1 is on L1 twice; removing one occurrence keeps the (s1, L1) stop, so
    // the transfer anchored at it must NOT be deleted.
    const doc = makeDoc({
      stations: [
        makeStation({ id: 's1', stops: [makeStop('L1')] }),
        makeStation({ id: 's2', stops: [makeStop('L1')] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2', 's1'] })],
      transfers: [
        { id: 'x1', a: { stationId: 's1', lineId: 'L1' }, b: { stationId: 's2', lineId: 'L1' } },
      ],
    });
    const next = T.removeStationFromLine(doc, 'L1', 0);
    expect(next.stations.s1.stops).toHaveLength(1);
    expect(next.transfers.x1).toBeDefined();
  });
});

describe('toggleStationOnLine: transfers', () => {
  it('deletes transfers anchored at the stop when the station is toggled off', () => {
    const doc = makeDoc({
      stations: [
        makeStation({ id: 's1', stops: [makeStop('L1')] }),
        makeStation({ id: 's2', stops: [makeStop('L1')] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2'] })],
      transfers: [
        // anchored at the (s1, L1) stop being removed — deleted.
        { id: 'x1', a: { stationId: 's1', lineId: 'L1' }, b: { stationId: 's2', lineId: 'L1' } },
        // anchored at the station, not the stop — survives.
        { id: 'x2', a: { stationId: 's1', lineId: null }, b: { stationId: 's2', lineId: null } },
      ],
    });
    const next = T.toggleStationOnLine(doc, 'L1', 's1');
    expect(next.stations.s1.stops).toEqual([]);
    expect(next.transfers.x1).toBeUndefined();
    expect(next.transfers.x2).toBeDefined();
  });

  it('keeps anchored transfers when the station keeps a stop on another line', () => {
    // Toggling s1 off L1 must not disturb a transfer anchored at its L2 stop.
    const doc = makeDoc({
      stations: [
        makeStation({ id: 's1', stops: [makeStop('L1'), makeStop('L2', { col: 1 })] }),
        makeStation({ id: 's2', stops: [makeStop('L2')] }),
      ],
      lines: [
        makeLine({ id: 'L1', stations: ['s1'] }),
        makeLine({ id: 'L2', stations: ['s1', 's2'] }),
      ],
      transfers: [
        { id: 'x1', a: { stationId: 's1', lineId: 'L2' }, b: { stationId: 's2', lineId: 'L2' } },
      ],
    });
    const next = T.toggleStationOnLine(doc, 'L1', 's1');
    expect(next.stations.s1.stops.map((c) => c.lineId)).toEqual(['L2']);
    expect(next.transfers.x1).toBeDefined();
  });
});

describe('reorderLineStations', () => {
  it('replaces line.stations and leaves station rotations untouched (no re-orient)', () => {
    // Contract: reordering only rearranges already-served stations, so — unlike
    // adding/removing a station — it deliberately does NOT re-run auto-orient.
    // Give the stations a rotation auto-orient would "fix" (a vertical L1 line
    // would orient both to rotation 2) and assert reorder leaves them alone.
    const doc = makeDoc({
      stations: [
        stationWithStop('s1', 'L1', { x: 0, y: 0 }, { rotation: 5 }),
        stationWithStop('s2', 'L1', { x: 0, y: 100 }, { rotation: 5 }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2'] })],
    });
    const next = T.reorderLineStations(doc, 'L1', ['s2', 's1']);
    expect(next.lines.L1.stations).toEqual(['s2', 's1']);
    expect(next.stations.s1.rotation).toBe(5);
    expect(next.stations.s2.rotation).toBe(5);
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

  it('nulls out the lineId of route bullets that referenced the deleted line (bullet survives)', () => {
    const doc: MapDoc = {
      ...makeDoc({
        lines: [makeLine({ id: 'L1' }), makeLine({ id: 'L2' })],
        lineOrder: ['L1', 'L2'],
      }),
      routeBullets: {
        b1: { id: 'b1', x: 10, y: 20, rotation: 0, lineId: 'L1', shape: 'circle', size: 8 },
        b2: { id: 'b2', x: 30, y: 40, rotation: 0, lineId: 'L2', shape: 'circle', size: 8 },
      },
    };
    const next = T.deleteLine(doc, 'L1');
    // The bullet pointing at L1 survives but reverts to "unset" (lineId null),
    // keeping its position. The bullet on L2 is untouched.
    expect(next.routeBullets.b1).toBeDefined();
    expect(next.routeBullets.b1.lineId).toBeNull();
    expect(next.routeBullets.b1.x).toBe(10);
    expect(next.routeBullets.b1.y).toBe(20);
    expect(next.routeBullets.b2.lineId).toBe('L2');
  });
});

describe('moveLineInOrder', () => {
  it('swaps adjacent indices and clamps at boundaries', () => {
    const doc = makeDoc({
      lines: [makeLine({ id: 'A' }), makeLine({ id: 'B' }), makeLine({ id: 'C' })],
      lineOrder: ['A', 'B', 'C'],
    });
    // A boundary no-op returns the SAME doc reference (not just an equal order)
    // so history grouping doesn't push a spurious undo entry — see the guard in
    // moveLineInOrder / moveInOrder.
    expect(T.moveLineInOrder(doc, 'A', -1)).toBe(doc); // already at front
    expect(T.moveLineInOrder(doc, 'A', 1).lineOrder).toEqual(['B', 'A', 'C']);
    expect(T.moveLineInOrder(doc, 'C', 1)).toBe(doc); // already at back
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
  it('exposes font-size bounds, default, and step as constants', () => {
    expect(T.LABEL_FONT_SIZE_MIN).toBe(2);
    expect(T.LABEL_FONT_SIZE_MAX).toBe(24);
    expect(T.LABEL_FONT_SIZE_DEFAULT).toBe(12);
    expect(T.FONT_SIZE_STEP).toBe(0.25);
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

  it('setLabelFontSize does NOT clamp above the slider max (textbox accepts arbitrary)', () => {
    const doc = makeDoc({});
    expect(T.setLabelFontSize(doc, 99).labelFontSize).toBe(99);
  });

  it('setLabelFontSize snaps fractional values to the nearest 0.25', () => {
    const doc = makeDoc({});
    expect(T.setLabelFontSize(doc, 12.13).labelFontSize).toBe(12.25);
    expect(T.setLabelFontSize(doc, 12.1).labelFontSize).toBe(12);
    expect(T.setLabelFontSize(doc, 12.7).labelFontSize).toBe(12.75);
    expect(T.setLabelFontSize(doc, 12.5).labelFontSize).toBe(12.5);
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

  it('exposes leading/tracking bounds, defaults, and steps as constants', () => {
    expect(T.LABEL_LEADING_MIN).toBe(0);
    expect(T.LABEL_LEADING_MAX).toBe(2);
    expect(T.LABEL_LEADING_STEP).toBe(0.05);
    expect(T.LABEL_LEADING_DEFAULT).toBe(1);
    expect(T.LABEL_TRACKING_MIN).toBe(-0.1);
    expect(T.LABEL_TRACKING_MAX).toBe(0.5);
    expect(T.LABEL_TRACKING_STEP).toBe(0.001);
    expect(T.LABEL_TRACKING_DEFAULT).toBe(0);
  });

  it('DEFAULT_DOC leading/tracking default to the neutral 1 / 0', () => {
    expect(T.DEFAULT_DOC.labelLeading).toBe(1);
    expect(T.DEFAULT_DOC.labelTracking).toBe(0);
  });

  it('setLabelLeading snaps to the 0.05 step and clamps at 0 (no upper clamp)', () => {
    const doc = makeDoc({});
    expect(T.setLabelLeading(doc, 1.2).labelLeading).toBe(1.2);
    // Snaps to the nearest 0.05 with no float dust (1.17 → 1.15).
    expect(T.setLabelLeading(doc, 1.17).labelLeading).toBe(1.15);
    // Clamps at the bottom only; the spinbutton accepts values above the max.
    expect(T.setLabelLeading(doc, -3).labelLeading).toBe(0);
    expect(T.setLabelLeading(doc, 5).labelLeading).toBe(5);
  });

  it('setLabelTracking snaps to the 0.001 step and clamps at the -0.1 floor', () => {
    const doc = makeDoc({});
    expect(T.setLabelTracking(doc, 0.2).labelTracking).toBe(0.2);
    expect(T.setLabelTracking(doc, 0.123).labelTracking).toBe(0.123);
    // Below the -0.1 floor is a hard clamp.
    expect(T.setLabelTracking(doc, -1).labelTracking).toBe(-0.1);
    // The spinbutton accepts values above the slider max.
    expect(T.setLabelTracking(doc, 1).labelTracking).toBe(1);
  });

  it('setLabelLeading / setLabelTracking are no-ops when unchanged (reference equality)', () => {
    const doc = makeDoc({ labelLeading: 1.5, labelTracking: 0.05 });
    expect(T.setLabelLeading(doc, 1.5)).toBe(doc);
    expect(T.setLabelTracking(doc, 0.05)).toBe(doc);
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

  it('setTransferStrokeWidth does NOT clamp above the slider max (textbox accepts arbitrary)', () => {
    // Like transferThickness, only the bottom bound is enforced —
    // TRANSFER_STROKE_WIDTH_MAX constrains the slider, not the value.
    const doc = makeDoc({});
    expect(T.setTransferStrokeWidth(doc, 12).transferStrokeWidth).toBe(12);
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

describe('setStationLocked', () => {
  it('writes locked:true on the station when called with true', () => {
    const doc = makeDoc({ stations: [makeStation({ id: 'a' })] });
    const next = T.setStationLocked(doc, 'a', true);
    expect(next.stations.a.locked).toBe(true);
  });

  it('clears locked from the station when called with false', () => {
    const doc = makeDoc({
      stations: [{ ...makeStation({ id: 'a' }), locked: true }],
    });
    const next = T.setStationLocked(doc, 'a', false);
    expect(next.stations.a.locked).toBeFalsy();
    // Specifically: omitted, not set to false. Keeps existing saves clean.
    expect('locked' in next.stations.a).toBe(false);
  });

  it('is a no-op (reference equality) when the value is unchanged', () => {
    const doc = makeDoc({ stations: [makeStation({ id: 'a' })] });
    expect(T.setStationLocked(doc, 'a', false)).toBe(doc);
    const locked = T.setStationLocked(doc, 'a', true);
    expect(T.setStationLocked(locked, 'a', true)).toBe(locked);
  });

  it('is a no-op for missing ids', () => {
    const doc = makeDoc({ stations: [makeStation({ id: 'a' })] });
    expect(T.setStationLocked(doc, 'nope', true)).toBe(doc);
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

describe('activePalettes — custom palettes', () => {
  const custom = [{ id: 'custom:frrf', name: 'frrf', swatches: [{ name: '1', color: '#c1272d' }] }];

  it('setActivePalettes keeps an active custom id when given the custom list', () => {
    const doc = T.setActivePalettes(makeDoc({}), ['mta', 'custom:frrf'], custom);
    // Custom palettes sort before built-ins.
    expect(doc.activePalettes).toEqual(['custom:frrf', 'mta']);
  });

  it('togglePalette toggling a built-in does not drop an active custom palette', () => {
    const doc = T.setActivePalettes(makeDoc({}), ['custom:frrf'], custom);
    expect(T.togglePalette(doc, 'mta', custom).activePalettes).toEqual(['custom:frrf', 'mta']);
  });

  it('togglePalette removes a present custom id', () => {
    const doc = T.setActivePalettes(makeDoc({}), ['mta', 'custom:frrf'], custom);
    expect(T.togglePalette(doc, 'custom:frrf', custom).activePalettes).toEqual(['mta']);
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

describe('deleteStation — segment override cascade', () => {
  it('prunes segmentStyles AND segmentLayers whose pair-key referenced the deleted station', () => {
    // L1 = a–b–c with a styled + layered (a,b) segment. Deleting `a` removes it
    // from the line, so the (a,b) pair is no longer an edge; both the style and
    // the layer override keyed on it must be pruned, not left dangling at a
    // station that no longer exists. toggleStationOnLine / removeStationFromLine
    // / deleteLine already do this — deleteStation must too.
    let doc = makeDoc({
      stations: [
        makeStation({ id: 'a', stops: [makeStop('L1')] }),
        makeStation({ id: 'b', stops: [makeStop('L1')] }),
        makeStation({ id: 'c', stops: [makeStop('L1')] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['a', 'b', 'c'] })],
    });
    doc = T.setLineSegmentStyle(doc, 'L1', 'a', 'b', 'dashed');
    doc = T.cycleSegmentLayer(doc, 'L1', 'a', 'b', 1);
    // Sanity: exactly the (a,b) override exists before deletion.
    expect(Object.keys(doc.lines.L1.segmentStyles ?? {})).toHaveLength(1);
    expect(Object.keys(doc.lines.L1.segmentLayers ?? {})).toHaveLength(1);

    const next = T.deleteStation(doc, 'a');
    // The (a,b) edge is gone → both override maps drop the orphaned key.
    expect(next.lines.L1.segmentStyles ?? {}).toEqual({});
    expect(next.lines.L1.segmentLayers ?? {}).toEqual({});
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

describe('resolveDotStyle', () => {
  it('prefers the per-stop style over everything', () => {
    const line = makeLine({ id: 'L1', defaultDotStyle: DOT_SHAPE_PRESETS['open-white'] });
    const stop = makeStop('L1', { dotStyle: DOT_SHAPE_PRESETS['filled-black-diamond'] });
    expect(T.resolveDotStyle(line, stop)).toBe(DOT_SHAPE_PRESETS['filled-black-diamond']);
  });

  it("falls back to the line's default when the stop has no override", () => {
    const line = makeLine({ id: 'L1', defaultDotStyle: DOT_SHAPE_PRESETS['open-white'] });
    expect(T.resolveDotStyle(line, makeStop('L1'))).toBe(DOT_SHAPE_PRESETS['open-white']);
  });

  it('falls back to DEFAULT_DOT_STYLE when neither field is set', () => {
    expect(T.resolveDotStyle(makeLine({ id: 'L1' }), makeStop('L1'))).toBe(DEFAULT_DOT_STYLE);
    expect(T.resolveDotStyle(undefined, undefined)).toBe(DEFAULT_DOT_STYLE);
  });
});

describe('setDotStyle', () => {
  it('writes the new style onto the targeted stop only', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1'), makeStop('L2', { col: 1 })] })],
      lines: [makeLine({ id: 'L1' }), makeLine({ id: 'L2' })],
    });
    const next = T.setDotStyle(doc, 'a', 'L1', DOT_SHAPE_PRESETS['filled-black-diamond']);
    expect(next.stations.a.stops[0].dotStyle).toEqual(DOT_SHAPE_PRESETS['filled-black-diamond']);
    expect(next.stations.a.stops[1].dotStyle).toBeUndefined();
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
    const next = T.setDotStyle(doc, 'a', 'L1', DOT_SHAPE_PRESETS['filled-black-diamond']);
    expect(next.stations.a.stops[0]).toMatchObject({
      lineId: 'L1',
      row: 2,
      col: 3,
      orientation: 'auto-horizontal',
      dotStyle: DOT_SHAPE_PRESETS['filled-black-diamond'],
    });
  });

  it('leaves sibling stations untouched', () => {
    const doc = makeDoc({
      stations: [
        makeStation({ id: 'a', stops: [makeStop('L1')] }),
        makeStation({ id: 'b', stops: [makeStop('L1')] }),
      ],
      lines: [makeLine({ id: 'L1' }), makeLine({ id: 'L2' })],
    });
    const next = T.setDotStyle(doc, 'a', 'L1', DOT_SHAPE_PRESETS['open-white']);
    expect(next.stations.a.stops[0].dotStyle).toEqual(DOT_SHAPE_PRESETS['open-white']);
    expect(next.stations.b.stops[0].dotStyle).toBeUndefined();
  });

  it('silently no-ops on unknown station id', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
      lines: [makeLine({ id: 'L1' })],
    });
    const next = T.setDotStyle(doc, 'ghost', 'L1', DOT_SHAPE_PRESETS['filled-white']);
    expect(next).toEqual(doc);
  });

  it('silently no-ops when the station has no stop on lineId', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
      lines: [makeLine({ id: 'L1' })],
    });
    const next = T.setDotStyle(doc, 'a', 'L99', DOT_SHAPE_PRESETS['open-white']);
    expect(next).toEqual(doc);
  });

  it("the invisible 'none' preset is a plain assignment, not a removal", () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
      lines: [makeLine({ id: 'L1' })],
    });
    const next = T.setDotStyle(doc, 'a', 'L1', DOT_SHAPE_PRESETS['none']);
    expect(next.stations.a.stops[0].dotStyle).toEqual(DOT_SHAPE_PRESETS['none']);
  });

  it("clears an existing override when the new style equals the line's default BY VALUE", () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 'a',
          stops: [makeStop('L1', { dotStyle: DOT_SHAPE_PRESETS['open-white'] })],
        }),
      ],
      lines: [makeLine({ id: 'L1', defaultDotStyle: DOT_SHAPE_PRESETS['open-white'] })],
    });
    // A structural clone, not the preset object — equality must be deep.
    const next = T.setDotStyle(doc, 'a', 'L1', cloneStyle(DOT_SHAPE_PRESETS['open-white']));
    expect(next.stations.a.stops[0].dotStyle).toBeUndefined();
  });

  it('clears an existing override when the new style equals the implicit default', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 'a',
          stops: [makeStop('L1', { dotStyle: DOT_SHAPE_PRESETS['open-white'] })],
        }),
      ],
      lines: [makeLine({ id: 'L1' })],
    });
    const next = T.setDotStyle(doc, 'a', 'L1', cloneStyle(DEFAULT_DOT_STYLE));
    expect(next.stations.a.stops[0].dotStyle).toBeUndefined();
  });

  it("leaves dotStyle undefined when picking the line's default on a stop with no override", () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
      lines: [makeLine({ id: 'L1', defaultDotStyle: DOT_SHAPE_PRESETS['open-white'] })],
    });
    const next = T.setDotStyle(doc, 'a', 'L1', DOT_SHAPE_PRESETS['open-white']);
    expect(next.stations.a.stops[0].dotStyle).toBeUndefined();
  });

  it("stores the default style as an explicit override when the line's default is something else", () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
      lines: [makeLine({ id: 'L1', defaultDotStyle: DOT_SHAPE_PRESETS['open-white'] })],
    });
    const next = T.setDotStyle(doc, 'a', 'L1', DEFAULT_DOT_STYLE);
    expect(next.stations.a.stops[0].dotStyle).toEqual(DEFAULT_DOT_STYLE);
  });
});

describe('setLineDefaultDotStyle', () => {
  it('sets the field when the new style is not the default', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    const next = T.setLineDefaultDotStyle(doc, 'L1', DOT_SHAPE_PRESETS['open-white']);
    expect(next.lines.L1.defaultDotStyle).toEqual(DOT_SHAPE_PRESETS['open-white']);
  });

  it('drops the field when the new style equals the historical default by value', () => {
    const doc = makeDoc({
      lines: [makeLine({ id: 'L1', defaultDotStyle: DOT_SHAPE_PRESETS['open-white'] })],
    });
    const next = T.setLineDefaultDotStyle(doc, 'L1', cloneStyle(DEFAULT_DOT_STYLE));
    expect(next.lines.L1.defaultDotStyle).toBeUndefined();
    expect('defaultDotStyle' in next.lines.L1).toBe(false);
  });

  it('silently no-ops on unknown line id', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    expect(T.setLineDefaultDotStyle(doc, 'ghost', DOT_SHAPE_PRESETS['open-white'])).toBe(doc);
  });

  it('returns the same doc reference when the value is unchanged (deep-equal input)', () => {
    const doc = makeDoc({
      lines: [makeLine({ id: 'L1', defaultDotStyle: DOT_SHAPE_PRESETS['open-white'] })],
    });
    expect(T.setLineDefaultDotStyle(doc, 'L1', cloneStyle(DOT_SHAPE_PRESETS['open-white']))).toBe(
      doc,
    );
  });

  it('returns the same doc reference when clearing an already-cleared default', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    expect(T.setLineDefaultDotStyle(doc, 'L1', DEFAULT_DOT_STYLE)).toBe(doc);
  });

  it('clears per-stop overrides that match the NEW default', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 'a',
          stops: [makeStop('L1', { dotStyle: DOT_SHAPE_PRESETS['open-white'] })],
        }),
        makeStation({
          id: 'b',
          stops: [makeStop('L1', { dotStyle: DOT_SHAPE_PRESETS['filled-black-diamond'] })],
        }),
        makeStation({ id: 'c', stops: [makeStop('L1')] }),
      ],
      lines: [makeLine({ id: 'L1' })],
    });
    const next = T.setLineDefaultDotStyle(doc, 'L1', cloneStyle(DOT_SHAPE_PRESETS['open-white']));
    // 'a' matched the new default — override cleared.
    expect(next.stations.a.stops[0].dotStyle).toBeUndefined();
    expect('dotStyle' in next.stations.a.stops[0]).toBe(false);
    // 'b' had a different explicit style — left alone.
    expect(next.stations.b.stops[0].dotStyle).toEqual(DOT_SHAPE_PRESETS['filled-black-diamond']);
    // 'c' had no override — still none.
    expect(next.stations.c.stops[0].dotStyle).toBeUndefined();
  });

  it('clears per-stop default-style overrides when the default is reset to the default', () => {
    const doc = makeDoc({
      stations: [
        makeStation({ id: 'a', stops: [makeStop('L1', { dotStyle: DEFAULT_DOT_STYLE })] }),
      ],
      lines: [makeLine({ id: 'L1', defaultDotStyle: DOT_SHAPE_PRESETS['open-white'] })],
    });
    const next = T.setLineDefaultDotStyle(doc, 'L1', DEFAULT_DOT_STYLE);
    expect(next.lines.L1.defaultDotStyle).toBeUndefined();
    expect(next.stations.a.stops[0].dotStyle).toBeUndefined();
  });

  it('leaves overrides on OTHER lines untouched when a default changes', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 'a',
          stops: [
            makeStop('L1', { dotStyle: DOT_SHAPE_PRESETS['open-white'] }),
            makeStop('L2', { col: 1, dotStyle: DOT_SHAPE_PRESETS['open-white'] }),
          ],
        }),
      ],
      lines: [makeLine({ id: 'L1' }), makeLine({ id: 'L2' })],
    });
    const next = T.setLineDefaultDotStyle(doc, 'L1', DOT_SHAPE_PRESETS['open-white']);
    expect(next.stations.a.stops[0].dotStyle).toBeUndefined();
    expect(next.stations.a.stops[1].dotStyle).toEqual(DOT_SHAPE_PRESETS['open-white']);
  });
});

describe('setDotSize', () => {
  it('writes the size onto the targeted stop only', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1'), makeStop('L2', { col: 1 })] })],
      lines: [makeLine({ id: 'L1' }), makeLine({ id: 'L2' })],
    });
    const next = T.setDotSize(doc, 'a', 'L1', 16);
    expect(next.stations.a.stops[0].dotSize).toBe(16);
    expect(next.stations.a.stops[1].dotSize).toBeUndefined();
  });

  it('leaves sibling stations untouched', () => {
    const doc = makeDoc({
      stations: [
        makeStation({ id: 'a', stops: [makeStop('L1')] }),
        makeStation({ id: 'b', stops: [makeStop('L1')] }),
      ],
      lines: [makeLine({ id: 'L1' })],
    });
    const next = T.setDotSize(doc, 'a', 'L1', 16);
    expect(next.stations.a.stops[0].dotSize).toBe(16);
    expect(next.stations.b.stops[0].dotSize).toBeUndefined();
  });

  it("clears an existing override when set to the line's EFFECTIVE default", () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1', { dotSize: 12 })] })],
      lines: [makeLine({ id: 'L1', defaultDotSize: 10 })],
    });
    const next = T.setDotSize(doc, 'a', 'L1', 10);
    expect('dotSize' in next.stations.a.stops[0]).toBe(false);
  });

  it('clears an existing override when set to the implicit default', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1', { dotSize: 12 })] })],
      lines: [makeLine({ id: 'L1' })],
    });
    const next = T.setDotSize(doc, 'a', 'L1', DOT_SIZE_DEFAULT);
    expect('dotSize' in next.stations.a.stops[0]).toBe(false);
  });

  it("stores the global default as an explicit override when the line's default differs", () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
      lines: [makeLine({ id: 'L1', defaultDotSize: 10 })],
    });
    const next = T.setDotSize(doc, 'a', 'L1', DOT_SIZE_DEFAULT);
    expect(next.stations.a.stops[0].dotSize).toBe(DOT_SIZE_DEFAULT);
  });

  it('rounds to the integer grid and clamps to ≥ DOT_SIZE_MIN', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
      lines: [makeLine({ id: 'L1' })],
    });
    expect(T.setDotSize(doc, 'a', 'L1', 7.4).stations.a.stops[0].dotSize).toBe(7);
    expect(T.setDotSize(doc, 'a', 'L1', -3).stations.a.stops[0].dotSize).toBe(0);
  });

  it('ignores non-finite input (same reference out)', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
      lines: [makeLine({ id: 'L1' })],
    });
    expect(T.setDotSize(doc, 'a', 'L1', NaN)).toBe(doc);
    expect(T.setDotSize(doc, 'a', 'L1', Infinity)).toBe(doc);
  });

  it('returns the same doc reference when the stored form is unchanged', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1', { dotSize: 16 })] })],
      lines: [makeLine({ id: 'L1' })],
    });
    expect(T.setDotSize(doc, 'a', 'L1', 16)).toBe(doc);
    // A tracking stop set to the effective default is equally a no-op.
    const tracking = makeDoc({
      stations: [makeStation({ id: 'b', stops: [makeStop('L1')] })],
      lines: [makeLine({ id: 'L1' })],
    });
    expect(T.setDotSize(tracking, 'b', 'L1', DOT_SIZE_DEFAULT)).toBe(tracking);
  });

  it('silently no-ops on unknown station / line without a stop', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
      lines: [makeLine({ id: 'L1' })],
    });
    expect(T.setDotSize(doc, 'ghost', 'L1', 16)).toBe(doc);
    expect(T.setDotSize(doc, 'a', 'L99', 16)).toBe(doc);
  });
});

describe('setLineDefaultDotSize', () => {
  it('stores a non-default size', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    const next = T.setLineDefaultDotSize(doc, 'L1', 12);
    expect(next.lines.L1.defaultDotSize).toBe(12);
  });

  it('drops the field when set to DOT_SIZE_DEFAULT', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1', defaultDotSize: 12 })] });
    const next = T.setLineDefaultDotSize(doc, 'L1', DOT_SIZE_DEFAULT);
    expect('defaultDotSize' in next.lines.L1).toBe(false);
  });

  it('a value that rounds onto the default is dropped like an exact one', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1', defaultDotSize: 12 })] });
    const next = T.setLineDefaultDotSize(doc, 'L1', DOT_SIZE_DEFAULT + 0.3);
    expect('defaultDotSize' in next.lines.L1).toBe(false);
  });

  it('reference-equal no-ops: unchanged value, unknown id, non-finite input', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1', defaultDotSize: 12 })] });
    expect(T.setLineDefaultDotSize(doc, 'L1', 12)).toBe(doc);
    expect(T.setLineDefaultDotSize(doc, 'ghost', 16)).toBe(doc);
    expect(T.setLineDefaultDotSize(doc, 'L1', NaN)).toBe(doc);
    const bare = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    expect(T.setLineDefaultDotSize(bare, 'L1', DOT_SIZE_DEFAULT)).toBe(bare);
  });

  it('clears per-stop overrides equal to the NEW default; different overrides untouched', () => {
    const doc = makeDoc({
      stations: [
        makeStation({ id: 'a', stops: [makeStop('L1', { dotSize: 10 })] }),
        makeStation({ id: 'b', stops: [makeStop('L1', { dotSize: 16 })] }),
        makeStation({ id: 'c', stops: [makeStop('L1')] }),
      ],
      lines: [makeLine({ id: 'L1' })],
    });
    const next = T.setLineDefaultDotSize(doc, 'L1', 10);
    // 'a' matched the new default — override cleared.
    expect('dotSize' in next.stations.a.stops[0]).toBe(false);
    // 'b' had a different explicit size — left alone.
    expect(next.stations.b.stops[0].dotSize).toBe(16);
    // 'c' had no override — still none.
    expect(next.stations.c.stops[0].dotSize).toBeUndefined();
  });

  it('leaves overrides on OTHER lines untouched when a default changes', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 'a',
          stops: [makeStop('L1', { dotSize: 10 }), makeStop('L2', { col: 1, dotSize: 10 })],
        }),
      ],
      lines: [makeLine({ id: 'L1' }), makeLine({ id: 'L2' })],
    });
    const next = T.setLineDefaultDotSize(doc, 'L1', 10);
    expect('dotSize' in next.stations.a.stops[0]).toBe(false);
    expect(next.stations.a.stops[1].dotSize).toBe(10);
  });

  it('clears per-stop default-size overrides when the default is reset to the default', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1', { dotSize: DOT_SIZE_DEFAULT })] })],
      lines: [makeLine({ id: 'L1', defaultDotSize: 12 })],
    });
    const next = T.setLineDefaultDotSize(doc, 'L1', DOT_SIZE_DEFAULT);
    expect('defaultDotSize' in next.lines.L1).toBe(false);
    expect('dotSize' in next.stations.a.stops[0]).toBe(false);
  });

  it('acceptance: default 7, stop at 8 — 7→9 keeps 8; 7→8 absorbs it; 8→9 moves the stop', () => {
    let doc = makeDoc({
      stations: [
        makeStation({ id: 's', stops: [makeStop('L1')] }),
        makeStation({ id: 't', stops: [makeStop('L1')] }),
      ],
      lines: [makeLine({ id: 'L1' })],
    });
    doc = T.setLineDefaultDotSize(doc, 'L1', 7);
    doc = T.setDotSize(doc, 's', 'L1', 8);
    expect(doc.stations.s.stops[0].dotSize).toBe(8);

    // 7 → 9: S's explicit 8 is untouched; tracking T follows the default.
    doc = T.setLineDefaultDotSize(doc, 'L1', 9);
    expect(doc.stations.s.stops[0].dotSize).toBe(8);
    expect(doc.stations.t.stops[0].dotSize).toBeUndefined();
    expect(doc.lines.L1.defaultDotSize).toBe(9);

    // 9 → 8: S's override equals the new default — absorbed.
    doc = T.setLineDefaultDotSize(doc, 'L1', 8);
    expect('dotSize' in doc.stations.s.stops[0]).toBe(false);

    // 8 → 9: S now tracks the default along with T.
    doc = T.setLineDefaultDotSize(doc, 'L1', 9);
    expect(doc.stations.s.stops[0].dotSize).toBeUndefined();
    expect(doc.lines.L1.defaultDotSize).toBe(9);
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
          stops: [makeStop('L1', { dotStyle: DOT_SHAPE_PRESETS['filled-white'] })],
        }),
      ],
    });
    const next = T.setStationWaypoint(doc, 'a', true);
    expect(next.stations.a).toMatchObject({
      id: 'a',
      name: 'Anvil',
      isWaypoint: true,
    });
    expect(next.stations.a.stops[0].dotStyle).toEqual(DOT_SHAPE_PRESETS['filled-white']);
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
      leading: 1,
      tracking: 0,
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
  it('clamps fontSize at MIN only (textbox accepts arbitrary above) and snaps to the nearest 0.25', () => {
    const doc = makeDoc({ textLabels: [makeTextLabel({ id: 'g1', fontSize: 16 })] });
    expect(T.updateTextLabel(doc, 'g1', { fontSize: 0 }).textLabels.g1.fontSize).toBe(1);
    expect(T.updateTextLabel(doc, 'g1', { fontSize: 999 }).textLabels.g1.fontSize).toBe(999);
    expect(T.updateTextLabel(doc, 'g1', { fontSize: 23.7 }).textLabels.g1.fontSize).toBe(23.75);
    expect(T.updateTextLabel(doc, 'g1', { fontSize: 23.5 }).textLabels.g1.fontSize).toBe(23.5);
  });
  it('clamps column width to a non-negative integer (0 = Auto)', () => {
    const doc = makeDoc({ textLabels: [makeTextLabel({ id: 'g1' })] });
    expect(T.updateTextLabel(doc, 'g1', { width: -5 }).textLabels.g1.width).toBe(0);
    expect(T.updateTextLabel(doc, 'g1', { width: 0 }).textLabels.g1.width).toBe(0);
    expect(T.updateTextLabel(doc, 'g1', { width: 200.6 }).textLabels.g1.width).toBe(201);
  });
  it('clamps leading at 0 and snaps to the 0.05 step', () => {
    const doc = makeDoc({ textLabels: [makeTextLabel({ id: 'g1' })] });
    expect(T.updateTextLabel(doc, 'g1', { leading: -0.5 }).textLabels.g1.leading).toBe(0);
    expect(T.updateTextLabel(doc, 'g1', { leading: 1.234 }).textLabels.g1.leading).toBe(1.25);
    expect(T.updateTextLabel(doc, 'g1', { leading: 1.05 }).textLabels.g1.leading).toBe(1.05);
  });
  it('clamps tracking at the slider floor and snaps to the 0.001 step', () => {
    const doc = makeDoc({ textLabels: [makeTextLabel({ id: 'g1' })] });
    expect(T.updateTextLabel(doc, 'g1', { tracking: -0.5 }).textLabels.g1.tracking).toBe(
      T.TEXT_LABEL_TRACKING_MIN,
    );
    expect(T.updateTextLabel(doc, 'g1', { tracking: 0.123 }).textLabels.g1.tracking).toBe(0.123);
    expect(T.updateTextLabel(doc, 'g1', { tracking: 0.05 }).textLabels.g1.tracking).toBe(0.05);
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

  it('preserves the upper-left corner when a column width is set (re-wraps + re-boxes)', () => {
    const doc = makeDoc({
      textLabels: [
        makeTextLabel({ id: 'g1', x: 100, y: 100, text: 'aaaa bbbb cccc', align: 'left' }),
      ],
    });
    const before = upperLeftOf(doc.textLabels.g1);
    // A narrow column wraps the one line into three and shrinks the box width;
    // the re-anchor must pin the top-left through both changes.
    const next = T.updateTextLabel(doc, 'g1', { width: 40 });
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

  it('preserves the upper-left corner when leading grows a multi-line label', () => {
    const doc = makeDoc({
      textLabels: [makeTextLabel({ id: 'g1', x: 40, y: 40, text: 'a\nb\nc' })],
    });
    const before = upperLeftOf(doc.textLabels.g1);
    const next = T.updateTextLabel(doc, 'g1', { leading: 2 });
    const after = upperLeftOf(next.textLabels.g1);
    expect(next.textLabels.g1.y).toBeGreaterThan(40); // box grew downward
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  it('preserves the upper-left corner when tracking widens the text', () => {
    const doc = makeDoc({
      textLabels: [makeTextLabel({ id: 'g1', x: 40, y: 40, text: 'abcdef', align: 'left' })],
    });
    const before = upperLeftOf(doc.textLabels.g1);
    const next = T.updateTextLabel(doc, 'g1', { tracking: 0.5 });
    const after = upperLeftOf(next.textLabels.g1);
    expect(next.textLabels.g1.x).toBeGreaterThan(40); // box grew rightward
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  // The upper-left tests above only exercise the default 'left' alignment.
  // The re-anchor pins a DIFFERENT horizontal edge per align (the `dx` branch
  // in updateTextLabel): center holds the center, right pins the right edge —
  // so that editing one line of a multi-line label doesn't drag its siblings
  // sideways. A sign error in either branch would pass every 'left' test.
  it('keeps the center x fixed when a center-aligned label grows', () => {
    const doc = makeDoc({
      textLabels: [makeTextLabel({ id: 'g1', x: 100, y: 100, fontSize: 16, align: 'center' })],
    });
    const next = T.updateTextLabel(doc, 'g1', { fontSize: 32 });
    // dx === 0: the box grows symmetrically about its center, so x is untouched.
    expect(next.textLabels.g1.x).toBe(100);
  });

  it('preserves the upper-right corner when a right-aligned label grows', () => {
    const upperRightOf = (label: TextLabel) => {
      const m = measureTextLabel(label);
      return { x: label.x + m.width / 2, y: label.y - m.height / 2 };
    };
    const doc = makeDoc({
      textLabels: [makeTextLabel({ id: 'g1', x: 100, y: 100, fontSize: 16, align: 'right' })],
    });
    const before = upperRightOf(doc.textLabels.g1);
    const next = T.updateTextLabel(doc, 'g1', { fontSize: 32 });
    const after = upperRightOf(next.textLabels.g1);
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
    // Distinct from left/center: the right branch shifts x LEFT as the box grows.
    expect(next.textLabels.g1.x).toBeLessThan(100);
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

  it('keeps a shared station when two lines agree within the noise floor (sub-pixel)', () => {
    // s is the single intermediate on both L1 and L2 between a and b, so both
    // lines target the same midpoint (20,0); their proposals differ only by s's
    // two stop offsets — cell (0,0) vs (0,0.05) = 0.7px apart (STOP_SIZE 14 ×
    // 0.05). 0.7px is below the shared REDISTRIBUTE_EPS (1px) noise floor, so it
    // must NOT be flagged a conflict. The old code used a tighter 0.5px conflict
    // threshold and dropped s (returning the doc unchanged by reference).
    const doc = makeDoc({
      stations: [
        makeStation({ id: 'a', x: 0, y: 0, stops: [makeStop('L1'), makeStop('L2')] }),
        makeStation({ id: 'b', x: 40, y: 0, stops: [makeStop('L1'), makeStop('L2')] }),
        makeStation({
          id: 's',
          x: 5,
          y: 5,
          stops: [makeStop('L1', { row: 0, col: 0 }), makeStop('L2', { row: 0, col: 0.05 })],
        }),
      ],
      lines: [
        makeLine({ id: 'L1', stations: ['a', 's', 'b'] }),
        makeLine({ id: 'L2', stations: ['a', 's', 'b'] }),
      ],
    });
    const next = T.redistributeBetween(doc, 'a', 'b', 'straight');
    expect(next).not.toBe(doc); // s was redistributed, not dropped as a conflict
    expect(next.stations.s.x).not.toBe(5); // moved off its original position
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

    it('rounds each intermediate to a 5px grid when gridInterval is 5', () => {
      // Endpoints 24 apart → even centers fall at 6, 12, 18. A 5px grid rounds
      // them to 5, 10, 20 (vs 10, 10, 20 on the default 10px grid) — the
      // distinguishing values that prove the interval is threaded through.
      const doc = doc5([
        ['a', 0, 0],
        ['m1', 5, 5],
        ['m2', 5, 5],
        ['m3', 5, 5],
        ['b', 24, 0],
      ]);
      const next = T.redistributeBetween(doc, 'a', 'b', 'straight', 'both', 5);
      expect(next.stations.m1).toMatchObject({ x: 5, y: 0 });
      expect(next.stations.m2).toMatchObject({ x: 10, y: 0 });
      expect(next.stations.m3).toMatchObject({ x: 20, y: 0 });
    });
  });

  // The 5° ANGLE_THRESHOLD (transforms.ts:526) decides, in arc-bends mode,
  // whether an intermediate station is a real "bend" (anchored, left in place)
  // or a smooth point (redistributed). The threshold is on the TURN angle —
  // the deviation from straight, computed as acos of the dot product of the two
  // adjacent stop-segment directions — and the test is `angle > ANGLE_THRESHOLD`
  // in RADIANS. The chain a=(0,0), m=(40,h), b=(120,0) has a single intermediate
  // m, so:
  //   • a bend just UNDER 5° leaves m as a non-anchor → it redistributes to the
  //     arc-length midpoint of a→m→b (≈20px away from m here) and the doc changes;
  //   • a bend just OVER 5° anchors m → with no other intermediate there is
  //     nothing left to redistribute, so the doc comes back by reference.
  // The just-over case is the one that breaks if the conversion is dropped
  // (degrees compared as radians): 5 radians ≈ 286°, so every realistic bend
  // falls under it and m would wrongly redistribute. (Red-proof below.)
  describe('arc-bends bend threshold (5°)', () => {
    const bendDoc = (h: number): MapDoc =>
      makeDoc({
        stations: [
          stationWithStop('a', 'L1', { x: 0, y: 0 }),
          stationWithStop('m', 'L1', { x: 40, y: h }),
          stationWithStop('b', 'L1', { x: 120, y: 0 }),
        ],
        lines: [makeLine({ id: 'L1', stations: ['a', 'm', 'b'] })],
      });

    it('redistributes the middle station when the bend is just under 5°', () => {
      // h = 2.2 → turn angle ≈ 4.72° (< 5°): not a bend, so m is redistributed.
      const doc = bendDoc(2.2);
      const next = T.redistributeBetween(doc, 'a', 'b', 'arc-bends');
      expect(next).not.toBe(doc);
      // m lands on the arc-length midpoint of a→m→b, ~20px off its start (40, 2.2).
      expect(next.stations.m.x).toBeCloseTo(59.98, 1);
      expect(next.stations.m.y).toBeCloseTo(1.65, 1);
    });

    it('anchors the middle station when the bend is just over 5°', () => {
      // h = 3.0 → turn angle ≈ 6.44° (> 5°): a real bend, so m is anchored and
      // — being the only intermediate — nothing is redistributed (identity return).
      const doc = bendDoc(3.0);
      expect(T.redistributeBetween(doc, 'a', 'b', 'arc-bends')).toBe(doc);
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
