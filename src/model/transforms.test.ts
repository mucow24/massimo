import { describe, it, expect } from 'vitest';
import * as T from './transforms';
import {
  DEFAULT_DOT_STYLE,
  DEFAULT_STOP_DOT_STYLE_ID,
  DOT_SHAPE_PRESETS,
  STOP_DOT_FACTORY_STYLES,
  resolveDotRender,
} from './dotStyle';
import { DOT_SIZE_DEFAULT, dotSizeOverride } from './dotSize';
import { measureTextLabel } from '../geometry/textMeasure';
import { localToWorld, stopCenterAt } from '../geometry/orientation';
import { stopPosWorld } from '../geometry/interlining';
import {
  makeDoc,
  makeLine,
  makeLineTag,
  makePolygon,
  makeStation,
  makeStop,
  makeStyle,
  makeTextLabel,
  makeTransfer,
  stationWithStop,
} from '../test/fixtures';
import type { DotStyle, MapDoc, RouteBullet, Station, TextLabel } from './types';
import type { Palette } from './palettes';

describe('clampRouteBulletSize', () => {
  it('keeps the size it is given and clamps to the floor ROUTE_BULLET_SIZE_MIN', () => {
    expect(T.ROUTE_BULLET_SIZE_STEP).toBe(0.25);
    expect(T.clampRouteBulletSize(14.25)).toBe(14.25);
    // The step is the slider's/wheel's granularity, not a filter on the value.
    expect(T.clampRouteBulletSize(14.3)).toBe(14.3);
    // Below the floor clamps up to the minimum.
    expect(T.clampRouteBulletSize(-3)).toBe(T.ROUTE_BULLET_SIZE_MIN);
    // Above the slider max is allowed (only the floor clamps).
    expect(T.clampRouteBulletSize(999)).toBe(999);
  });
});

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
    // New stations default to auto placement (the magic wand on) with the H/V
    // tuning left on auto — so a fresh label places itself transit-map style.
    // The underlying align/valign are the overridden fallbacks used if the
    // wand is turned off.
    expect(doc.stations.s1.label).toEqual({
      row: 0,
      col: -1,
      rotation: 0,
      offset: 0,
      offsetPerp: 0,
      align: 'auto',
      valign: 'auto-down',
      autoAlign: true,
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

describe('setLabelAutoHAlign / setLabelAutoVAlign', () => {
  it('sets the H override and clears it back to auto (key removed)', () => {
    const doc = makeDoc({ stations: [makeStation({ id: 's1' })] });
    const on = T.setLabelAutoHAlign(doc, 's1', 'end');
    expect(on.stations.s1.label.autoHAlign).toBe('end');
    const off = T.setLabelAutoHAlign(on, 's1', null);
    expect('autoHAlign' in off.stations.s1.label).toBe(false);
  });

  it('sets the V override and clears it back to auto (key removed)', () => {
    const doc = makeDoc({ stations: [makeStation({ id: 's1' })] });
    const on = T.setLabelAutoVAlign(doc, 's1', 'down');
    expect(on.stations.s1.label.autoVAlign).toBe('down');
    const off = T.setLabelAutoVAlign(on, 's1', null);
    expect('autoVAlign' in off.stations.s1.label).toBe(false);
  });

  it('returns the same doc reference when unchanged (no-op)', () => {
    const doc = makeDoc({ stations: [makeStation({ id: 's1' })] }); // both absent = auto
    expect(T.setLabelAutoHAlign(doc, 's1', null)).toBe(doc);
    expect(T.setLabelAutoVAlign(doc, 's1', null)).toBe(doc);
    const on = T.setLabelAutoVAlign(doc, 's1', 'up');
    expect(T.setLabelAutoVAlign(on, 's1', 'up')).toBe(on);
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

  // A station turns about its own PICTURE. Cell (0,0) is the pin, and it paints
  // nothing, so a layout parked off it must not swing on a radius nobody can
  // see. x/y takes up the slack; the cells never move.
  it('holds the layout still and moves the pin instead', () => {
    // Stops on cols 1 and 2. Pivot = corner + round(centroid − corner)
    // = col 1 + round(0.5) = col 2, so the col-2 dot is the fixed point.
    let doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          stops: [makeStop('L1', { col: 1 }), makeStop('L2', { col: 2 })],
        }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1'] }), makeLine({ id: 'L2', stations: ['s1'] })],
    });
    const pivotBefore = stopPosWorld(doc.stations.s1.stops[1], doc.stations.s1, doc.lineCircles);
    doc = T.rotateStation(doc, 's1');
    const pivotAfter = stopPosWorld(doc.stations.s1.stops[1], doc.stations.s1, doc.lineCircles);
    expect(pivotAfter.x).toBeCloseTo(pivotBefore.x, 9);
    expect(pivotAfter.y).toBeCloseTo(pivotBefore.y, 9);
    // The cells are untouched — only the pin absorbed the turn.
    expect(doc.stations.s1.stops.map((c) => c.col)).toEqual([1, 2]);
    expect(doc.stations.s1.x).not.toBe(0);
  });

  it('leaves a pin-centred layout exactly where it was (no x/y churn)', () => {
    // Single stop on cell (0,0): pivot IS the pin, so the old behavior must
    // survive byte-identical rather than pick up a rounding wobble.
    let doc = makeDoc({
      stations: [makeStation({ id: 's1', x: 40, y: -10, stops: [makeStop('L1')] })],
      lines: [makeLine({ id: 'L1', stations: ['s1'] })],
    });
    doc = T.rotateStation(doc, 's1');
    expect(doc.stations.s1.x).toBe(40);
    expect(doc.stations.s1.y).toBe(-10);
  });

  it('leaves a ring-bound station on the old pin-pivot path', () => {
    // A bound station reads its cell frame off the ring (stationFrameRad), so
    // compensating x/y would move the station along the ring and change the
    // very frame the compensation was computed in. Left alone deliberately.
    let doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          x: 100,
          y: 0,
          circleId: 'c1',
          stops: [makeStop('L1', { col: 2 })],
        }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1'] })],
    });
    doc = { ...doc, lineCircles: { c1: { id: 'c1', x: 0, y: 0, radius: 100 } } };
    doc = T.rotateStation(doc, 's1');
    expect(doc.stations.s1.x).toBe(100);
    expect(doc.stations.s1.y).toBe(0);
  });
});

describe('stationPivotWorld / moveStationPivotTo', () => {
  it('names the world position of the pivot cell — the same point rotateStation holds', () => {
    // Single stop on col 2: the pivot cell IS that stop, so the pivot world
    // point is exactly where the dot paints.
    const doc = makeDoc({
      stations: [
        makeStation({ id: 's1', x: 40, y: -10, rotation: 3, stops: [makeStop('L1', { col: 2 })] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1'] })],
    });
    const st = doc.stations.s1;
    const p = T.stationPivotWorld(st, doc.lines, doc.lineCircles);
    const dot = stopPosWorld(st.stops[0], st, doc.lineCircles);
    expect(p.x).toBeCloseTo(dot.x, 9);
    expect(p.y).toBeCloseTo(dot.y, 9);
  });

  it('a ring-bound station pivots on its PIN, so that is what the coordinate names', () => {
    // rotateStation keeps the pin pivot on a ring (the cell frame is the
    // ring's, so a compensating x/y move would change the very frame it was
    // measured in). The coordinate must name the same point, or the readout
    // walks around the layout while the station never moves.
    const base = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          x: 100,
          y: 0,
          rotation: 1,
          circleId: 'c1',
          stops: [makeStop('L1', { col: 2 })],
        }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1'] })],
    });
    const doc = { ...base, lineCircles: { c1: { id: 'c1', x: 0, y: 0, radius: 100 } } };
    const p = T.stationPivotWorld(doc.stations.s1, doc.lines, doc.lineCircles);
    expect(p).toEqual({ x: 100, y: 0 });
  });

  it('ring-bound: the coordinate is invariant across all 8 rotate steps', () => {
    const base = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          x: 100,
          y: 0,
          circleId: 'c1',
          stops: [makeStop('L1', { col: 2 })],
        }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1'] })],
    });
    let doc: MapDoc = { ...base, lineCircles: { c1: { id: 'c1', x: 0, y: 0, radius: 100 } } };
    const before = T.stationPivotWorld(doc.stations.s1, doc.lines, doc.lineCircles);
    for (let i = 0; i < 8; i++) {
      doc = T.rotateStation(doc, 's1');
      const p = T.stationPivotWorld(doc.stations.s1, doc.lines, doc.lineCircles);
      expect(p, `step ${i + 1}`).toEqual(before);
    }
  });

  it('is held fixed by rotateStation', () => {
    let doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          stops: [makeStop('L1', { col: 1 }), makeStop('L2', { row: 2, col: 2 })],
        }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1'] }), makeLine({ id: 'L2', stations: ['s1'] })],
    });
    const before = T.stationPivotWorld(doc.stations.s1, doc.lines, doc.lineCircles);
    doc = T.rotateStation(doc, 's1');
    const after = T.stationPivotWorld(doc.stations.s1, doc.lines, doc.lineCircles);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('falls back to the label cell when no stop is live', () => {
    // The label is the only painted thing, so the coordinate names it.
    const doc = makeDoc({
      stations: [makeStation({ id: 's1', x: 7, y: 9 })],
    });
    const st = doc.stations.s1;
    const p = T.stationPivotWorld(st, doc.lines, doc.lineCircles);
    const lab = localToWorld(stopCenterAt(st.label.row, st.label.col), st);
    expect(p.x).toBeCloseTo(lab.x, 9);
    expect(p.y).toBeCloseTo(lab.y, 9);
  });

  it('moveStationPivotTo lands the pivot at the requested point, cells untouched', () => {
    let doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          rotation: 5,
          stops: [makeStop('L1', { col: 1 }), makeStop('L2', { col: 2 })],
        }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1'] }), makeLine({ id: 'L2', stations: ['s1'] })],
    });
    doc = T.moveStationPivotTo(doc, 's1', 123, -45);
    const p = T.stationPivotWorld(doc.stations.s1, doc.lines, doc.lineCircles);
    expect(p.x).toBeCloseTo(123, 9);
    expect(p.y).toBeCloseTo(-45, 9);
    expect(doc.stations.s1.stops.map((c) => c.col)).toEqual([1, 2]);
  });

  it('no-op (same reference) when the pivot is already there', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 's1', stops: [makeStop('L1', { col: 2 })] })],
      lines: [makeLine({ id: 'L1', stations: ['s1'] })],
    });
    const p = T.stationPivotWorld(doc.stations.s1, doc.lines, doc.lineCircles);
    expect(T.moveStationPivotTo(doc, 's1', p.x, p.y)).toBe(doc);
    expect(T.moveStationPivotTo(doc, 'nope', 1, 2)).toBe(doc);
  });

  it('moveStationPivotTo on a ring IS moveStation — same reseat, same landing', () => {
    // Pivot = pin there, so the delta math collapses to the plain absolute
    // move. Anything else converges somewhere the user didn't ask for: the
    // old through-the-ring-frame reading turned the request into an ANGLE
    // shift, landing (0, 500) at (-7.16, 127.8) instead of the rim point
    // nearest the request.
    const base = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          x: 100,
          y: 0,
          circleId: 'c1',
          stops: [makeStop('L1', { col: 2 })],
        }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1'] })],
    });
    const doc: MapDoc = { ...base, lineCircles: { c1: { id: 'c1', x: 0, y: 0, radius: 100 } } };
    expect(T.moveStationPivotTo(doc, 's1', 0, 500)).toEqual(T.moveStation(doc, 's1', 0, 500));
    const st = T.moveStationPivotTo(doc, 's1', 0, 500).stations.s1;
    expect(st.x).toBeCloseTo(0, 6);
    expect(st.y).toBeCloseTo(100, 6);
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

  it('keeps every cell on its world position under a SINGLE ±90° reorient', () => {
    // The whole point of the transform: rotate the layout one way and the
    // station the opposite way so world appearance is unchanged. The R+/R-
    // round-trip above can't catch a sign error that survives its own inverse,
    // and the orientation tests use cell (0,0) where rotateGrid is a no-op.
    // Here a stop and the label sit at NON-zero cells, so a wrong sign in
    // rotateGrid OR in the station/label rotation step moves them in world.
    const worldOf = (row: number, col: number, st: Station) =>
      localToWorld(stopCenterAt(row, col), st);
    for (const dir of [1, -1] as const) {
      const st = makeStation({
        id: 's1',
        rotation: 3,
        stops: [makeStop('L1', { row: 1, col: 2, orientation: 'auto-vertical' })],
        label: { row: 0, col: -1, rotation: 1, offset: 0, align: 'auto', valign: 'middle' },
      });
      const next = T.rotateStationAndLayout(makeDoc({ stations: [st] }), 's1', dir).stations.s1;

      const stopBefore = worldOf(st.stops[0].row, st.stops[0].col, st);
      const stopAfter = worldOf(next.stops[0].row, next.stops[0].col, next);
      expect(stopAfter.x).toBeCloseTo(stopBefore.x, 9);
      expect(stopAfter.y).toBeCloseTo(stopBefore.y, 9);

      const labelBefore = worldOf(st.label.row, st.label.col, st);
      const labelAfter = worldOf(next.label.row, next.label.col, next);
      expect(labelAfter.x).toBeCloseTo(labelBefore.x, 9);
      expect(labelAfter.y).toBeCloseTo(labelBefore.y, 9);

      // The label's WORLD orientation (its own rotation composed with the
      // station's) must also be preserved across the reorient.
      expect((next.label.rotation + next.rotation) % 8).toBe((st.label.rotation + st.rotation) % 8);
    }
  });

  it('applies the exact grid/rotation values for R+ (dir = +1)', () => {
    // Pins the transform's direction so an inverse-preserving sign flip is
    // caught here even though the world-invariance test tolerates it.
    const st = makeStation({
      id: 's1',
      rotation: 3,
      stops: [makeStop('L1', { row: 1, col: 2, orientation: 'auto-vertical' })],
      label: { row: 0, col: -1, rotation: 1, offset: 0, align: 'auto', valign: 'middle' },
    });
    const next = T.rotateStationAndLayout(makeDoc({ stations: [st] }), 's1', 1).stations.s1;
    expect(next.rotation).toBe(1); // 3 + 6 (mod 8): station steps CCW
    expect(next.stops[0]).toMatchObject({ col: -1, row: 2, orientation: 'auto-horizontal' });
    expect(next.label).toMatchObject({ col: 0, row: -1, rotation: 3 }); // label steps +2
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
    // Asserted as whole ends rather than `.lineId` reads: TransferEnd is a
    // union now, and this pins the STOP arm's exact stored shape (which is
    // also what every pre-union saved file carries).
    expect(next.transfers.x1.a).toEqual({ stationId: 's1', lineId: null });
    expect(next.transfers.x1.b).toEqual({ stationId: 's2', lineId: null });
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

describe('self-transfers', () => {
  const withStop = (over: Partial<Station> = {}) =>
    makeDoc({
      stations: [makeStation({ id: 's1', stops: [makeStop('L1')], ...over })],
      lines: [makeLine({ id: 'L1', stations: ['s1'] })],
    });

  it('adds a transfer whose two ends are the SAME stop', () => {
    const next = T.addSelfTransfer(withStop(), 'x1', 's1', 'L1');
    expect(next.transfers.x1).toEqual({
      id: 'x1',
      a: { stationId: 's1', lineId: 'L1' },
      b: { stationId: 's1', lineId: 'L1' },
    });
  });

  it('refuses when the station has no stop for that line', () => {
    const doc = withStop({ stops: [] });
    expect(T.addSelfTransfer(doc, 'x1', 's1', 'L1')).toBe(doc);
  });

  it('refuses when the station is gone', () => {
    const doc = withStop();
    expect(T.addSelfTransfer(doc, 'x1', 'ghost', 'L1')).toBe(doc);
  });

  it('refuses a SECOND self-transfer on the same stop — it is a singleton', () => {
    const doc = T.addSelfTransfer(withStop(), 'x1', 's1', 'L1');
    expect(T.addSelfTransfer(doc, 'x2', 's1', 'L1')).toBe(doc);
  });

  it('selfTransferAt finds it, and ignores a same-station transfer between two DOTS', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 's1', stops: [makeStop('L1'), makeStop('L2', { col: 1 })] })],
      lines: [makeLine({ id: 'L1', stations: ['s1'] }), makeLine({ id: 'L2', stations: ['s1'] })],
      transfers: [
        { id: 'pair', a: { stationId: 's1', lineId: 'L1' }, b: { stationId: 's1', lineId: 'L2' } },
      ],
    });
    expect(T.selfTransferAt(doc, 's1', 'L1')).toBeUndefined();
    const next = T.addSelfTransfer(doc, 'x1', 's1', 'L1');
    expect(T.selfTransferAt(next, 's1', 'L1')?.id).toBe('x1');
    // …and it is scoped to the stop it was made on, not the whole station.
    expect(T.selfTransferAt(next, 's1', 'L2')).toBeUndefined();
  });

  it('cascade-deletes with its stop, its line and its station', () => {
    const doc = T.addSelfTransfer(withStop(), 'x1', 's1', 'L1');
    expect(T.removeStationFromLine(doc, 'L1', 0).transfers.x1).toBeUndefined();
    expect(T.deleteLine(doc, 'L1').transfers.x1).toBeUndefined();
    expect(T.deleteStation(doc, 's1').transfers.x1).toBeUndefined();
  });

  it('leaves the two-click flow alone: addTransfer still refuses a zero-length pair', () => {
    const doc = withStop();
    const end = { stationId: 's1', lineId: 'L1' as const };
    expect(T.addTransfer(doc, 'x1', end, { ...end })).toBe(doc);
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
    expect(next.transfers.x3.a).toEqual({ stationId: 's1', lineId: null });
    expect(next.transfers.x3.b).toEqual({ stationId: 's2', lineId: 'L2' });
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

describe('rotateLabel', () => {
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
      // `|a|b|` is a real bullet token for service `a|b`. If the delimiter
      // guard were dropped, the rewrite would mangle it into `|A|`; the guard
      // must leave the literal text untouched.
      const doc = makeDoc({
        lines: [makeLine({ id: 'L1', service: 'a|b' })],
        textLabels: [makeTextLabel({ id: 't1', text: '|a|b| here' })],
      });
      const next = T.updateLine(doc, 'L1', { service: 'A' });
      expect(next.lines.L1.service).toBe('A');
      expect(next.textLabels.t1.text).toBe('|a|b| here');
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

  it('clamps to the floor and stores the width as given', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    expect(T.setLineWidth(doc, 'L1', 0).lines.L1.width).toBe(1);
    expect(T.setLineWidth(doc, 'L1', -3).lines.L1.width).toBe(1);
    expect(T.setLineWidth(doc, 'L1', 9.6).lines.L1.width).toBe(9.6);
    // Only an EXACT default drops the field; 14.1 is a real width.
    expect(T.setLineWidth(doc, 'L1', 14.1).lines.L1.width).toBe(14.1);
    expect('width' in T.setLineWidth(doc, 'L1', 14).lines.L1).toBe(false);
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

  it('clamps to the floor and stores the casing width as given', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    // Below-floor clamps to 0 = the default, so the field is never stored.
    expect(T.setLineStrokeWidth(doc, 'L1', -3)).toBe(doc);
    expect(T.setLineStrokeWidth(doc, 'L1', 3.6).lines.L1.strokeWidth).toBe(3.6);
    expect(T.setLineStrokeWidth(doc, 'L1', 3.8).lines.L1.strokeWidth).toBe(3.8);
    // Only an exact 0 drops: 0.1 is a hairline casing, not "off".
    expect(T.setLineStrokeWidth(doc, 'L1', 0.1).lines.L1.strokeWidth).toBe(0.1);
    expect(T.setLineStrokeWidth(doc, 'L1', 0)).toBe(doc);
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

describe('setLineCurveRadius', () => {
  it('stores a non-default radius', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    expect(T.setLineCurveRadius(doc, 'L1', 40).lines.L1.curveRadius).toBe(40);
  });

  it('drops the field entirely when set back to the default 24', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1', curveRadius: 40 })] });
    const next = T.setLineCurveRadius(doc, 'L1', 24);
    expect('curveRadius' in next.lines.L1).toBe(false);
  });

  it('returns the input doc unchanged when setting the default on a bare line', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    expect(T.setLineCurveRadius(doc, 'L1', 24)).toBe(doc);
  });

  it('returns the input doc unchanged when the radius is already stored', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1', curveRadius: 40 })] });
    expect(T.setLineCurveRadius(doc, 'L1', 40)).toBe(doc);
  });

  it('clamps to the floor and stores the radius as given', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    expect(T.setLineCurveRadius(doc, 'L1', 1).lines.L1.curveRadius).toBe(4);
    expect(T.setLineCurveRadius(doc, 'L1', 39.6).lines.L1.curveRadius).toBe(39.6);
    // Only an EXACT default is dropped; 23.9 is a real radius.
    expect(T.setLineCurveRadius(doc, 'L1', 23.9).lines.L1.curveRadius).toBe(23.9);
    expect(T.setLineCurveRadius(doc, 'L1', 24)).toBe(doc);
  });

  it('ignores non-finite input (same reference out)', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1', curveRadius: 40 })] });
    expect(T.setLineCurveRadius(doc, 'L1', NaN)).toBe(doc);
    expect(T.setLineCurveRadius(doc, 'L1', Infinity)).toBe(doc);
  });

  it('keeps the style tag on change (divergence is an override)', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1', styleId: 'some-style' })] });
    expect(T.setLineCurveRadius(doc, 'L1', 40).lines.L1.styleId).toBe('some-style');
  });

  it('returns the input doc for an unknown line id', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    expect(T.setLineCurveRadius(doc, 'ghost', 40)).toBe(doc);
  });
});

describe('setLineStrokeColor', () => {
  const RED = { day: '#ff0000', night: '#ff0000' };

  it('stores a non-default stroke color', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    const next = T.setLineStrokeColor(doc, 'L1', RED);
    expect(next.lines.L1.strokeColor).toEqual(RED);
  });

  it('stores a pair whose halves differ — the whole point of the day/night split', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    const next = T.setLineStrokeColor(doc, 'L1', { day: '#ffffff', night: '#000000' });
    expect(next.lines.L1.strokeColor).toEqual({ day: '#ffffff', night: '#000000' });
  });

  it('normalizes to lowercase before storing', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    const next = T.setLineStrokeColor(doc, 'L1', { day: '#AB12CD', night: '#12AB34' });
    expect(next.lines.L1.strokeColor).toEqual({ day: '#ab12cd', night: '#12ab34' });
  });

  it('drops the field when BOTH halves land on the default, in any case', () => {
    for (const def of [
      { day: '#ffffff', night: '#ffffff' },
      { day: '#FFFFFF', night: '#FFFFFF' },
    ]) {
      const doc = makeDoc({ lines: [makeLine({ id: 'L1', strokeColor: RED })] });
      const next = T.setLineStrokeColor(doc, 'L1', def);
      expect('strokeColor' in next.lines.L1).toBe(false);
    }
  });

  it('returns the input doc unchanged when the color is already stored', () => {
    // A structural compare, not `===`: every swatch tick hands over a freshly
    // built pair, and a reference compare would push an undo entry for each.
    const doc = makeDoc({ lines: [makeLine({ id: 'L1', strokeColor: RED })] });
    expect(T.setLineStrokeColor(doc, 'L1', { day: '#ff0000', night: '#ff0000' })).toBe(doc);
    expect(T.setLineStrokeColor(doc, 'L1', { day: '#FF0000', night: '#FF0000' })).toBe(doc);
  });

  it('returns the input doc unchanged when setting the default on a bare line', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    expect(T.setLineStrokeColor(doc, 'L1', { day: '#ffffff', night: '#ffffff' })).toBe(doc);
  });

  it('returns the input doc for an unknown line id', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    expect(T.setLineStrokeColor(doc, 'ghost', RED)).toBe(doc);
  });
});

describe('setLineDashLength / setLineDashWidth', () => {
  it('stores dash dims as given, dropping the field at 0 (unset ⇒ derive from width)', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    expect(T.setLineDashLength(doc, 'L1', 21).lines.L1.dashLength).toBe(21);
    expect(T.setLineDashLength(doc, 'L1', 2.2).lines.L1.dashLength).toBe(2.2);
    expect(T.setLineDashWidth(doc, 'L1', 3.6).lines.L1.dashWidth).toBe(3.6);
    const off = T.setLineDashLength(
      makeDoc({ lines: [makeLine({ id: 'L1', dashLength: 3 })] }),
      'L1',
      0,
    );
    expect('dashLength' in off.lines.L1).toBe(false);
    const offW = T.setLineDashWidth(
      makeDoc({ lines: [makeLine({ id: 'L1', dashWidth: 3 })] }),
      'L1',
      0,
    );
    expect('dashWidth' in offW.lines.L1).toBe(false);
  });

  it('returns the input doc unchanged on a no-op / non-finite input / unknown line', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1', dashLength: 3, dashWidth: 2 })] });
    expect(T.setLineDashLength(doc, 'L1', 3)).toBe(doc);
    expect(T.setLineDashWidth(doc, 'L1', 2)).toBe(doc);
    expect(T.setLineDashLength(doc, 'L1', NaN)).toBe(doc);
    expect(T.setLineDashWidth(doc, 'L1', Infinity)).toBe(doc);
    expect(T.setLineDashLength(doc, 'ghost', 5)).toBe(doc);
    const unset = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    expect(T.setLineDashLength(unset, 'L1', 0)).toBe(unset); // 0 on an unset line = no-op
  });

  it('keeps the style tag on change (divergence is an override)', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1', styleId: 'some-style' })] });
    expect(T.setLineDashLength(doc, 'L1', 3).lines.L1.styleId).toBe('some-style');
    expect(T.setLineDashWidth(doc, 'L1', 3).lines.L1.styleId).toBe('some-style');
  });
});

describe('addStationToLine — stop-cell spawn + label nudge', () => {
  it('adds a station + stop cell when not present', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 's1' })],
      lines: [makeLine({ id: 'L1', stations: [] })],
    });
    const next = T.addStationToLine(doc, 'L1', 's1');
    expect(next.lines.L1.stations).toEqual(['s1']);
    expect(next.stations.s1.stops).toHaveLength(1);
    expect(next.stations.s1.stops[0].lineId).toBe('L1');
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
    const next = T.addStationToLine(doc, 'L2', 's1');
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
    const next = T.addStationToLine(doc, 'L2', 's1');
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
    const next = T.addStationToLine(doc, 'L2', 's1');
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
    const next = T.addStationToLine(doc, 'L2', 's1');
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

describe('removeStationFromLine: transfers on other lines', () => {
  it('keeps anchored transfers when the station keeps a stop on another line', () => {
    // Removing s1 from L1 must not disturb a transfer anchored at its L2 stop.
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
    const next = T.removeStationFromLine(doc, 'L1', 0);
    expect(next.stations.s1.stops.map((c) => c.lineId)).toEqual(['L2']);
    expect(next.transfers.x1).toBeDefined();
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

describe('clearAll', () => {
  it('clearAll wipes every collection', () => {
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

  /**
   * Clear empties the canvas of the SAME document — so everything that isn't
   * canvas content stays. The name MUST be non-default here: makeDoc's default
   * name is MAP_NAME_DEFAULT is DEFAULT_DOC.name, so `toBe(doc.name)` against
   * an unnamed fixture passes against a clearAll that drops the name entirely.
   */
  it('clearAll keeps the document settings that are not canvas content', () => {
    const doc = makeDoc({
      name: 'My Map',
      stations: [makeStation({ id: 's1' })],
      lines: [makeLine({ id: 'L1' })],
      palettes: [{ name: 'frrf', swatches: [{ name: '1', color: '#c1272d' }] }],
      darkMode: true,
    });
    const styled = {
      ...doc,
      styles: { ...doc.styles, y1: { name: 'Bold stop', fields: {} } },
    } as unknown as MapDoc;

    const cleared = T.clearAll(styled);
    expect(cleared.name).toBe('My Map');
    expect(cleared.palettes).toEqual([
      { name: 'frrf', swatches: [{ name: '1', color: '#c1272d' }] },
    ]);
    // Clearing a night map leaves a night map — Clear empties the canvas, it
    // doesn't reset what kind of map this is.
    expect(cleared.darkMode).toBe(true);
    expect(cleared.styles).toBe(styled.styles);
    expect(cleared.styleDefaults).toBe(styled.styleDefaults);
  });
});

describe('station label typography constants', () => {
  it('exposes font-size bounds, default, and step as constants', () => {
    expect(T.LABEL_FONT_SIZE_MIN).toBe(2);
    expect(T.LABEL_FONT_SIZE_MAX).toBe(24);
    expect(T.LABEL_FONT_SIZE_DEFAULT).toBe(12);
    expect(T.FONT_SIZE_STEP).toBe(0.25);
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

  it('STATION_LABEL_STYLE_DEFAULTS is the LABEL_* family as the factory station props', () => {
    expect(T.STATION_LABEL_STYLE_DEFAULTS).toEqual({
      fontSize: 12,
      weight: 400,
      italic: false,
      leading: 1,
      tracking: 0,
    });
  });
});

describe('per-transfer style overrides', () => {
  // Two transfers so every assertion can also check the sibling is untouched.
  const baseDoc = () =>
    makeDoc({
      transfers: [makeTransfer({ id: 'x1' }), makeTransfer({ id: 'x2' })],
    });

  describe('updateTransferStyle', () => {
    it('stores an override that differs from the constant default', () => {
      const doc = T.updateTransferStyle(baseDoc(), 'x1', { thickness: 5 });
      expect(doc.transfers['x1'].thickness).toBe(5);
      expect('thickness' in doc.transfers['x2']).toBe(false);
    });

    it('patches several fields at once, leaving the rest tracking', () => {
      const doc = T.updateTransferStyle(baseDoc(), 'x1', {
        color: { day: '#ff0080', night: '#333333' },
        strokeWidth: 3,
        strokeColor: { day: '#123456', night: '#654321' },
      });
      expect(doc.transfers['x1']).toMatchObject({
        color: { day: '#ff0080', night: '#333333' },
        strokeWidth: 3,
        strokeColor: { day: '#123456', night: '#654321' },
      });
      expect('thickness' in doc.transfers['x1']).toBe(false);
    });

    it('stores the numeric fields as given, floor-clamped', () => {
      const doc = T.updateTransferStyle(baseDoc(), 'x1', { thickness: 4.6, strokeWidth: -2 });
      expect(doc.transfers['x1'].thickness).toBe(4.6);
      // -2 clamps to 0 — the constant strokeWidth default — so it collapses
      // rather than storing a redundant 0.
      expect('strokeWidth' in doc.transfers['x1']).toBe(false);
    });

    it('CLEARS an override when the chosen value equals the constant default', () => {
      const withOverride = T.updateTransferStyle(baseDoc(), 'x1', { thickness: 5 });
      const cleared = T.updateTransferStyle(withOverride, 'x1', { thickness: 2 });
      expect('thickness' in cleared.transfers['x1']).toBe(false);
    });

    it('clears color overrides only when BOTH day and night match the default', () => {
      const withOverride = T.updateTransferStyle(baseDoc(), 'x1', {
        color: { day: '#ff0080', night: '#ff0080' },
      });
      // Night still diverges — the override stays.
      const stillSet = T.updateTransferStyle(withOverride, 'x1', {
        color: { day: '#000000', night: '#ff0080' },
      });
      expect(stillSet.transfers['x1'].color).toEqual({ day: '#000000', night: '#ff0080' });
      // Both halves back to black — the override collapses.
      const cleared = T.updateTransferStyle(stillSet, 'x1', {
        color: { day: '#000000', night: '#000000' },
      });
      expect('color' in cleared.transfers['x1']).toBe(false);
    });

    it('clears strokeColor overrides at the default STROKE color (white, not the body color)', () => {
      const withOverride = T.updateTransferStyle(baseDoc(), 'x1', {
        strokeColor: { day: '#123456', night: '#654321' },
      });
      const cleared = T.updateTransferStyle(withOverride, 'x1', {
        strokeColor: { day: '#ffffff', night: '#ffffff' },
      });
      expect('strokeColor' in cleared.transfers['x1']).toBe(false);
    });

    it('ignores non-finite numeric fields', () => {
      const doc = baseDoc();
      expect(T.updateTransferStyle(doc, 'x1', { thickness: Number.NaN })).toBe(doc);
      expect(T.updateTransferStyle(doc, 'x1', { strokeWidth: Number.POSITIVE_INFINITY })).toBe(doc);
    });

    it('stores a lifted draw order and clears it back at the default "under"', () => {
      const lifted = T.updateTransferStyle(baseDoc(), 'x1', { draw: 'over-dot' });
      expect(lifted.transfers['x1'].draw).toBe('over-dot');
      expect('draw' in lifted.transfers['x2']).toBe(false);
      const cleared = T.updateTransferStyle(lifted, 'x1', { draw: 'under' });
      expect('draw' in cleared.transfers['x1']).toBe(false);
    });

    it('keeps the style tag when the draw order changes (a covered-field override)', () => {
      const doc = makeDoc({
        transfers: [makeTransfer({ id: 'x1', styleId: 'y1' })],
      });
      const next = T.updateTransferStyle(doc, 'x1', { draw: 'over-code' });
      expect(next.transfers['x1'].styleId).toBe('y1');
      // …and a re-pick of the value already in force is a no-op.
      expect(T.updateTransferStyle(next, 'x1', { draw: 'over-code' })).toBe(next);
    });

    it('is a reference-equal no-op for an unknown id, an empty patch, and unchanged values', () => {
      const doc = baseDoc();
      expect(T.updateTransferStyle(doc, 'nope', { thickness: 5 })).toBe(doc);
      expect(T.updateTransferStyle(doc, 'x1', {})).toBe(doc);
      // Clearing a field that was never overridden changes nothing.
      expect(T.updateTransferStyle(doc, 'x1', { thickness: 2 })).toBe(doc);
      const withOverride = T.updateTransferStyle(doc, 'x1', { thickness: 5 });
      expect(T.updateTransferStyle(withOverride, 'x1', { thickness: 5 })).toBe(withOverride);
    });
  });
});

describe('LABEL_WEIGHT_VALUES', () => {
  it('lists the weights we ship in /public/fonts/, in ascending order', () => {
    // Söhne's ladder: 200-900, no 100 (UltraLight retired with the move to it).
    expect(T.LABEL_WEIGHT_VALUES).toEqual([200, 300, 400, 500, 600, 700, 800, 900]);
  });

  it('LABEL_WEIGHT_NAMES is parallel to LABEL_WEIGHT_VALUES', () => {
    expect(T.LABEL_WEIGHT_NAMES.map((w) => w.value)).toEqual(T.LABEL_WEIGHT_VALUES);
    expect(T.LABEL_WEIGHT_NAMES.map((w) => w.name)).toEqual([
      'Thin',
      'Light',
      'Roman',
      'Medium',
      'SemiBold',
      'Bold',
      'Heavy',
      'Black',
    ]);
  });
});

describe('bumpWeightByIndex', () => {
  it('walks +N steps through LABEL_WEIGHT_VALUES', () => {
    expect(T.bumpWeightByIndex(400, 3)).toBe(700); // Roman → Bold
    expect(T.bumpWeightByIndex(300, 1)).toBe(400); // Light → Roman
    expect(T.bumpWeightByIndex(200, 2)).toBe(400);
    expect(T.bumpWeightByIndex(500, 3)).toBe(800);
  });

  it('walks -N steps through LABEL_WEIGHT_VALUES', () => {
    expect(T.bumpWeightByIndex(700, -3)).toBe(400);
    expect(T.bumpWeightByIndex(400, -1)).toBe(300);
  });

  it('clamps at Black (900) when stepping past the top', () => {
    expect(T.bumpWeightByIndex(800, 2)).toBe(900);
    expect(T.bumpWeightByIndex(900, 2)).toBe(900);
    expect(T.bumpWeightByIndex(900, 10)).toBe(900);
  });

  it('clamps at Thin (200) when stepping past the bottom', () => {
    expect(T.bumpWeightByIndex(300, -5)).toBe(200);
    expect(T.bumpWeightByIndex(200, -1)).toBe(200);
  });

  it('returns the input unchanged for delta=0', () => {
    expect(T.bumpWeightByIndex(400, 0)).toBe(400);
    expect(T.bumpWeightByIndex(900, 0)).toBe(900);
  });
});

describe('effectiveStationLabelStyle', () => {
  it('resolves a station with no typography fields to the LABEL_* defaults', () => {
    expect(T.effectiveStationLabelStyle(makeStation({ id: 'a' }))).toEqual({
      fontSize: 12,
      weight: 400,
      italic: false,
      leading: 1,
      tracking: 0,
    });
  });

  it("reads the station's own typography, resolving absent fields to defaults", () => {
    const st = makeStation({ id: 'a', fontSize: 20, weight: 700, italic: true });
    expect(T.effectiveStationLabelStyle(st)).toEqual({
      fontSize: 20,
      weight: 700,
      italic: true,
      leading: 1,
      tracking: 0,
    });
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

describe('setStationEditorHeight', () => {
  it('writes a clamped positive-integer editorHeight on the station', () => {
    const doc = makeDoc({ stations: [makeStation({ id: 'a' })] });
    expect(T.setStationEditorHeight(doc, 'a', 120.6).stations.a.editorHeight).toBe(121);
    expect(T.setStationEditorHeight(doc, 'a', 0).stations.a.editorHeight).toBe(1);
    expect(T.setStationEditorHeight(doc, 'a', -40).stations.a.editorHeight).toBe(1);
  });

  it('is a no-op (reference equality) when the height is unchanged', () => {
    const doc = makeDoc({ stations: [{ ...makeStation({ id: 'a' }), editorHeight: 150 }] });
    expect(T.setStationEditorHeight(doc, 'a', 150)).toBe(doc);
  });

  it('is a no-op for missing ids', () => {
    const doc = makeDoc({ stations: [makeStation({ id: 'a' })] });
    expect(T.setStationEditorHeight(doc, 'nope', 150)).toBe(doc);
  });
});

describe('the map’s palettes', () => {
  const FRRF = { name: 'frrf', swatches: [{ name: '1', color: '#c1272d' }] };
  const OTHER = { name: 'other', swatches: [{ name: '1', color: '#222222' }] };

  it('a fresh map holds a copy of MTA', () => {
    expect(T.DEFAULT_DOC.palettes.map((p) => p.name)).toEqual(['MTA']);
    expect(T.DEFAULT_DOC.palettes[0].swatches).toHaveLength(11);
  });

  it('adds a palette to the end', () => {
    const doc = T.addPaletteToMap(makeDoc({}), FRRF);
    expect(doc.palettes.map((p) => p.name)).toEqual(['MTA', 'frrf']);
  });

  it('stores a COPY — editing the library’s swatch array cannot reach the map', () => {
    const source = { name: 'src', swatches: [{ name: '1', color: '#111111' }] };
    const doc = T.addPaletteToMap(makeDoc({}), source);
    source.swatches.push({ name: '2', color: '#222222' });
    expect(doc.palettes.find((p) => p.name === 'src')?.swatches).toHaveLength(1);
  });

  it('stores nothing but the name and swatches — no library-only fields ride along', () => {
    const doc = T.addPaletteToMap(makeDoc({}), { ...FRRF, builtin: true, starred: true } as never);
    expect(Object.keys(doc.palettes[1])).toEqual(['name', 'swatches']);
  });

  it('keeps a description while still stripping library-only fields', () => {
    const doc = T.addPaletteToMap(makeDoc({}), {
      ...FRRF,
      description: 'side-project reds',
      builtin: true,
    } as never);
    expect(Object.keys(doc.palettes[1])).toEqual(['name', 'swatches', 'description']);
  });

  it('an upsert that only changes the description is a real change', () => {
    const doc = T.addPaletteToMap(makeDoc({}), FRRF);
    const next = T.addPaletteToMap(doc, { ...FRRF, description: 'side-project reds' });
    expect(next).not.toBe(doc);
    expect(next.palettes[1].description).toBe('side-project reds');
  });

  it('an upsert that only changes a swatch night color is a real change', () => {
    const doc = T.addPaletteToMap(makeDoc({}), FRRF);
    const next = T.addPaletteToMap(doc, {
      name: 'frrf',
      swatches: [{ name: '1', color: '#c1272d', night: '#7a1a1d' }],
    });
    expect(next).not.toBe(doc);
    expect(next.palettes[1].swatches[0].night).toBe('#7a1a1d');
  });

  it('re-adding an identical described palette is a reference no-op', () => {
    const described = { ...FRRF, description: 'side-project reds' };
    const doc = T.addPaletteToMap(makeDoc({}), described);
    expect(T.addPaletteToMap(doc, described)).toBe(doc);
  });

  it('a kind-only change is a real upsert, not a no-op', () => {
    const doc = T.addPaletteToMap(makeDoc({}), FRRF);
    const next = T.addPaletteToMap(doc, { ...FRRF, kind: 'design' });
    expect(next).not.toBe(doc);
    expect(next.palettes.find((p) => p.name === 'frrf')?.kind).toBe('design');
  });

  describe('line swatch refs', () => {
    const RED = { palette: 'frrf', swatch: '1' };
    // Line A is LINKED to frrf's first swatch; line B merely wears the same
    // hex by hand. The ref, not the value, is what follows the palette now.
    const linked = () =>
      T.addPaletteToMap(
        makeDoc({
          lines: [
            makeLine({ id: 'A', color: '#c1272d', colorRef: RED }),
            makeLine({ id: 'B', color: '#c1272d' }),
          ],
        }),
        FRRF,
      );

    it('a line born on a line-palette swatch hex is born linked', () => {
      const doc = T.addLine(T.addPaletteToMap(makeDoc({}), FRRF), 'N', 'X', '#C1272D');
      expect(doc.lines.N.colorRef).toEqual({ palette: 'frrf', swatch: '1' });
      const custom = T.addLine(makeDoc({ palettes: [] }), 'M', 'X', '#123456');
      expect('colorRef' in custom.lines.M).toBe(false);
    });

    it('recolor sweeps by ref: linked lines follow, same-hex bystanders stay', () => {
      const doc = T.recolorMapPaletteColor(linked(), 'frrf', 0, '#00ff00');
      expect(doc.lines.A).toMatchObject({ color: '#00ff00', colorRef: RED });
      expect(doc.lines.B.color).toBe('#c1272d');
    });

    it('removing the palette drops the refs and keeps the painted colors', () => {
      const doc = T.removePaletteFromMap(linked(), 'frrf');
      expect(doc.lines.A.color).toBe('#c1272d');
      expect('colorRef' in doc.lines.A).toBe(false);
    });

    it('re-adding a palette over the name refreshes linked lines by swatch name', () => {
      const doc = T.addPaletteToMap(linked(), {
        name: 'frrf',
        swatches: [{ name: '1', color: '#123456' }],
      });
      expect(doc.lines.A).toMatchObject({ color: '#123456', colorRef: RED });
    });

    it('a replacement lacking the swatch name drops the ref, keeping the color', () => {
      const doc = T.addPaletteToMap(linked(), {
        name: 'frrf',
        swatches: [{ name: 'renamed away', color: '#123456' }],
      });
      expect(doc.lines.A.color).toBe('#c1272d');
      expect('colorRef' in doc.lines.A).toBe(false);
    });

    it('renaming the palette rewrites the refs pointing at it', () => {
      const doc = T.renameMapPalette(linked(), 'frrf', 'inks');
      expect(doc.lines.A.colorRef).toEqual({ palette: 'inks', swatch: '1' });
    });

    describe('renameMapPaletteSwatch', () => {
      it('renames the swatch and rewrites the refs pointing at it', () => {
        const doc = T.renameMapPaletteSwatch(linked(), 'frrf', 0, 'Crimson');
        expect(doc.palettes[1].swatches[0]).toEqual({ name: 'Crimson', color: '#c1272d' });
        expect(doc.lines.A.colorRef).toEqual({ palette: 'frrf', swatch: 'Crimson' });
      });

      it('refuses a name another swatch of the palette holds, and an empty one', () => {
        const doc = T.addPaletteToMap(makeDoc({}), {
          name: 'frrf',
          swatches: [
            { name: '1', color: '#c1272d' },
            { name: '2', color: '#0061a8' },
          ],
        });
        expect(T.renameMapPaletteSwatch(doc, 'frrf', 0, '2')).toBe(doc);
        expect(T.renameMapPaletteSwatch(doc, 'frrf', 0, '   ')).toBe(doc);
      });

      it('no-ops on an unknown palette, swatch, or unchanged name', () => {
        const doc = linked();
        expect(T.renameMapPaletteSwatch(doc, 'nope', 0, 'x')).toBe(doc);
        expect(T.renameMapPaletteSwatch(doc, 'frrf', 9, 'x')).toBe(doc);
        expect(T.renameMapPaletteSwatch(doc, 'frrf', 0, '1')).toBe(doc);
      });
    });

    describe('reconcileSwatchRefs', () => {
      it('passes a canonical doc through by reference', () => {
        const doc = linked();
        expect(T.reconcileSwatchRefs(doc)).toBe(doc);
      });

      it('restamps a drifted value from its swatch — the ref wins', () => {
        const base = linked();
        const doc = T.reconcileSwatchRefs({
          ...base,
          lines: { ...base.lines, A: { ...base.lines.A, color: '#000000' } },
        });
        expect(doc.lines.A.color).toBe('#c1272d');
      });

      it('drops a dangling or malformed ref, keeping the value', () => {
        const base = linked();
        const doc = T.reconcileSwatchRefs({
          ...base,
          lines: {
            ...base.lines,
            A: { ...base.lines.A, colorRef: { palette: 'gone', swatch: '1' } },
            B: { ...base.lines.B, colorRef: 'junk' as unknown as import('./types').SwatchRef },
          },
        });
        expect('colorRef' in doc.lines.A).toBe(false);
        expect('colorRef' in doc.lines.B).toBe(false);
        expect(doc.lines.A.color).toBe('#c1272d');
      });

      // A LINE ref into a design palette is a kind mismatch — dangling.
      it('drops a line ref pointing into a design palette', () => {
        const base = T.addPaletteToMap(linked(), {
          name: 'grays',
          kind: 'design',
          swatches: [{ name: '1', color: '#333333' }],
        });
        const doc = T.reconcileSwatchRefs({
          ...base,
          lines: {
            ...base.lines,
            A: { ...base.lines.A, colorRef: { palette: 'grays', swatch: '1' } },
          },
        });
        expect('colorRef' in doc.lines.A).toBe(false);
      });
    });

    describe('updateLine and the detach rule', () => {
      it('a color patch without a ref key detaches — a hand-picked color', () => {
        const doc = T.updateLine(linked(), 'A', { color: '#00ff00' });
        expect(doc.lines.A.color).toBe('#00ff00');
        expect('colorRef' in doc.lines.A).toBe(false);
      });

      it('a color patch carrying its ref keeps the link', () => {
        const doc = T.updateLine(linked(), 'B', { color: '#c1272d', colorRef: RED });
        expect(doc.lines.B).toMatchObject({ color: '#c1272d', colorRef: RED });
      });

      it('a same-hex custom pick still detaches — that is a real change', () => {
        const doc = T.updateLine(linked(), 'A', { color: '#c1272d' });
        expect(doc).not.toBe(linked());
        expect('colorRef' in doc.lines.A).toBe(false);
      });

      it('re-picking the linked swatch is a reference no-op', () => {
        const doc = linked();
        expect(T.updateLine(doc, 'A', { color: '#c1272d', colorRef: RED })).toBe(doc);
      });

      it('a non-color patch leaves the ref alone', () => {
        const doc = T.updateLine(linked(), 'A', { name: 'renamed' });
        expect(doc.lines.A.colorRef).toEqual(RED);
      });
    });
  });

  describe('recolorMapPaletteColor', () => {
    // Line A is LINKED to swatch 0 (colorRef); line B wears an unrelated
    // color. The sweep is ref-keyed — a hand-picked line that merely equals
    // the swatch's hex no longer follows (see the "line swatch refs" suite).
    const wearing = () =>
      T.addPaletteToMap(
        makeDoc({
          lines: [
            makeLine({ id: 'A', color: '#c1272d', colorRef: { palette: 'frrf', swatch: '1' } }),
            makeLine({ id: 'B', color: '#123456' }),
          ],
        }),
        FRRF,
      );

    it('recolors the swatch and repaints the lines linked to it', () => {
      const doc = T.recolorMapPaletteColor(wearing(), 'frrf', 0, '#00ff00');
      expect(doc.palettes[1].swatches[0]).toEqual({ name: '1', color: '#00ff00' });
      expect(doc.lines.A.color).toBe('#00ff00');
      expect(doc.lines.B.color).toBe('#123456');
    });

    it('drops a stored night from the recolored swatch', () => {
      let doc = T.addPaletteToMap(makeDoc({}), {
        name: 'frrf',
        swatches: [{ name: '1', color: '#c1272d', night: '#7a1a1d' }],
      });
      doc = T.recolorMapPaletteColor(doc, 'frrf', 0, '#00ff00');
      expect(doc.palettes[1].swatches[0]).toEqual({ name: '1', color: '#00ff00' });
    });

    it('is a no-op for an unknown palette or swatch', () => {
      const doc = wearing();
      expect(T.recolorMapPaletteColor(doc, 'nope', 0, '#00ff00')).toBe(doc);
      expect(T.recolorMapPaletteColor(doc, 'frrf', 5, '#00ff00')).toBe(doc);
    });

    it('recoloring to the color already worn is a reference no-op', () => {
      const doc = wearing();
      expect(T.recolorMapPaletteColor(doc, 'frrf', 0, '#C1272D')).toBe(doc);
    });

    it('recoloring to the SAME color still drops a stored night', () => {
      // The same-color short-circuit only fires when there is nothing to clean
      // up (`night === undefined`); a swatch carrying a night must fall through
      // so the recolor collapses it, even when the day color is unchanged.
      let doc = T.addPaletteToMap(makeDoc({}), {
        name: 'frrf',
        swatches: [{ name: '1', color: '#c1272d', night: '#7a1a1d' }],
      });
      doc = T.recolorMapPaletteColor(doc, 'frrf', 0, '#C1272D');
      expect(doc.palettes[1].swatches[0]).toEqual({ name: '1', color: '#c1272d' });
    });

    describe('design palettes', () => {
      const withDesign = (night?: string) =>
        T.addPaletteToMap(makeDoc({ lines: [makeLine({ id: 'A', color: '#333333' })] }), {
          name: 'Design grays',
          kind: 'design',
          swatches: [{ name: 'Border', color: '#333333', ...(night && { night }) }],
        });

      it('a day recolor keeps the stored night — design halves edit independently', () => {
        const doc = T.recolorMapPaletteColor(withDesign('#bbbbbb'), 'Design grays', 0, '#444444');
        expect(doc.palettes[1].swatches[0]).toEqual({
          name: 'Border',
          color: '#444444',
          night: '#bbbbbb',
        });
      });

      it('a night recolor stores the night half, collapsed when it equals day', () => {
        let doc = T.recolorMapPaletteColor(withDesign(), 'Design grays', 0, '#bbbbbb', 'night');
        expect(doc.palettes[1].swatches[0]).toEqual({
          name: 'Border',
          color: '#333333',
          night: '#bbbbbb',
        });
        doc = T.recolorMapPaletteColor(doc, 'Design grays', 0, '#333333', 'night');
        expect(doc.palettes[1].swatches[0]).toEqual({ name: 'Border', color: '#333333' });
      });

      it('never repaints lines — design swatches are not line identities', () => {
        // Line A sits on the same hex as the design swatch; a design recolor
        // must leave it alone (the value sweep is a LINE-palette behavior).
        const doc = T.recolorMapPaletteColor(withDesign(), 'Design grays', 0, '#00ff00');
        expect(doc.lines.A.color).toBe('#333333');
      });
    });
  });

  it('re-adding a name replaces its swatches in place, keeping its position', () => {
    let doc = T.addPaletteToMap(makeDoc({}), FRRF);
    doc = T.addPaletteToMap(doc, OTHER);
    doc = T.addPaletteToMap(doc, { name: 'frrf', swatches: [{ name: 'X', color: '#999999' }] });
    expect(doc.palettes.map((p) => p.name)).toEqual(['MTA', 'frrf', 'other']);
    expect(doc.palettes[1].swatches).toEqual([{ name: 'X', color: '#999999' }]);
  });

  it('re-adding an identical palette is a reference no-op (no undo entry)', () => {
    const doc = T.addPaletteToMap(makeDoc({}), FRRF);
    expect(T.addPaletteToMap(doc, FRRF)).toBe(doc);
  });

  it('removes a palette by name', () => {
    const doc = T.addPaletteToMap(makeDoc({}), FRRF);
    expect(T.removePaletteFromMap(doc, 'frrf').palettes.map((p) => p.name)).toEqual(['MTA']);
  });

  // No "at least one" invariant: a map with no palettes still picks colors by
  // hand through the picker's Custom section.
  it('allows the map to hold no palettes at all', () => {
    expect(T.removePaletteFromMap(makeDoc({}), 'MTA').palettes).toEqual([]);
  });

  it('removing an absent name is a reference no-op', () => {
    const doc = makeDoc({});
    expect(T.removePaletteFromMap(doc, 'nope')).toBe(doc);
  });

  it('renames a palette in place', () => {
    const doc = T.renameMapPalette(makeDoc({}), 'MTA', 'Subway');
    expect(doc.palettes.map((p) => p.name)).toEqual(['Subway']);
    expect(doc.palettes[0].swatches).toHaveLength(11); // a copy, so renaming it is free
  });

  it('refuses a rename onto another palette in the map', () => {
    const doc = T.addPaletteToMap(makeDoc({}), FRRF);
    expect(T.renameMapPalette(doc, 'frrf', 'MTA')).toBe(doc);
  });

  it('refuses an empty rename, and no-ops on an unknown name', () => {
    const doc = makeDoc({});
    expect(T.renameMapPalette(doc, 'MTA', '  ')).toBe(doc);
    expect(T.renameMapPalette(doc, 'nope', 'x')).toBe(doc);
  });

  it('reorders a palette from one slot to another, near or far', () => {
    let doc = T.addPaletteToMap(makeDoc({}), FRRF);
    doc = T.addPaletteToMap(doc, OTHER); // MTA, frrf, other
    expect(T.reorderMapPalette(doc, 1, 0).palettes.map((p) => p.name)).toEqual([
      'frrf',
      'MTA',
      'other',
    ]);
    expect(T.reorderMapPalette(doc, 0, 2).palettes.map((p) => p.name)).toEqual([
      'frrf',
      'other',
      'MTA',
    ]);
  });

  it('is a reference no-op for a same-slot or out-of-range move', () => {
    const doc = T.addPaletteToMap(makeDoc({}), FRRF);
    expect(T.reorderMapPalette(doc, 0, 0)).toBe(doc);
    expect(T.reorderMapPalette(doc, -1, 1)).toBe(doc);
    expect(T.reorderMapPalette(doc, 0, 5)).toBe(doc);
  });
});

describe('setDarkMode (night map)', () => {
  it('DEFAULT_DOC.darkMode defaults to day', () => {
    expect(T.DEFAULT_DOC.darkMode).toBe(false);
  });

  it('stores the chosen mode', () => {
    const doc = makeDoc({});
    expect(T.setDarkMode(doc, true).darkMode).toBe(true);
    expect(T.setDarkMode(T.setDarkMode(doc, true), false).darkMode).toBe(false);
  });

  it('returns the input doc unchanged when the mode is unchanged (no undo no-op)', () => {
    const night = T.setDarkMode(makeDoc({}), true);
    expect(T.setDarkMode(night, true)).toBe(night);
    const day = makeDoc({});
    expect(T.setDarkMode(day, false)).toBe(day);
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
  it('prunes segmentStyles whose pair-key referenced the deleted station', () => {
    // L1 = a–b–c with a styled (a,b) segment. Deleting `a` removes it from
    // the line, so the (a,b) pair is no longer an edge; the style keyed on it
    // must be pruned, not left dangling at a station that no longer exists.
    // removeStationFromLine / deleteLine already do this — deleteStation
    // must too.
    let doc = makeDoc({
      stations: [
        makeStation({ id: 'a', stops: [makeStop('L1')] }),
        makeStation({ id: 'b', stops: [makeStop('L1')] }),
        makeStation({ id: 'c', stops: [makeStop('L1')] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['a', 'b', 'c'] })],
    });
    doc = T.setLineSegmentStyle(doc, 'L1', 'a', 'b', 'dashed');
    // Sanity: exactly the (a,b) override exists before deletion.
    expect(Object.keys(doc.lines.L1.segmentStyles ?? {})).toHaveLength(1);

    const next = T.deleteStation(doc, 'a');
    // The (a,b) edge is gone → the override map drops the orphaned key.
    expect(next.lines.L1.segmentStyles ?? {}).toEqual({});
  });
});

describe('setLineEndStyle', () => {
  const doc = () => makeDoc({ lines: [makeLine({ id: 'L1', styleId: 'sty' })] });

  it('stores a non-default end and drops the field at square', () => {
    const round = T.setLineEndStyle(doc(), 'L1', 'round');
    expect(round.lines.L1.endStyle).toBe('round');
    const back = T.setLineEndStyle(round, 'L1', 'square');
    expect('endStyle' in back.lines.L1).toBe(false);
  });

  it('keeps the style tag — end style is a covered field, so a change is an override', () => {
    expect(T.setLineEndStyle(doc(), 'L1', 'short').lines.L1.styleId).toBe('sty');
  });

  it('is a reference no-op when the stored value would not change', () => {
    const d = doc();
    expect(T.setLineEndStyle(d, 'L1', 'square')).toBe(d);
    const round = T.setLineEndStyle(d, 'L1', 'round');
    expect(T.setLineEndStyle(round, 'L1', 'round')).toBe(round);
    // …so a no-op re-write cannot silently strip the tag either.
    const tagged = T.setLineEndStyle(d, 'L1', 'square');
    expect(tagged.lines.L1.styleId).toBe('sty');
  });

  it('no-ops on an unknown line', () => {
    const d = doc();
    expect(T.setLineEndStyle(d, 'nope' as never, 'round')).toBe(d);
  });

  // The stored form must stay canonical from BOTH directions. setStationEndStyle
  // refuses to store a pin equal to the line's end; changing the LINE has to
  // re-apply that rule, or a now-redundant pin survives in memory and is then
  // dropped on load — the same document rendering differently after a reload.
  it('drops a pin the new line end makes redundant', () => {
    const chained = makeDoc({
      stations: [
        makeStation({ id: 'a', stops: [makeStop('L1')] }),
        makeStation({ id: 'b', stops: [makeStop('L1')] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['a', 'b'], stationEndStyles: { a: 'round' } })],
    });
    const next = T.setLineEndStyle(chained, 'L1', 'round');
    expect(next.lines.L1.endStyle).toBe('round');
    expect('stationEndStyles' in next.lines.L1).toBe(false);
  });

  it('keeps a pin the new line end does NOT make redundant', () => {
    const chained = makeDoc({
      stations: [
        makeStation({ id: 'a', stops: [makeStop('L1')] }),
        makeStation({ id: 'b', stops: [makeStop('L1')] }),
      ],
      lines: [
        makeLine({ id: 'L1', stations: ['a', 'b'], stationEndStyles: { a: 'round', b: 'short' } }),
      ],
    });
    const next = T.setLineEndStyle(chained, 'L1', 'short');
    expect(next.lines.L1.stationEndStyles).toEqual({ a: 'round' });
  });

  it('drops a pin made redundant by returning the line to square', () => {
    const chained = makeDoc({
      stations: [
        makeStation({ id: 'a', stops: [makeStop('L1')] }),
        makeStation({ id: 'b', stops: [makeStop('L1')] }),
      ],
      lines: [
        makeLine({
          id: 'L1',
          stations: ['a', 'b'],
          endStyle: 'round',
          stationEndStyles: { a: 'square' },
        }),
      ],
    });
    const next = T.setLineEndStyle(chained, 'L1', 'square');
    expect('endStyle' in next.lines.L1).toBe(false);
    expect('stationEndStyles' in next.lines.L1).toBe(false);
  });
});

// Where a line ENDS is geometric (see lineEndsAt), so these fixtures carry real
// coordinates: a—b—c straight down, `a` and `c` the ends.
describe('setStationEndStyle', () => {
  const doc = (linePatch = {}) =>
    makeDoc({
      stations: [
        makeStation({ id: 'a', x: 0, y: 0, stops: [makeStop('L1')] }),
        makeStation({ id: 'b', x: 0, y: 300, stops: [makeStop('L1')] }),
        makeStation({ id: 'c', x: 0, y: 600, stops: [makeStop('L1')] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['a', 'b', 'c'], styleId: 'sty', ...linePatch })],
    });

  // The same line branching AT `a`: both edges leave it south down one
  // corridor, `d` peeling off south-east. `a` is degree 2 and still an end.
  const branchedDoc = () =>
    makeDoc({
      stations: [
        makeStation({ id: 'a', x: 0, y: 0, stops: [makeStop('L1')] }),
        makeStation({ id: 'b', x: 0, y: 600, stops: [makeStop('L1')] }),
        makeStation({
          id: 'd',
          x: 200,
          y: 400,
          stops: [makeStop('L1', { orientation: 'auto-nw-se' })],
        }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['a', 'b', 'd'], edges: ['a|b', 'a|d'] })],
    });

  it('pins one terminus without touching the other', () => {
    const next = T.setStationEndStyle(doc(), 'L1', 'a', 'round');
    expect(next.lines.L1.stationEndStyles).toEqual({ a: 'round' });
  });

  it('clears the pin when set back to the line’s effective default', () => {
    let next = T.setStationEndStyle(doc({ endStyle: 'round' }), 'L1', 'a', 'short');
    expect(next.lines.L1.stationEndStyles).toEqual({ a: 'short' });
    next = T.setStationEndStyle(next, 'L1', 'a', 'round');
    expect('stationEndStyles' in next.lines.L1).toBe(false);
  });

  it('PINS square when the line default is not square', () => {
    // square is a real choice here, not "no override" — the distinction the
    // clear-at-default rule turns on.
    const next = T.setStationEndStyle(doc({ endStyle: 'round' }), 'L1', 'a', 'square');
    expect(next.lines.L1.stationEndStyles).toEqual({ a: 'square' });
  });

  it('no-ops at a station that is not an end', () => {
    const d = doc();
    expect(T.setStationEndStyle(d, 'L1', 'b', 'round')).toBe(d); // interior
    expect(T.setStationEndStyle(d, 'L1', 'nope', 'round')).toBe(d); // not a member
  });

  it('pins an end the line BRANCHES at — degree 2, both edges leaving south', () => {
    const next = T.setStationEndStyle(branchedDoc(), 'L1', 'a', 'round');
    expect(next.lines.L1.stationEndStyles).toEqual({ a: 'round' });
  });

  it('keeps the line attached to its style preset — pins are not covered', () => {
    expect(T.setStationEndStyle(doc(), 'L1', 'a', 'round').lines.L1.styleId).toBe('sty');
  });

  it('is a reference no-op when the pin would not change', () => {
    const pinned = T.setStationEndStyle(doc(), 'L1', 'a', 'round');
    expect(T.setStationEndStyle(pinned, 'L1', 'a', 'round')).toBe(pinned);
    const d = doc();
    expect(T.setStationEndStyle(d, 'L1', 'a', 'square')).toBe(d);
  });
});

// A per-station end override PAINTS only while the line ends at that station,
// which is geometric — so the stored key is scoped to something a prune can
// actually keep up with: liveness on the line. It survives, inert, whenever the
// geometry moves the end elsewhere, and dies with the stop itself. `segmentStyles`
// keys prune alongside it against the edge set, which topology edits do own.
describe('line end overrides — topology cascade', () => {
  // a—b—c straight down, with `d` off to the south-east: appending c|d extends
  // the line past c, while a|d BRANCHES off a's end down its own corridor.
  const chain = (stationEndStyles: Record<string, 'square' | 'short' | 'round'>) =>
    makeDoc({
      stations: [
        makeStation({ id: 'a', x: 0, y: 0, stops: [makeStop('L1')] }),
        makeStation({ id: 'b', x: 0, y: 300, stops: [makeStop('L1')] }),
        makeStation({ id: 'c', x: 0, y: 600, stops: [makeStop('L1')] }),
        makeStation({ id: 'd', x: 200, y: 800, stops: [] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['a', 'b', 'c'], stationEndStyles })],
    });

  it('keeps the override INERT when appending past a terminus', () => {
    // c stops being an end, so nothing paints its pin — but c is still on the
    // line, and detaching d again would make it an end once more. Pruning here
    // would mean the user's choice could not survive a change of mind.
    const doc = chain({ c: 'round' });
    const next = T.connectStationsOnLine(doc, 'L1', 'c', 'd');
    expect(next.lines.L1.edges).toContain('c|d');
    expect(next.lines.L1.stationEndStyles).toEqual({ c: 'round' });
  });

  it('keeps the override where a branch leaves that end still an end', () => {
    // Branching off `a` sends both its edges down the SAME corridor, so a is
    // still where the line's ink stops — degree 2 now, but no less an end, and
    // its pin goes on painting.
    const doc = chain({ a: 'round' });
    const next = T.connectStationsOnLine(doc, 'L1', 'a', 'd');
    expect(next.lines.L1.edges).toContain('a|d');
    expect(next.lines.L1.stationEndStyles).toEqual({ a: 'round' });
  });

  it('keeps the overrides when closing a loop leaves no ends at all', () => {
    // Every stop becomes a through stop, so every pin goes quiet — and stays,
    // for the same reason: cutting the edge again brings both ends back.
    const doc = chain({ a: 'short', c: 'short' });
    const next = T.toggleEdgeOnLine(doc, 'L1', 'a', 'c');
    expect(next.lines.L1.edges).toContain('a|c');
    expect(next.lines.L1.stationEndStyles).toEqual({ a: 'short', c: 'short' });
  });

  it('drops the override when the station is deleted outright', () => {
    const doc = chain({ c: 'round' });
    expect(T.deleteStation(doc, 'c').lines.L1.stationEndStyles ?? {}).toEqual({});
  });

  it('drops the override when the stop is removed from the line', () => {
    const doc = chain({ c: 'round' });
    const idx = doc.lines.L1.stations.indexOf('c');
    expect(T.removeStationFromLine(doc, 'L1', idx).lines.L1.stationEndStyles ?? {}).toEqual({});
  });

  it('MOVES the end when splicing a new station onto a terminus edge', () => {
    // Splicing d into a|b makes d interior and leaves a an end: a's override
    // survives, and no key is invented for d.
    const doc = chain({ a: 'round' });
    const next = T.spliceStationIntoEdge(doc, 'L1', 'a', 'b', 'd');
    expect(next.lines.L1.stationEndStyles).toEqual({ a: 'round' });
  });

  it('does not invent a stationEndStyles map on a line that has none', () => {
    const doc = chain({});
    const bare = { ...doc, lines: { L1: { ...doc.lines.L1, stationEndStyles: undefined } } };
    delete (bare.lines.L1 as { stationEndStyles?: unknown }).stationEndStyles;
    expect(T.connectStationsOnLine(bare, 'L1', 'c', 'd').lines.L1.stationEndStyles).toBeUndefined();
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

describe('stationIsSingleton', () => {
  const blank = DOT_SHAPE_PRESETS['none'];

  it('is true for a station with exactly one visible stop, false otherwise', () => {
    expect(T.stationIsSingleton(makeStation({ id: 'a', stops: [makeStop('L1')] }))).toBe(true);
    expect(
      T.stationIsSingleton(
        makeStation({ id: 'a', stops: [makeStop('L1'), makeStop('L2', { col: 1 })] }),
      ),
    ).toBe(false);
    // An empty station is not a singleton (no dot to style).
    expect(T.stationIsSingleton(makeStation({ id: 'a', stops: [] }))).toBe(false);
    expect(T.stationIsSingleton(undefined)).toBe(false);
  });

  it('does not count a stop whose explicit override is blank (express+local pattern)', () => {
    // Local (real dot) + express blanked at a skipped stop → still a singleton
    // for the local line, so its dot uses the SINGLETON default.
    expect(
      T.stationIsSingleton(
        makeStation({
          id: 'a',
          stops: [makeStop('LOCAL'), makeStop('EXPRESS', { col: 1, dotStyle: blank })],
        }),
      ),
    ).toBe(true);
    // Two blanked stops → zero visible → not a singleton.
    expect(
      T.stationIsSingleton(
        makeStation({
          id: 'a',
          stops: [makeStop('L1', { dotStyle: blank }), makeStop('L2', { col: 1, dotStyle: blank })],
        }),
      ),
    ).toBe(false);
  });

  it('an open ring (fill none but a visible stroke) is NOT blank — it still counts', () => {
    // open-white has strokeWidth > 0, so it paints and occupies the station.
    expect(
      T.stationIsSingleton(
        makeStation({
          id: 'a',
          stops: [
            makeStop('L1'),
            makeStop('L2', { col: 1, dotStyle: DOT_SHAPE_PRESETS['open-white'] }),
          ],
        }),
      ),
    ).toBe(false);
  });

  it("a transparent DASH does not count — a tick's stroke and code are inert", () => {
    // The stroke and service code do nothing on a dash (only `fill` applies,
    // see resolveDotRender), so they cannot make an invisible tick occupy the
    // station. Reachable by switching a stroked, coded style to Dash and then
    // clearing its fill — the editor hides both controls under Dash, so they
    // sit there unreadable and used to flip the neighbour's split default.
    const ghostTick: DotStyle = {
      shape: 'dash',
      fill: 'none',
      strokeWidth: 2,
      strokeColor: { day: '#ffffff', night: '#ffffff' },
      strokeAlign: 'center',
      showServiceCode: true,
    };
    expect(
      T.stationIsSingleton(
        makeStation({
          id: 'a',
          stops: [makeStop('LOCAL'), makeStop('EXPRESS', { col: 1, dotStyle: ghostTick })],
        }),
      ),
    ).toBe(true);
  });

  it('a stop TRACKING the default always counts (blank check reads only explicit overrides)', () => {
    // Two default-tracking stops → interchange, even though we can't resolve
    // their defaults here (that would be circular).
    expect(
      T.stationIsSingleton(
        makeStation({ id: 'a', stops: [makeStop('L1'), makeStop('L2', { col: 1 })] }),
      ),
    ).toBe(false);
  });

  it("an explicit stopType overrides the count in BOTH directions (the user's declaration wins)", () => {
    // One visible stop, declared an interchange → reads shared.
    expect(
      T.stationIsSingleton(
        makeStation({ id: 'a', stops: [makeStop('L1')], stopType: 'interchange' }),
      ),
    ).toBe(false);
    // Three visible stops, declared a singleton → reads singleton.
    expect(
      T.stationIsSingleton(
        makeStation({
          id: 'a',
          stops: [makeStop('L1'), makeStop('L2', { col: 1 }), makeStop('L3', { col: 2 })],
          stopType: 'singleton',
        }),
      ),
    ).toBe(true);
  });

  it('a junk stopType from a hand-edited file falls back to the count', () => {
    // Only the two legal values are a declaration. Anything else is not a vote
    // for "interchange" — it is no vote at all, so the historical rule answers.
    const junk = (stops: ReturnType<typeof makeStop>[]) =>
      T.stationIsSingleton({
        ...makeStation({ id: 'a', stops }),
        stopType: 'banana',
      } as unknown as Station);
    expect(junk([makeStop('L1')])).toBe(true);
    expect(junk([makeStop('L1'), makeStop('L2', { col: 1 })])).toBe(false);
  });

  it('an explicit stopType outranks the blank-aware count too', () => {
    // Blanked siblings are what the count exists to skip; a declaration
    // short-circuits before the walk, so it wins here as well.
    expect(
      T.stationIsSingleton(
        makeStation({
          id: 'a',
          stops: [makeStop('LOCAL'), makeStop('EXPRESS', { col: 1, dotStyle: blank })],
          stopType: 'interchange',
        }),
      ),
    ).toBe(false);
    expect(
      T.stationIsSingleton(
        makeStation({
          id: 'a',
          stops: [makeStop('L1', { dotStyle: blank }), makeStop('L2', { col: 1, dotStyle: blank })],
          stopType: 'singleton',
        }),
      ),
    ).toBe(true);
  });
});

describe('resolveDotStyle', () => {
  const A = DOT_SHAPE_PRESETS['open-white'];
  const B = DOT_SHAPE_PRESETS['filled-white'];
  const C = DOT_SHAPE_PRESETS['filled-black-diamond'];
  // A line tagged with the split dot defaults; the fixture fills the raw shadow
  // that resolveDotStyle reads from the factory library.
  const line = makeLine({
    id: 'L1',
    singletonDotStyleId: 'stop-open-white',
    multiDotStyleId: 'stop-filled-white',
  });

  it('prefers the per-stop style over either split default, in both cases', () => {
    const stop = makeStop('L1', { dotStyle: C, dotStyleId: 'stop-filled-black-diamond' });
    expect(T.resolveDotStyle(line, stop, true)).toBe(C);
    expect(T.resolveDotStyle(line, stop, false)).toBe(C);
  });

  it('picks the singleton default for a singleton stop, the multi default for a shared one', () => {
    expect(T.resolveDotStyle(line, makeStop('L1'), true)).toBe(A);
    expect(T.resolveDotStyle(line, makeStop('L1'), false)).toBe(B);
  });

  it('a pinned override survives a singleton⇄shared flip (the key requirement)', () => {
    // C differs from BOTH defaults — an explicit set stays put no matter how the
    // station is later shared.
    const stop = makeStop('L1', { dotStyle: C, dotStyleId: 'stop-filled-black-diamond' });
    expect(T.resolveDotStyle(line, stop, false)).toBe(C);
    expect(T.resolveDotStyle(line, stop, true)).toBe(C);
  });

  it('falls back to DEFAULT_DOT_STYLE when neither the stop nor the case default is set', () => {
    expect(T.resolveDotStyle(makeLine({ id: 'L1' }), makeStop('L1'), true)).toBe(DEFAULT_DOT_STYLE);
    expect(T.resolveDotStyle(makeLine({ id: 'L1' }), makeStop('L1'), false)).toBe(
      DEFAULT_DOT_STYLE,
    );
    expect(T.resolveDotStyle(undefined, undefined, true)).toBe(DEFAULT_DOT_STYLE);
  });

  it('reads only the case-relevant default (the other side never leaks)', () => {
    const singletonOnly = makeLine({ id: 'L1', singletonDotStyleId: 'stop-open-white' });
    expect(T.resolveDotStyle(singletonOnly, makeStop('L1'), false)).toBe(DEFAULT_DOT_STYLE);
    const multiOnly = makeLine({ id: 'L1', multiDotStyleId: 'stop-filled-white' });
    expect(T.resolveDotStyle(multiOnly, makeStop('L1'), true)).toBe(DEFAULT_DOT_STYLE);
  });
});

describe('setDotStyle', () => {
  it('writes the new style (raw + tag) onto the targeted stop only', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1'), makeStop('L2', { col: 1 })] })],
      lines: [makeLine({ id: 'L1' }), makeLine({ id: 'L2' })],
    });
    const next = T.setDotStyle(doc, 'a', 'L1', 'stop-filled-black-diamond');
    expect(next.stations.a.stops[0].dotStyle).toEqual(DOT_SHAPE_PRESETS['filled-black-diamond']);
    expect(next.stations.a.stops[0].dotStyleId).toBe('stop-filled-black-diamond');
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
    const next = T.setDotStyle(doc, 'a', 'L1', 'stop-filled-black-diamond');
    expect(next.stations.a.stops[0]).toMatchObject({
      lineId: 'L1',
      row: 2,
      col: 3,
      orientation: 'auto-horizontal',
      dotStyle: DOT_SHAPE_PRESETS['filled-black-diamond'],
      dotStyleId: 'stop-filled-black-diamond',
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
    const next = T.setDotStyle(doc, 'a', 'L1', 'stop-open-white');
    expect(next.stations.a.stops[0].dotStyle).toEqual(DOT_SHAPE_PRESETS['open-white']);
    expect(next.stations.b.stops[0].dotStyle).toBeUndefined();
  });

  it('silently no-ops on unknown station id', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
      lines: [makeLine({ id: 'L1' })],
    });
    const next = T.setDotStyle(doc, 'ghost', 'L1', 'stop-filled-white');
    expect(next).toEqual(doc);
  });

  it('silently no-ops on unknown style id (reference-equal)', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
      lines: [makeLine({ id: 'L1' })],
    });
    expect(T.setDotStyle(doc, 'a', 'L1', 'stop-nonexistent')).toBe(doc);
  });

  it('silently no-ops when the station has no stop on lineId', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
      lines: [makeLine({ id: 'L1' })],
    });
    const next = T.setDotStyle(doc, 'a', 'L99', 'stop-open-white');
    expect(next).toEqual(doc);
  });

  it("the invisible 'none' preset is a plain assignment, not a removal", () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
      lines: [makeLine({ id: 'L1' })],
    });
    const next = T.setDotStyle(doc, 'a', 'L1', 'stop-none');
    expect(next.stations.a.stops[0].dotStyle).toEqual(DOT_SHAPE_PRESETS['none']);
    expect(next.stations.a.stops[0].dotStyleId).toBe('stop-none');
  });

  it("clears a singleton stop's override (raw + tag) when picking the line's singleton default", () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 'a',
          stops: [
            makeStop('L1', {
              dotStyle: STOP_DOT_FACTORY_STYLES['stop-open-white'].props,
              dotStyleId: 'stop-open-white',
            }),
          ],
        }),
      ],
      lines: [makeLine({ id: 'L1', singletonDotStyleId: 'stop-open-white' })],
    });
    const next = T.setDotStyle(doc, 'a', 'L1', 'stop-open-white');
    expect('dotStyle' in next.stations.a.stops[0]).toBe(false);
    expect('dotStyleId' in next.stations.a.stops[0]).toBe(false);
  });

  it('clears an existing override when picking the implicit factory default', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 'a',
          stops: [
            makeStop('L1', {
              dotStyle: STOP_DOT_FACTORY_STYLES['stop-open-white'].props,
              dotStyleId: 'stop-open-white',
            }),
          ],
        }),
      ],
      lines: [makeLine({ id: 'L1' })],
    });
    const next = T.setDotStyle(doc, 'a', 'L1', DEFAULT_STOP_DOT_STYLE_ID);
    expect('dotStyle' in next.stations.a.stops[0]).toBe(false);
    expect('dotStyleId' in next.stations.a.stops[0]).toBe(false);
  });

  it("leaves a singleton stop's dotStyle undefined when picking the singleton default", () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
      lines: [makeLine({ id: 'L1', singletonDotStyleId: 'stop-open-white' })],
    });
    const next = T.setDotStyle(doc, 'a', 'L1', 'stop-open-white');
    expect(next.stations.a.stops[0].dotStyle).toBeUndefined();
    expect(next.stations.a.stops[0].dotStyleId).toBeUndefined();
  });

  it('stores the factory default as an explicit override when the singleton default is something else', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
      lines: [makeLine({ id: 'L1', singletonDotStyleId: 'stop-open-white' })],
    });
    const next = T.setDotStyle(doc, 'a', 'L1', DEFAULT_STOP_DOT_STYLE_ID);
    expect(next.stations.a.stops[0].dotStyle).toEqual(DEFAULT_DOT_STYLE);
    expect(next.stations.a.stops[0].dotStyleId).toBe(DEFAULT_STOP_DOT_STYLE_ID);
  });

  it('collapses against the SHARED default on a shared station, not the singleton one', () => {
    // Station 'a' hosts L1 + L2 (shared). L1's defaults: singleton=open-white,
    // multi=filled-white.
    const A = DOT_SHAPE_PRESETS['open-white'];
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1'), makeStop('L2', { col: 1 })] })],
      lines: [
        makeLine({
          id: 'L1',
          singletonDotStyleId: 'stop-open-white',
          multiDotStyleId: 'stop-filled-white',
        }),
        makeLine({ id: 'L2' }),
      ],
    });
    // Picking the shared default on the shared stop clears — it tracks.
    expect(
      'dotStyle' in T.setDotStyle(doc, 'a', 'L1', 'stop-filled-white').stations.a.stops[0],
    ).toBe(false);
    // Picking the SINGLETON default pins here, because it differs from the
    // shared default this stop currently uses.
    expect(T.setDotStyle(doc, 'a', 'L1', 'stop-open-white').stations.a.stops[0].dotStyle).toEqual(
      A,
    );
  });

  it('a value distinct from both defaults pins, and the pin resolves the same in either case', () => {
    const C = DOT_SHAPE_PRESETS['filled-black-diamond'];
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1'), makeStop('L2', { col: 1 })] })],
      lines: [
        makeLine({
          id: 'L1',
          singletonDotStyleId: 'stop-open-white',
          multiDotStyleId: 'stop-filled-white',
        }),
        makeLine({ id: 'L2' }),
      ],
    });
    const pinned = T.setDotStyle(doc, 'a', 'L1', 'stop-filled-black-diamond');
    const l1stop = pinned.stations.a.stops[0];
    expect(l1stop.dotStyle).toEqual(C);
    expect(l1stop.dotStyleId).toBe('stop-filled-black-diamond');
    // The override is a plain per-stop field, untouched by station topology —
    // whether 'a' is shared (now) or a singleton (were L2 removed), it resolves
    // to C. This is the requirement: an explicit set survives sharing changes.
    expect(T.resolveDotStyle(pinned.lines.L1, l1stop, false)).toEqual(C);
    expect(T.resolveDotStyle(pinned.lines.L1, l1stop, true)).toEqual(C);
  });
});

describe('setLineSingletonDotStyle', () => {
  const OW = DOT_SHAPE_PRESETS['open-white'];

  it('sets the singleton field (raw + tag), leaving the independent multi field untouched', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    const next = T.setLineSingletonDotStyle(doc, 'L1', 'stop-open-white');
    expect(next.lines.L1.singletonDotStyle).toEqual(OW);
    expect(next.lines.L1.singletonDotStyleId).toBe('stop-open-white');
    // The multi field is independent — untouched.
    expect('multiDotStyle' in next.lines.L1).toBe(false);
    expect('multiDotStyleId' in next.lines.L1).toBe(false);
  });

  it('ALWAYS stores the tag + raw, even at the factory default (no drop-at-default)', () => {
    const doc = makeDoc({
      lines: [makeLine({ id: 'L1', singletonDotStyleId: 'stop-open-white' })],
    });
    const next = T.setLineSingletonDotStyle(doc, 'L1', DEFAULT_STOP_DOT_STYLE_ID);
    expect(next.lines.L1.singletonDotStyleId).toBe('stop-filled-black');
    expect(next.lines.L1.singletonDotStyle).toEqual(DEFAULT_DOT_STYLE);
  });

  it('reference-equal no-ops: unknown line id, and re-setting the style already carried', () => {
    const doc = makeDoc({
      lines: [makeLine({ id: 'L1', singletonDotStyleId: 'stop-open-white' })],
    });
    expect(T.setLineSingletonDotStyle(doc, 'ghost', 'stop-open-white')).toBe(doc);
    // Tag + raw already match the requested style → genuine no-op.
    expect(T.setLineSingletonDotStyle(doc, 'L1', 'stop-open-white')).toBe(doc);
  });

  it('clears matching-tag overrides on SINGLETON stops only; different tags left alone', () => {
    const doc = makeDoc({
      stations: [
        // singleton, tagged with the new default → pruned.
        makeStation({
          id: 'a',
          stops: [
            makeStop('L1', {
              dotStyle: STOP_DOT_FACTORY_STYLES['stop-open-white'].props,
              dotStyleId: 'stop-open-white',
            }),
          ],
        }),
        // singleton, tagged with a DIFFERENT style → left alone.
        makeStation({
          id: 'b',
          stops: [
            makeStop('L1', {
              dotStyle: STOP_DOT_FACTORY_STYLES['stop-filled-black-diamond'].props,
              dotStyleId: 'stop-filled-black-diamond',
            }),
          ],
        }),
        makeStation({ id: 'c', stops: [makeStop('L1')] }), // singleton, tracking
      ],
      lines: [makeLine({ id: 'L1' })],
    });
    const next = T.setLineSingletonDotStyle(doc, 'L1', 'stop-open-white');
    expect('dotStyle' in next.stations.a.stops[0]).toBe(false);
    expect('dotStyleId' in next.stations.a.stops[0]).toBe(false);
    expect(next.stations.b.stops[0].dotStyle).toEqual(DOT_SHAPE_PRESETS['filled-black-diamond']);
    expect(next.stations.c.stops[0].dotStyle).toBeUndefined();
  });

  it('does NOT clear a matching override on a SHARED stop (that is the multi case)', () => {
    // 'a' hosts L1 + L2, so L1's stop there is a multiple stop; a singleton
    // default edit must leave it pinned.
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 'a',
          stops: [
            makeStop('L1', {
              dotStyle: STOP_DOT_FACTORY_STYLES['stop-open-white'].props,
              dotStyleId: 'stop-open-white',
            }),
            makeStop('L2', { col: 1 }),
          ],
        }),
      ],
      lines: [makeLine({ id: 'L1' }), makeLine({ id: 'L2' })],
    });
    const next = T.setLineSingletonDotStyle(doc, 'L1', 'stop-open-white');
    expect(next.stations.a.stops[0].dotStyle).toEqual(OW);
    expect(next.stations.a.stops[0].dotStyleId).toBe('stop-open-white');
  });

  it('leaves overrides on OTHER lines untouched', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 'a',
          stops: [
            makeStop('L1', {
              dotStyle: STOP_DOT_FACTORY_STYLES['stop-open-white'].props,
              dotStyleId: 'stop-open-white',
            }),
          ],
        }),
        makeStation({
          id: 'b',
          stops: [
            makeStop('L2', {
              dotStyle: STOP_DOT_FACTORY_STYLES['stop-open-white'].props,
              dotStyleId: 'stop-open-white',
            }),
          ],
        }),
      ],
      lines: [makeLine({ id: 'L1' }), makeLine({ id: 'L2' })],
    });
    const next = T.setLineSingletonDotStyle(doc, 'L1', 'stop-open-white');
    expect('dotStyle' in next.stations.a.stops[0]).toBe(false);
    expect(next.stations.b.stops[0].dotStyle).toEqual(OW);
  });
});

describe('setLineMultiDotStyle', () => {
  const OW = DOT_SHAPE_PRESETS['open-white'];

  it('sets the multi field (raw + tag) independently of the singleton field', () => {
    const doc = makeDoc({
      lines: [makeLine({ id: 'L1', singletonDotStyleId: 'stop-open-white' })],
    });
    const next = T.setLineMultiDotStyle(doc, 'L1', 'stop-filled-white');
    expect(next.lines.L1.multiDotStyle).toEqual(DOT_SHAPE_PRESETS['filled-white']);
    expect(next.lines.L1.multiDotStyleId).toBe('stop-filled-white');
    // The singleton field the fixture set is preserved (independence).
    expect(next.lines.L1.singletonDotStyle).toEqual(OW);
    expect(next.lines.L1.singletonDotStyleId).toBe('stop-open-white');
  });

  it('ALWAYS stores the tag + raw at the factory default (no drop-at-default)', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1', multiDotStyleId: 'stop-open-white' })] });
    const next = T.setLineMultiDotStyle(doc, 'L1', DEFAULT_STOP_DOT_STYLE_ID);
    expect(next.lines.L1.multiDotStyleId).toBe('stop-filled-black');
    expect(next.lines.L1.multiDotStyle).toEqual(DEFAULT_DOT_STYLE);
  });

  it('clears matching-tag overrides on SHARED stops only, never on singleton stops', () => {
    const doc = makeDoc({
      stations: [
        // shared: L1's stop is a multiple stop — matches, should clear.
        makeStation({
          id: 'a',
          stops: [
            makeStop('L1', {
              dotStyle: STOP_DOT_FACTORY_STYLES['stop-open-white'].props,
              dotStyleId: 'stop-open-white',
            }),
            makeStop('L2', { col: 1 }),
          ],
        }),
        // singleton L1 with the same override tag — must NOT clear (wrong case).
        makeStation({
          id: 'b',
          stops: [
            makeStop('L1', {
              dotStyle: STOP_DOT_FACTORY_STYLES['stop-open-white'].props,
              dotStyleId: 'stop-open-white',
            }),
          ],
        }),
      ],
      lines: [makeLine({ id: 'L1' }), makeLine({ id: 'L2' })],
    });
    const next = T.setLineMultiDotStyle(doc, 'L1', 'stop-open-white');
    expect('dotStyle' in next.stations.a.stops[0]).toBe(false);
    expect('dotStyleId' in next.stations.a.stops[0]).toBe(false);
    expect(next.stations.b.stops[0].dotStyle).toEqual(OW);
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
      lines: [makeLine({ id: 'L1', singletonDotSize: 10 })],
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

  it('stores an explicit 8 on a service-code stop — its tracking default is 12, not 8', () => {
    // Same discontinuity as the line default, one level down: 8 must pin, not
    // collapse to the larger service-code default.
    const CODE = DOT_SHAPE_PRESETS['filled-black-service-code'];
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
      lines: [makeLine({ id: 'L1', singletonDotStyle: CODE })],
    });
    expect(T.setDotSize(doc, 'a', 'L1', 8).stations.a.stops[0].dotSize).toBe(8);
    // ...and 12 (the true tracking size) clears back to fully tracking.
    const pinned = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1', { dotSize: 8 })] })],
      lines: [makeLine({ id: 'L1', singletonDotStyle: CODE })],
    });
    expect('dotSize' in T.setDotSize(pinned, 'a', 'L1', 12).stations.a.stops[0]).toBe(false);
  });

  it("stores the global default as an explicit override when the line's default differs", () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
      lines: [makeLine({ id: 'L1', singletonDotSize: 10 })],
    });
    const next = T.setDotSize(doc, 'a', 'L1', DOT_SIZE_DEFAULT);
    expect(next.stations.a.stops[0].dotSize).toBe(DOT_SIZE_DEFAULT);
  });

  it('stores the size as given and clamps to ≥ DOT_SIZE_MIN', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
      lines: [makeLine({ id: 'L1' })],
    });
    expect(T.setDotSize(doc, 'a', 'L1', 7.4).stations.a.stops[0].dotSize).toBe(7.4);
    expect(T.setDotSize(doc, 'a', 'L1', 7.25).stations.a.stops[0].dotSize).toBe(7.25);
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

describe('setLineSingletonDotSize', () => {
  it('stores a non-default size, independently of the multi size', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    const next = T.setLineSingletonDotSize(doc, 'L1', 12);
    expect(next.lines.L1.singletonDotSize).toBe(12);
    expect('multiDotSize' in next.lines.L1).toBe(false);
  });

  it('stores the default size explicitly (absence is never written)', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1', singletonDotSize: 12 })] });
    expect(T.setLineSingletonDotSize(doc, 'L1', DOT_SIZE_DEFAULT).lines.L1.singletonDotSize).toBe(
      DOT_SIZE_DEFAULT,
    );
    // A hair off the default is its own size, not the default.
    expect(
      T.setLineSingletonDotSize(doc, 'L1', DOT_SIZE_DEFAULT + 0.1).lines.L1.singletonDotSize,
    ).toBe(DOT_SIZE_DEFAULT + 0.1);
  });

  it('reference-equal no-ops: unchanged value, unknown id, non-finite input', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1', singletonDotSize: 12 })] });
    expect(T.setLineSingletonDotSize(doc, 'L1', 12)).toBe(doc);
    expect(T.setLineSingletonDotSize(doc, 'ghost', 16)).toBe(doc);
    expect(T.setLineSingletonDotSize(doc, 'L1', NaN)).toBe(doc);
  });

  it('clears matching overrides on SINGLETON stops only; different sizes untouched', () => {
    const doc = makeDoc({
      stations: [
        makeStation({ id: 'a', stops: [makeStop('L1', { dotSize: 10 })] }),
        makeStation({ id: 'b', stops: [makeStop('L1', { dotSize: 16 })] }),
        makeStation({ id: 'c', stops: [makeStop('L1')] }),
      ],
      lines: [makeLine({ id: 'L1' })],
    });
    const next = T.setLineSingletonDotSize(doc, 'L1', 10);
    expect('dotSize' in next.stations.a.stops[0]).toBe(false);
    expect(next.stations.b.stops[0].dotSize).toBe(16);
    expect(next.stations.c.stops[0].dotSize).toBeUndefined();
  });

  it('does NOT clear a matching override on a shared stop, nor on other lines', () => {
    const doc = makeDoc({
      stations: [
        // shared: L1's stop is a multiple stop — the singleton edit skips it.
        makeStation({
          id: 'a',
          stops: [makeStop('L1', { dotSize: 10 }), makeStop('L2', { col: 1 })],
        }),
        // other line, singleton — untouched.
        makeStation({ id: 'b', stops: [makeStop('L2', { dotSize: 10 })] }),
      ],
      lines: [makeLine({ id: 'L1' }), makeLine({ id: 'L2' })],
    });
    const next = T.setLineSingletonDotSize(doc, 'L1', 10);
    expect(next.stations.a.stops[0].dotSize).toBe(10);
    expect(next.stations.b.stops[0].dotSize).toBe(10);
  });

  it('acceptance: singleton default 7, stop at 8 — 7→9 keeps 8; 7→8 absorbs it; 8→9 moves the stop', () => {
    let doc = makeDoc({
      stations: [
        makeStation({ id: 's', stops: [makeStop('L1')] }),
        makeStation({ id: 't', stops: [makeStop('L1')] }),
      ],
      lines: [makeLine({ id: 'L1' })],
    });
    doc = T.setLineSingletonDotSize(doc, 'L1', 7);
    doc = T.setDotSize(doc, 's', 'L1', 8);
    expect(doc.stations.s.stops[0].dotSize).toBe(8);

    doc = T.setLineSingletonDotSize(doc, 'L1', 9);
    expect(doc.stations.s.stops[0].dotSize).toBe(8);
    expect(doc.stations.t.stops[0].dotSize).toBeUndefined();
    expect(doc.lines.L1.singletonDotSize).toBe(9);

    doc = T.setLineSingletonDotSize(doc, 'L1', 8);
    expect('dotSize' in doc.stations.s.stops[0]).toBe(false);

    doc = T.setLineSingletonDotSize(doc, 'L1', 9);
    expect(doc.stations.s.stops[0].dotSize).toBeUndefined();
    expect(doc.lines.L1.singletonDotSize).toBe(9);
  });

  it('service-code default grows in even increments — no jump when the size passes 8', () => {
    // Regression: a service-code disc TRACKS a diameter of 12 (the larger
    // legible default), so an explicit 8 is a real, distinct size. The setter
    // used to collapse 8 to "tracking", snapping the dot from 8 up to 12.
    const CODE = DOT_SHAPE_PRESETS['filled-black-service-code'];
    let doc = makeDoc({
      stations: [makeStation({ id: 's', stops: [makeStop('L1')] })],
      lines: [makeLine({ id: 'L1', service: 'A', singletonDotStyle: CODE })],
    });
    // The DIAMETER the dot actually renders at, through the full override chain.
    const renderedDiameter = (): number => {
      const line = doc.lines.L1;
      const stop = doc.stations.s.stops[0];
      const params = resolveDotRender(
        CODE,
        line.color,
        'A',
        false,
        dotSizeOverride(line, stop, true),
      );
      return params!.r * 2;
    };
    for (const px of [6, 7, 8, 9]) {
      doc = T.setLineSingletonDotSize(doc, 'L1', px);
      expect(renderedDiameter()).toBe(px);
    }
    // The natural size (12) is stored like any other — nothing collapses.
    doc = T.setLineSingletonDotSize(doc, 'L1', 12);
    expect(doc.lines.L1.singletonDotSize).toBe(12);
    expect(renderedDiameter()).toBe(12);
  });
});

describe('setLineMultiDotSize', () => {
  it('stores the multi size independently of the singleton size', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1', singletonDotSize: 6 })] });
    const set = T.setLineMultiDotSize(doc, 'L1', 12);
    expect(set.lines.L1.multiDotSize).toBe(12);
    expect(set.lines.L1.singletonDotSize).toBe(6);
    expect(T.setLineMultiDotSize(set, 'L1', DOT_SIZE_DEFAULT).lines.L1.multiDotSize).toBe(
      DOT_SIZE_DEFAULT,
    );
  });

  it('clears matching overrides on SHARED stops only, never on singleton stops', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 'a',
          stops: [makeStop('L1', { dotSize: 10 }), makeStop('L2', { col: 1 })],
        }),
        makeStation({ id: 'b', stops: [makeStop('L1', { dotSize: 10 })] }),
      ],
      lines: [makeLine({ id: 'L1' }), makeLine({ id: 'L2' })],
    });
    const next = T.setLineMultiDotSize(doc, 'L1', 10);
    expect('dotSize' in next.stations.a.stops[0]).toBe(false);
    expect(next.stations.b.stops[0].dotSize).toBe(10);
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

describe('setStationStopType', () => {
  it('stores an explicit declaration', () => {
    const doc = makeDoc({ stations: [makeStation({ id: 'a' })] });
    expect(T.setStationStopType(doc, 'a', 'interchange').stations.a.stopType).toBe('interchange');
    expect(T.setStationStopType(doc, 'a', 'singleton').stations.a.stopType).toBe('singleton');
  });

  it("drops the field for 'auto' — the default is never stored", () => {
    const doc = makeDoc({ stations: [makeStation({ id: 'a', stopType: 'interchange' })] });
    const next = T.setStationStopType(doc, 'a', 'auto');
    expect('stopType' in next.stations.a).toBe(false);
  });

  it('preserves the rest of the station', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 'a',
          name: 'Anvil',
          stops: [makeStop('L1', { dotStyle: DOT_SHAPE_PRESETS['filled-white'] })],
        }),
      ],
    });
    const next = T.setStationStopType(doc, 'a', 'singleton');
    expect(next.stations.a).toMatchObject({ id: 'a', name: 'Anvil', stopType: 'singleton' });
    expect(next.stations.a.stops[0].dotStyle).toEqual(DOT_SHAPE_PRESETS['filled-white']);
  });

  it('returns the same doc reference when the value is unchanged', () => {
    const doc = makeDoc({ stations: [makeStation({ id: 'a', stopType: 'singleton' })] });
    expect(T.setStationStopType(doc, 'a', 'singleton')).toBe(doc);
  });

  it("treats an absent stopType and 'auto' as equivalent for no-op detection", () => {
    const doc = makeDoc({ stations: [makeStation({ id: 'a' })] });
    expect(T.setStationStopType(doc, 'a', 'auto')).toBe(doc);
  });

  it('silently no-ops on unknown station id', () => {
    const doc = makeDoc({ stations: [makeStation({ id: 'a' })] });
    expect(T.setStationStopType(doc, 'ghost', 'interchange')).toBe(doc);
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
  it('clamps fontSize at MIN only (textbox accepts arbitrary above) and keeps a typed size', () => {
    const doc = makeDoc({ textLabels: [makeTextLabel({ id: 'g1', fontSize: 16 })] });
    expect(T.updateTextLabel(doc, 'g1', { fontSize: 0 }).textLabels.g1.fontSize).toBe(1);
    expect(T.updateTextLabel(doc, 'g1', { fontSize: 999 }).textLabels.g1.fontSize).toBe(999);
    // FONT_SIZE_STEP is the slider's/wheel's granularity, not the set of legal
    // sizes: an off-quarter size stands exactly as given, to any precision.
    expect(T.updateTextLabel(doc, 'g1', { fontSize: 23.7 }).textLabels.g1.fontSize).toBe(23.7);
    expect(T.updateTextLabel(doc, 'g1', { fontSize: 23.5 }).textLabels.g1.fontSize).toBe(23.5);
    expect(T.updateTextLabel(doc, 'g1', { fontSize: 23.32455 }).textLabels.g1.fontSize).toBe(
      23.32455,
    );
  });
  it('clamps column width to non-negative (0 = Auto), fractions included', () => {
    const doc = makeDoc({ textLabels: [makeTextLabel({ id: 'g1' })] });
    expect(T.updateTextLabel(doc, 'g1', { width: -5 }).textLabels.g1.width).toBe(0);
    expect(T.updateTextLabel(doc, 'g1', { width: 0 }).textLabels.g1.width).toBe(0);
    expect(T.updateTextLabel(doc, 'g1', { width: 200.6 }).textLabels.g1.width).toBe(200.6);
  });
  it('clamps leading at 0 and keeps what it is given', () => {
    const doc = makeDoc({ textLabels: [makeTextLabel({ id: 'g1' })] });
    expect(T.updateTextLabel(doc, 'g1', { leading: -0.5 }).textLabels.g1.leading).toBe(0);
    expect(T.updateTextLabel(doc, 'g1', { leading: 1.234 }).textLabels.g1.leading).toBe(1.234);
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
  it('clamps editorHeight to a positive integer', () => {
    const doc = makeDoc({ textLabels: [makeTextLabel({ id: 'g1' })] });
    expect(T.updateTextLabel(doc, 'g1', { editorHeight: 120.6 }).textLabels.g1.editorHeight).toBe(
      121,
    );
    expect(T.updateTextLabel(doc, 'g1', { editorHeight: 0 }).textLabels.g1.editorHeight).toBe(1);
    expect(T.updateTextLabel(doc, 'g1', { editorHeight: -40 }).textLabels.g1.editorHeight).toBe(1);
  });
  it('does not re-anchor (move x/y) when only editorHeight changes', () => {
    const doc = makeDoc({
      textLabels: [makeTextLabel({ id: 'g1', x: 100, y: 200, text: 'A\nB' })],
    });
    const next = T.updateTextLabel(doc, 'g1', { editorHeight: 180 });
    // editorHeight is an editor-UI dimension only — it must never nudge the
    // label's on-canvas position the way a text/size/width change does.
    expect(next.textLabels.g1.x).toBe(100);
    expect(next.textLabels.g1.y).toBe(200);
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

  // The chain between the endpoints must come from the line's EDGE graph —
  // `stations` is a pure membership list whose order is the order stations were
  // ADDED, which need not match the track. This doc models a real map: the path
  // runs a→b→c→d→e→f→g down a column, but membership lists the middle stations
  // first. An index slice of `stations` between the endpoints grabs [g, c, b, a]
  // and leaves d, e, f stuck (the shipped bug this pins against).
  describe('membership order ≠ path order', () => {
    const scrambledDoc = (): MapDoc =>
      makeDoc({
        stations: [
          stationWithStop('d', 'L1', { x: 0, y: 26 }),
          stationWithStop('e', 'L1', { x: 0, y: 38 }),
          stationWithStop('f', 'L1', { x: 0, y: 55 }),
          stationWithStop('g', 'L1', { x: 0, y: 60 }),
          stationWithStop('c', 'L1', { x: 0, y: 17 }),
          stationWithStop('b', 'L1', { x: 0, y: 7 }),
          stationWithStop('a', 'L1', { x: 0, y: 0 }),
        ],
        lines: [
          makeLine({
            id: 'L1',
            stations: ['d', 'e', 'f', 'g', 'c', 'b', 'a'],
            edges: ['a|b', 'b|c', 'c|d', 'd|e', 'e|f', 'f|g'],
          }),
        ],
      });

    it('straight mode moves EVERY stop on the edge path between the endpoints', () => {
      const next = T.redistributeBetween(scrambledDoc(), 'a', 'g', 'straight');
      for (const [id, y] of [
        ['b', 10],
        ['c', 20],
        ['d', 30],
        ['e', 40],
        ['f', 50],
      ] as const) {
        expect(next.stations[id].x).toBe(0);
        expect(next.stations[id].y).toBeCloseTo(y, 9);
      }
    });

    it('arc-bends mode walks the same edge path', () => {
      // Collinear monotone column → arc-length spacing coincides with straight.
      const next = T.redistributeBetween(scrambledDoc(), 'a', 'g', 'arc-bends');
      for (const [id, y] of [
        ['b', 10],
        ['c', 20],
        ['d', 30],
        ['e', 40],
        ['f', 50],
      ] as const) {
        expect(next.stations[id].y).toBeCloseTo(y, 9);
      }
    });

    it('leaves stations of an uninvolved branch untouched', () => {
      // Trunk a—b—c continues c—d—e; a second branch c—x—y heads right. x and y
      // sit between the endpoints in MEMBERSHIP order but not on the a→e path.
      const doc = makeDoc({
        stations: [
          stationWithStop('a', 'L1', { x: 0, y: 0 }),
          stationWithStop('x', 'L1', { x: 10, y: 25 }),
          stationWithStop('y', 'L1', { x: 20, y: 25 }),
          stationWithStop('b', 'L1', { x: 0, y: 12 }),
          stationWithStop('c', 'L1', { x: 0, y: 25 }),
          stationWithStop('d', 'L1', { x: 0, y: 33 }),
          stationWithStop('e', 'L1', { x: 0, y: 60 }),
        ],
        lines: [
          makeLine({
            id: 'L1',
            stations: ['a', 'x', 'y', 'b', 'c', 'd', 'e'],
            edges: ['a|b', 'b|c', 'c|d', 'd|e', 'c|x', 'x|y'],
          }),
        ],
      });
      const next = T.redistributeBetween(doc, 'a', 'e', 'straight');
      // On-path intermediates land on exact quarters of the 60px span.
      expect(next.stations.b).toMatchObject({ x: 0, y: 15 });
      expect(next.stations.c).toMatchObject({ x: 0, y: 30 });
      expect(next.stations.d).toMatchObject({ x: 0, y: 45 });
      // Off-path stations keep their exact objects (not even rewritten).
      expect(next.stations.x).toBe(doc.stations.x);
      expect(next.stations.y).toBe(doc.stations.y);
    });
  });

  it('grid-on arc-bends pulls a slightly-off-grid station ONTO the grid (no eps skip)', () => {
    // m sits 0.5 off its grid-snapped redistribute target (50, 0). The
    // sub-pixel drift-skip must not apply when grid is on — the snapped
    // proposal is exact, so the station lands on the grid.
    const doc = doc5([
      ['a', 0, 0],
      ['m', 49.5, 0],
      ['b', 100, 0],
    ]);
    const next = T.redistributeBetween(doc, 'a', 'b', 'arc-bends', 'both');
    expect(next.stations.m.x).toBe(50);
    expect(next.stations.m.y).toBe(0);
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

  // The 5° `ANGLE_THRESHOLD` in transforms.ts decides, in arc-bends mode,
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

describe('loops and branches (edge-set topology)', () => {
  const fourStops = () => [
    makeStation({ id: 'a', stops: [makeStop('L1')] }),
    makeStation({ id: 'b', stops: [makeStop('L1')] }),
    makeStation({ id: 'c', stops: [makeStop('L1')] }),
    makeStation({ id: 'd', stops: [makeStop('L1')] }),
  ];

  it('toggleEdgeOnLine closes a loop by connecting the two ends', () => {
    const base = makeDoc({
      stations: fourStops().slice(0, 3),
      lines: [makeLine({ id: 'L1', stations: ['a', 'b', 'c'] })], // edges a|b, b|c
    });
    const looped = T.toggleEdgeOnLine(base, 'L1', 'a', 'c');
    // A genuine 3-cycle — every station degree 2, no repeated member.
    expect(new Set(looped.lines.L1.edges)).toEqual(new Set(['a|b', 'b|c', 'a|c']));
    expect(looped.lines.L1.stations).toEqual(['a', 'b', 'c']);
  });

  it('addStationToLine adds a lone member (stop, no edge, no splice)', () => {
    const base = makeDoc({
      stations: fourStops().slice(0, 3),
      lines: [makeLine({ id: 'L1', stations: ['a', 'b'] })], // edge a|b
    });
    const out = T.addStationToLine(base, 'L1', 'c');
    expect(out.lines.L1.stations).toEqual(['a', 'b', 'c']); // appended member
    expect(out.lines.L1.edges).toEqual(['a|b']); // NO edge to c, a|b untouched
    expect(out.stations.c.stops.some((s) => s.lineId === 'L1')).toBe(true);
    // Already a member → no-op (same reference).
    expect(T.addStationToLine(out, 'L1', 'c')).toBe(out);
  });

  it('draw flow (addStationToLine + toggleEdgeOnLine) branches to a new station', () => {
    const base = makeDoc({
      stations: fourStops(),
      lines: [makeLine({ id: 'L1', stations: ['a', 'b', 'c'] })], // a|b, b|c
    });
    // Pen at b; draw a branch to a fresh member d.
    const withD = T.addStationToLine(base, 'L1', 'd');
    const branched = T.toggleEdgeOnLine(withD, 'L1', 'b', 'd');
    expect(new Set(branched.lines.L1.edges)).toEqual(new Set(['a|b', 'b|c', 'b|d']));
  });

  it('toggleEdgeOnLine forms a branch: a junction of degree 3', () => {
    const base = makeDoc({
      stations: fourStops(),
      // Trunk a-b-c, plus member d not yet wired in.
      lines: [makeLine({ id: 'L1', stations: ['a', 'b', 'c', 'd'], edges: ['a|b', 'b|c'] })],
    });
    const branched = T.toggleEdgeOnLine(base, 'L1', 'b', 'd');
    expect(new Set(branched.lines.L1.edges)).toEqual(new Set(['a|b', 'b|c', 'b|d']));
  });

  it('toggleEdgeOnLine removes an existing edge; no-op for a non-member', () => {
    const base = makeDoc({
      stations: fourStops().slice(0, 3),
      lines: [makeLine({ id: 'L1', stations: ['a', 'b', 'c'] })],
    });
    expect(T.toggleEdgeOnLine(base, 'L1', 'a', 'b').lines.L1.edges).toEqual(['b|c']);
    expect(T.toggleEdgeOnLine(base, 'L1', 'a', 'zzz')).toBe(base);
  });

  it('drops a loop-closing edge override when that edge is cut', () => {
    const base = makeDoc({
      stations: fourStops().slice(0, 3),
      lines: [
        makeLine({
          id: 'L1',
          stations: ['a', 'b', 'c'],
          edges: ['a|b', 'b|c', 'a|c'],
          segmentStyles: { 'a|c': 'dashed' },
        }),
      ],
    });
    const cut = T.toggleEdgeOnLine(base, 'L1', 'a', 'c');
    expect(cut.lines.L1.edges).toEqual(['a|b', 'b|c']);
    expect(cut.lines.L1.segmentStyles).toEqual({}); // orphaned override pruned
  });

  it('cutting a segment that strands a terminus drops that station from the line', () => {
    const base = makeDoc({
      stations: fourStops().slice(0, 3),
      lines: [makeLine({ id: 'L1', stations: ['a', 'b', 'c'] })], // a|b, b|c
    });
    // Cut a|b: a was a degree-1 terminus, so it's now edgeless → off the line.
    const cut = T.toggleEdgeOnLine(base, 'L1', 'a', 'b');
    expect(cut.lines.L1.edges).toEqual(['b|c']);
    expect(cut.lines.L1.stations).toEqual(['b', 'c']);
    expect(cut.stations.a.stops.some((s) => s.lineId === 'L1')).toBe(false);
    // b kept its remaining edge, so it stays a member with its stop.
    expect(cut.stations.b.stops.some((s) => s.lineId === 'L1')).toBe(true);
  });

  it('cutting an interior segment strands nobody (both endpoints keep an edge)', () => {
    const base = makeDoc({
      stations: fourStops(),
      lines: [makeLine({ id: 'L1', stations: ['a', 'b', 'c', 'd'] })], // a|b, b|c, c|d
    });
    const cut = T.toggleEdgeOnLine(base, 'L1', 'b', 'c'); // split into a-b and c-d
    expect(new Set(cut.lines.L1.edges)).toEqual(new Set(['a|b', 'c|d']));
    expect(cut.lines.L1.stations).toEqual(['a', 'b', 'c', 'd']); // all retained
  });

  it('cutting the only segment of a two-stop line strands both stations', () => {
    const base = makeDoc({
      stations: fourStops().slice(0, 2),
      lines: [makeLine({ id: 'L1', stations: ['a', 'b'] })], // a|b
    });
    const cut = T.toggleEdgeOnLine(base, 'L1', 'a', 'b');
    expect(cut.lines.L1.edges).toEqual([]);
    expect(cut.lines.L1.stations).toEqual([]);
    expect(cut.stations.a.stops.some((s) => s.lineId === 'L1')).toBe(false);
    expect(cut.stations.b.stops.some((s) => s.lineId === 'L1')).toBe(false);
  });

  it("cutting a branch's spur drops the spur tip but keeps the junction", () => {
    const base = makeDoc({
      stations: fourStops(),
      lines: [makeLine({ id: 'L1', stations: ['a', 'b', 'c', 'd'], edges: ['a|b', 'b|c', 'b|d'] })],
    });
    const cut = T.toggleEdgeOnLine(base, 'L1', 'b', 'd'); // d was the spur tip
    expect(new Set(cut.lines.L1.edges)).toEqual(new Set(['a|b', 'b|c']));
    expect(new Set(cut.lines.L1.stations)).toEqual(new Set(['a', 'b', 'c']));
    expect(cut.stations.d.stops.some((s) => s.lineId === 'L1')).toBe(false);
  });

  it('cascade-deletes a transfer anchored at a stranded stop', () => {
    const base = makeDoc({
      stations: fourStops().slice(0, 3),
      lines: [makeLine({ id: 'L1', stations: ['a', 'b', 'c'] })], // a|b, b|c
      transfers: [makeTransfer({ id: 'x', a: { stationId: 'a', lineId: 'L1' } })],
    });
    // Cutting a|b strands a; its (a, L1) stop is dropped, so the transfer goes.
    const cut = T.toggleEdgeOnLine(base, 'L1', 'a', 'b');
    expect(cut.transfers.x).toBeUndefined();
  });

  it('removing an intermediate stop heals the gap (degree-2)', () => {
    const base = makeDoc({
      stations: fourStops().slice(0, 3),
      lines: [makeLine({ id: 'L1', stations: ['a', 'b', 'c'] })], // a|b, b|c
    });
    const healed = T.removeStationFromLine(base, 'L1', 1); // remove b
    expect(healed.lines.L1.stations).toEqual(['a', 'c']);
    expect(healed.lines.L1.edges).toEqual(['a|c']);
  });

  it('removing a junction drops all incident edges (no heal)', () => {
    const base = makeDoc({
      stations: fourStops(),
      lines: [makeLine({ id: 'L1', stations: ['a', 'b', 'c', 'd'], edges: ['a|b', 'b|c', 'b|d'] })],
    });
    const out = T.removeStationFromLine(base, 'L1', 1); // remove junction b
    expect(out.lines.L1.edges).toEqual([]);
    expect(new Set(out.lines.L1.stations)).toEqual(new Set(['a', 'c', 'd']));
  });
});

// The two canvas line-editing primitives: "connect" (station cursor → station
// click) wires an edge from a member, adding the target to the line if needed;
// "splice" (edge cursor → station click) subdivides an existing edge with the
// clicked station. Both are single transforms so each canvas click is one undo
// entry, and both return the SAME reference on no-op (load-bearing for undo
// grouping).
describe('connectStationsOnLine', () => {
  const threeStops = () => [
    makeStation({ id: 'a', stops: [makeStop('L1')] }),
    makeStation({ id: 'b', stops: [makeStop('L1')] }),
    makeStation({ id: 'c', stops: [makeStop('L1')] }),
  ];

  it('wires an edge between two existing members (loop close)', () => {
    const base = makeDoc({
      stations: threeStops(),
      lines: [makeLine({ id: 'L1', stations: ['a', 'b', 'c'] })], // a|b, b|c
    });
    const out = T.connectStationsOnLine(base, 'L1', 'c', 'a');
    expect(new Set(out.lines.L1.edges)).toEqual(new Set(['a|b', 'b|c', 'a|c']));
    expect(out.lines.L1.stations).toEqual(['a', 'b', 'c']); // membership untouched
  });

  it('is idempotent: an already-connected pair is a same-reference no-op', () => {
    const base = makeDoc({
      stations: threeStops(),
      lines: [makeLine({ id: 'L1', stations: ['a', 'b', 'c'] })],
    });
    expect(T.connectStationsOnLine(base, 'L1', 'a', 'b')).toBe(base);
    expect(T.connectStationsOnLine(base, 'L1', 'b', 'a')).toBe(base); // either direction
  });

  it('adds a non-member target to the line (stop cell spawned) and wires the edge', () => {
    const base = makeDoc({
      stations: [...threeStops().slice(0, 2), makeStation({ id: 'n', stops: [] })],
      lines: [makeLine({ id: 'L1', stations: ['a', 'b'] })], // a|b
    });
    const out = T.connectStationsOnLine(base, 'L1', 'a', 'n'); // branch off a
    expect(out.lines.L1.stations).toEqual(['a', 'b', 'n']);
    expect(new Set(out.lines.L1.edges)).toEqual(new Set(['a|b', 'a|n']));
    expect(out.stations.n.stops.some((s) => s.lineId === 'L1')).toBe(true);
  });

  it('guards: from must be a member; self-connect and unknown ids are no-ops', () => {
    const base = makeDoc({
      stations: [...threeStops().slice(0, 2), makeStation({ id: 'n', stops: [] })],
      lines: [makeLine({ id: 'L1', stations: ['a', 'b'] })],
    });
    expect(T.connectStationsOnLine(base, 'L1', 'n', 'a')).toBe(base); // from not on line
    expect(T.connectStationsOnLine(base, 'L1', 'a', 'a')).toBe(base);
    expect(T.connectStationsOnLine(base, 'L1', 'a', 'zzz')).toBe(base);
    expect(T.connectStationsOnLine(base, 'LX', 'a', 'b')).toBe(base);
  });
});

describe('spliceStationIntoEdge', () => {
  const fourStops = () => [
    makeStation({ id: 'a', stops: [makeStop('L1')] }),
    makeStation({ id: 'b', stops: [makeStop('L1')] }),
    makeStation({ id: 'c', stops: [makeStop('L1')] }),
    makeStation({ id: 'd', stops: [makeStop('L1')] }),
  ];

  it('splices a non-member into the edge: membership, stop cell, rewired edges', () => {
    const base = makeDoc({
      stations: [
        makeStation({ id: 'a', stops: [makeStop('L1')] }),
        makeStation({ id: 'b', stops: [makeStop('L1')] }),
        makeStation({ id: 'n', stops: [] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['a', 'b'] })], // a|b
    });
    const out = T.spliceStationIntoEdge(base, 'L1', 'a', 'b', 'n');
    expect(new Set(out.lines.L1.edges)).toEqual(new Set(['a|n', 'b|n']));
    expect(out.lines.L1.stations).toEqual(['a', 'b', 'n']);
    expect(out.stations.n.stops.some((s) => s.lineId === 'L1')).toBe(true);
  });

  it('splices an existing member into an edge elsewhere (bypass rerouting)', () => {
    const base = makeDoc({
      stations: fourStops(),
      lines: [makeLine({ id: 'L1', stations: ['a', 'b', 'c', 'd'] })], // a|b, b|c, c|d
    });
    const out = T.spliceStationIntoEdge(base, 'L1', 'a', 'b', 'd');
    expect(new Set(out.lines.L1.edges)).toEqual(new Set(['a|d', 'b|d', 'b|c', 'c|d']));
    expect(out.lines.L1.stations).toEqual(['a', 'b', 'c', 'd']); // membership unchanged
  });

  it('guards: missing edge, endpoint target, and unknown ids are same-ref no-ops', () => {
    const base = makeDoc({
      stations: fourStops().slice(0, 3),
      lines: [makeLine({ id: 'L1', stations: ['a', 'b', 'c'] })], // a|b, b|c
    });
    expect(T.spliceStationIntoEdge(base, 'L1', 'a', 'c', 'b')).toBe(base); // a–c not an edge
    expect(T.spliceStationIntoEdge(base, 'L1', 'a', 'b', 'a')).toBe(base); // endpoint
    expect(T.spliceStationIntoEdge(base, 'L1', 'a', 'b', 'b')).toBe(base); // endpoint
    expect(T.spliceStationIntoEdge(base, 'L1', 'a', 'b', 'zzz')).toBe(base);
    expect(T.spliceStationIntoEdge(base, 'LX', 'a', 'b', 'c')).toBe(base);
  });

  it('prunes the split edge’s style override (the halves inherit the line style)', () => {
    const base = makeDoc({
      stations: [
        makeStation({ id: 'a', stops: [makeStop('L1')] }),
        makeStation({ id: 'b', stops: [makeStop('L1')] }),
        makeStation({ id: 'n', stops: [] }),
      ],
      lines: [
        makeLine({
          id: 'L1',
          stations: ['a', 'b'],
          segmentStyles: { 'a|b': 'dashed' },
        }),
      ],
    });
    const out = T.spliceStationIntoEdge(base, 'L1', 'a', 'b', 'n');
    expect(out.lines.L1.segmentStyles).toEqual({}); // orphaned override pruned
  });

  it('prunes a line tag anchored on the split edge', () => {
    const base = makeDoc({
      stations: [
        makeStation({ id: 'a', stops: [makeStop('L1')] }),
        makeStation({ id: 'b', stops: [makeStop('L1')] }),
        makeStation({ id: 'n', stops: [] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['a', 'b'] })],
      lineTags: [makeLineTag({ id: 't1', lineId: 'L1', fromStationId: 'a', toStationId: 'b' })],
    });
    const out = T.spliceStationIntoEdge(base, 'L1', 'a', 'b', 'n');
    expect(out.lineTags).toEqual({}); // the a–b corridor no longer exists
  });
});

describe('design swatch refs', () => {
  const GRAYS: Palette = {
    name: 'grays',
    kind: 'design',
    swatches: [
      { name: 'Border', color: '#333333', night: '#bbbbbb' },
      { name: 'Wash', color: '#eeeeee' },
    ],
  };
  const BORDER = { palette: 'grays', swatch: 'Border' };
  const WASH = { palette: 'grays', swatch: 'Wash' };
  const withGrays = (parts: Parameters<typeof makeDoc>[0]) =>
    T.addPaletteToMap(makeDoc(parts), GRAYS);

  describe('updatePolygon and the detach rule', () => {
    const base = () =>
      withGrays({
        polygons: [
          makePolygon({
            id: 'P',
            fill: '#333333',
            darkFill: '#bbbbbb',
            stroke: '#eeeeee',
            darkStroke: '#eeeeee',
            fillRef: BORDER,
            strokeRef: WASH,
          }),
        ],
      });

    it('a value-half write without the ref key detaches that pair only', () => {
      const doc = T.updatePolygon(base(), 'P', { darkFill: '#000000' });
      expect('fillRef' in doc.polygons.P).toBe(false);
      expect(doc.polygons.P.strokeRef).toEqual(WASH);
    });

    it('a pair write carrying its ref keeps the link', () => {
      const doc = T.updatePolygon(base(), 'P', {
        fill: '#eeeeee',
        darkFill: '#eeeeee',
        fillRef: WASH,
      });
      expect(doc.polygons.P.fillRef).toEqual(WASH);
    });

    it('an unrelated patch leaves both refs alone', () => {
      const doc = T.updatePolygon(base(), 'P', { strokeWidth: 3 });
      expect(doc.polygons.P.fillRef).toEqual(BORDER);
      expect(doc.polygons.P.strokeRef).toEqual(WASH);
    });
  });

  describe('updateTextLabel and the detach rule', () => {
    const base = () =>
      withGrays({
        textLabels: [
          makeTextLabel({ id: 'G', color: '#333333', darkColor: '#bbbbbb', colorRef: BORDER }),
        ],
      });

    it('a color write without the ref key detaches; one carrying it keeps it', () => {
      const detached = T.updateTextLabel(base(), 'G', { color: '#000000' });
      expect('colorRef' in detached.textLabels.G).toBe(false);
      const linked = T.updateTextLabel(base(), 'G', {
        color: '#eeeeee',
        darkColor: '#eeeeee',
        colorRef: WASH,
      });
      expect(linked.textLabels.G.colorRef).toEqual(WASH);
    });

    it('an unrelated patch leaves the ref alone', () => {
      const doc = T.updateTextLabel(base(), 'G', { fontSize: 24 });
      expect(doc.textLabels.G.colorRef).toEqual(BORDER);
    });
  });

  describe('updateTransferStyle and the detach rule', () => {
    const base = () =>
      withGrays({
        transfers: [
          makeTransfer({
            id: 'X',
            color: { day: '#333333', night: '#bbbbbb' },
            colorRef: BORDER,
          }),
        ],
      });

    it('a color write without the ref key detaches; one carrying it keeps it', () => {
      const detached = T.updateTransferStyle(base(), 'X', {
        color: { day: '#123456', night: '#123456' },
      });
      expect('colorRef' in detached.transfers.X).toBe(false);
      const linked = T.updateTransferStyle(base(), 'X', {
        color: { day: '#eeeeee', night: '#eeeeee' },
        colorRef: WASH,
      });
      expect(linked.transfers.X.colorRef).toEqual(WASH);
    });

    // The override collapses at the constant default (black), but the link is
    // real: the ref stays beside the ABSENT value — the invariant is over
    // EFFECTIVE values.
    it('a ref survives beside a value collapsed at the transfer default', () => {
      const doc = T.updateTransferStyle(
        T.addPaletteToMap(base(), {
          name: 'grays',
          kind: 'design',
          swatches: [...GRAYS.swatches, { name: 'Ink', color: '#000000' }],
        }),
        'X',
        {
          color: { day: '#000000', night: '#000000' },
          colorRef: { palette: 'grays', swatch: 'Ink' },
        },
      );
      expect('color' in doc.transfers.X).toBe(false);
      expect(doc.transfers.X.colorRef).toEqual({ palette: 'grays', swatch: 'Ink' });
    });
  });

  describe('setLineStrokeColor with a ref', () => {
    const base = () =>
      withGrays({
        lines: [makeLine({ id: 'L', strokeWidth: 2 })],
      });

    it('writes the pair and the ref together; a ref-less write detaches', () => {
      const linked = T.setLineStrokeColor(
        base(),
        'L',
        { day: '#333333', night: '#bbbbbb' },
        BORDER,
      );
      expect(linked.lines.L.strokeColorRef).toEqual(BORDER);
      const detached = T.setLineStrokeColor(linked, 'L', { day: '#123456', night: '#123456' });
      expect('strokeColorRef' in detached.lines.L).toBe(false);
    });

    it('a ref survives beside a casing collapsed at the white default', () => {
      const doc = T.setLineStrokeColor(
        T.addPaletteToMap(base(), {
          name: 'grays',
          kind: 'design',
          swatches: [...GRAYS.swatches, { name: 'Paper', color: '#ffffff' }],
        }),
        'L',
        { day: '#ffffff', night: '#ffffff' },
        { palette: 'grays', swatch: 'Paper' },
      );
      expect('strokeColor' in doc.lines.L).toBe(false);
      expect(doc.lines.L.strokeColorRef).toEqual({ palette: 'grays', swatch: 'Paper' });
    });

    it("the 'line' sentinel never carries a ref", () => {
      const linked = T.setLineStrokeColor(
        base(),
        'L',
        { day: '#333333', night: '#bbbbbb' },
        BORDER,
      );
      const sentinel = T.setLineStrokeColor(linked, 'L', 'line', BORDER);
      expect(sentinel.lines.L.strokeColor).toBe('line');
      expect('strokeColorRef' in sentinel.lines.L).toBe(false);
    });

    it('re-writing the same pair and ref is a reference no-op', () => {
      const linked = T.setLineStrokeColor(
        base(),
        'L',
        { day: '#333333', night: '#bbbbbb' },
        BORDER,
      );
      expect(T.setLineStrokeColor(linked, 'L', { day: '#333333', night: '#bbbbbb' }, BORDER)).toBe(
        linked,
      );
    });
  });

  describe('reconcile over the design homes', () => {
    // One of everything, all linked to Border (#333333 day / #bbbbbb night).
    const linkedDoc = () =>
      withGrays({
        polygons: [makePolygon({ id: 'P', fill: '#333333', darkFill: '#bbbbbb', fillRef: BORDER })],
        textLabels: [
          makeTextLabel({ id: 'G', color: '#333333', darkColor: '#bbbbbb', colorRef: BORDER }),
        ],
        transfers: [
          makeTransfer({ id: 'X', color: { day: '#333333', night: '#bbbbbb' }, colorRef: BORDER }),
        ],
        lines: [
          makeLine({
            id: 'L',
            strokeWidth: 2,
            strokeColor: { day: '#333333', night: '#bbbbbb' },
            strokeColorRef: BORDER,
            singletonDotStyle: {
              ...DEFAULT_DOT_STYLE,
              fill: { day: '#333333', night: '#bbbbbb' },
              fillRef: BORDER,
            },
          }),
        ],
        stations: [
          makeStation({
            id: 's1',
            stops: [
              makeStop('L', {
                dotStyle: {
                  ...DEFAULT_DOT_STYLE,
                  strokeWidth: 1,
                  strokeColor: { day: '#333333', night: '#bbbbbb' },
                  strokeColorRef: BORDER,
                },
              }),
            ],
          }),
        ],
        styles: [
          makeStyle('polygon', 'y1', {
            name: 'Zone',
            props: { fill: '#333333', darkFill: '#bbbbbb', fillRef: BORDER },
          }),
          makeStyle('stopDot', 'y2', {
            name: 'Linked dot',
            props: {
              ...DEFAULT_DOT_STYLE,
              fill: { day: '#333333', night: '#bbbbbb' },
              fillRef: BORDER,
            },
          }),
        ],
      });

    it('a design recolor restamps every linked home in one write', () => {
      let doc = T.recolorMapPaletteColor(linkedDoc(), 'grays', 0, '#444444');
      doc = T.recolorMapPaletteColor(doc, 'grays', 0, '#cccccc', 'night');
      const pair = { day: '#444444', night: '#cccccc' };
      expect(doc.polygons.P).toMatchObject({ fill: '#444444', darkFill: '#cccccc' });
      expect(doc.textLabels.G).toMatchObject({ color: '#444444', darkColor: '#cccccc' });
      expect(doc.transfers.X.color).toEqual(pair);
      expect(doc.lines.L.strokeColor).toEqual(pair);
      expect(doc.lines.L.singletonDotStyle?.fill).toEqual(pair);
      expect(doc.stations.s1.stops[0].dotStyle?.strokeColor).toEqual(pair);
      const polyDef = doc.styles.y1;
      expect(polyDef.kind === 'polygon' && polyDef.props.fill).toBe('#444444');
      const dotDef = doc.styles.y2;
      expect(dotDef.kind === 'stopDot' && dotDef.props.fill).toEqual(pair);
    });

    it('removing the palette drops every ref and keeps every painted value', () => {
      const doc = T.removePaletteFromMap(linkedDoc(), 'grays');
      expect('fillRef' in doc.polygons.P).toBe(false);
      expect(doc.polygons.P.fill).toBe('#333333');
      expect('colorRef' in doc.textLabels.G).toBe(false);
      expect('colorRef' in doc.transfers.X).toBe(false);
      expect(doc.transfers.X.color).toEqual({ day: '#333333', night: '#bbbbbb' });
      expect('strokeColorRef' in doc.lines.L).toBe(false);
      expect('fillRef' in (doc.lines.L.singletonDotStyle ?? {})).toBe(false);
      const polyDef = doc.styles.y1;
      expect(polyDef.kind === 'polygon' && 'fillRef' in polyDef.props).toBe(false);
    });

    it('a swatch rename follows through every design home', () => {
      const doc = T.renameMapPaletteSwatch(linkedDoc(), 'grays', 0, 'Edge');
      const renamed = { palette: 'grays', swatch: 'Edge' };
      expect(doc.polygons.P.fillRef).toEqual(renamed);
      expect(doc.textLabels.G.colorRef).toEqual(renamed);
      expect(doc.transfers.X.colorRef).toEqual(renamed);
      expect(doc.lines.L.strokeColorRef).toEqual(renamed);
      expect(doc.lines.L.singletonDotStyle?.fillRef).toEqual(renamed);
      expect(doc.stations.s1.stops[0].dotStyle?.strokeColorRef).toEqual(renamed);
      const polyDef = doc.styles.y1;
      expect(polyDef.kind === 'polygon' && polyDef.props.fillRef).toEqual(renamed);
      const dotDef = doc.styles.y2;
      expect(dotDef.kind === 'stopDot' && dotDef.props.fillRef).toEqual(renamed);
    });

    it('a design ref pointing into a LINE palette is dangling', () => {
      const doc = T.reconcileSwatchRefs({
        ...linkedDoc(),
        polygons: {
          P: makePolygon({ id: 'P', fill: '#333333', fillRef: { palette: 'MTA', swatch: 'Blue' } }),
        },
      });
      expect('fillRef' in doc.polygons.P).toBe(false);
    });

    it('passes a canonical linked doc through by reference', () => {
      const doc = linkedDoc();
      expect(T.reconcileSwatchRefs(doc)).toBe(doc);
    });
  });
});
