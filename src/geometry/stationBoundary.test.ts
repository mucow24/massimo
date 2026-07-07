import { describe, it, expect } from 'vitest';
import {
  cellsAABBLocal,
  polygonsForRect,
  routeBulletsForRect,
  stationBoundaryRectsLocal,
  stationLocalToWorld,
  stationsForRect,
  textLabelHitPolygon,
  textLabelsForRect,
} from './stationBoundary';
import {
  makePolygon,
  makeStation,
  makeStop,
  makeTextLabel,
  stationWithStop,
} from '../test/fixtures';
import { STOP_SIZE } from './orientation';
import { rectIntersectsPolygon } from './rectPolygon';
import { stopHalfOf } from '../model/lineWidth';
import type { RouteBullet } from '../model/types';

const makeBullet = (id: string, x: number, y: number, size = 12): RouteBullet => ({
  id,
  x,
  y,
  rotation: 0,
  lineId: null,
  shape: 'circle',
  size,
});

describe('cellsAABBLocal — per-stop widths', () => {
  // One stop at (0,0) on L1, label at the default (0,-1). HIT_PAD = 2.
  const st = () => makeStation({ id: 'A', stops: [makeStop('L1', { row: 0, col: 0 })] });

  it('keeps the legacy geometry when no lookup is supplied', () => {
    expect(cellsAABBLocal(st())).toEqual({ x: -23, y: -9, w: 32, h: 18 });
  });

  it('grows each side by the dominating cell’s own half-extent', () => {
    // L1 at width 28: the stop contributes ±14 on every side it dominates;
    // the label cell stays unit-sized (±7) and still wins the left edge.
    const box = cellsAABBLocal(st(), stopHalfOf({ L1: { width: 28 } }));
    expect(box).toEqual({ x: -23, y: -16, w: 39, h: 32 });
  });

  it('a wider inner stop can dominate an edge over a farther-out narrow stop', () => {
    // L1 (col 0, w 28) vs L2 (col 0.5, w 2): the right edge comes from L1's
    // 0 + 14, NOT from the extremal-center L2 at 7 + 1 — per-cell extents,
    // not max-center + uniform pad.
    const station = makeStation({
      id: 'A',
      stops: [makeStop('L1', { row: 0, col: 0 }), makeStop('L2', { row: 0, col: 0.5 })],
    });
    const box = cellsAABBLocal(station, stopHalfOf({ L1: { width: 28 }, L2: { width: 2 } }));
    expect(box.x + box.w).toBeCloseTo(16, 6); // 14 + HIT_PAD
  });
});

describe('stationsForRect — per-stop widths', () => {
  it('a marquee over only the widened margin hits the station', () => {
    // Wide stop's cells AABB right edge sits at 16; the default-width edge
    // is 9. A rect spanning x ∈ [10, 12] touches only the widened margin.
    const st = makeStation({ id: 'A', stops: [makeStop('L1', { row: 0, col: 0 })] });
    const rect = { x0: 10, y0: -2, x1: 12, y1: 2 };
    expect(stationsForRect({ A: st }, rect)).toEqual([]);
    expect(stationsForRect({ A: st }, rect, undefined, stopHalfOf({ L1: { width: 28 } }))).toEqual([
      'A',
    ]);
  });
});

describe('stationBoundaryRectsLocal', () => {
  it('returns two 4-vertex rects (cells + label) in local coords', () => {
    const st = stationWithStop('A', 'L1', { x: 100, y: 100 });
    const { cells, label } = stationBoundaryRectsLocal(st);
    expect(cells).toHaveLength(4);
    expect(label).toHaveLength(4);
  });

  it('cells rect tightly bounds the stop cell with HIT_PAD', () => {
    // One stop at (row 0, col 0). Cells rect should be centered on origin
    // with size STOP_SIZE + 2*HIT_PAD. HIT_PAD is 2 in StationView.
    const st = makeStation({
      id: 'A',
      stops: [makeStop('L1', { row: 0, col: 0 })],
      // Push label far away so it doesn't overlap or extend the cells AABB
      // (cells AABB includes the label cell when both are at the same row/col
      // group — see allCells in StationView).
      label: { row: 0, col: 0, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
    });
    const { cells } = stationBoundaryRectsLocal(st);
    const xs = cells.map((p) => p.x);
    const ys = cells.map((p) => p.y);
    const HALF = STOP_SIZE / 2;
    const PAD = 2;
    expect(Math.min(...xs)).toBeCloseTo(-HALF - PAD, 5);
    expect(Math.max(...xs)).toBeCloseTo(HALF + PAD, 5);
    expect(Math.min(...ys)).toBeCloseTo(-HALF - PAD, 5);
    expect(Math.max(...ys)).toBeCloseTo(HALF + PAD, 5);
  });

  it('isWaypoint omits the label polygon entirely', () => {
    const st = makeStation({
      id: 'A',
      isWaypoint: true,
      stops: [makeStop('L1', { row: 0, col: 0 })],
    });
    const { cells, label } = stationBoundaryRectsLocal(st);
    expect(cells).toHaveLength(4);
    expect(label).toBeUndefined();
  });

  it('isWaypoint cells AABB excludes the label cell (tight to stops only)', () => {
    // Default label sits at (row 0, col -1). With isWaypoint, the AABB should
    // NOT extend left to include that cell — it should hug just the stop at
    // (row 0, col 0).
    const st = makeStation({
      id: 'A',
      isWaypoint: true,
      stops: [makeStop('L1', { row: 0, col: 0 })],
    });
    const { cells } = stationBoundaryRectsLocal(st);
    const xs = cells.map((p) => p.x);
    const HALF = STOP_SIZE / 2;
    const PAD = 2;
    expect(Math.min(...xs)).toBeCloseTo(-HALF - PAD, 5);
    expect(Math.max(...xs)).toBeCloseTo(HALF + PAD, 5);
  });

  it('label rect rotates about the label anchor when label.rotation is non-zero', () => {
    const stUpright = stationWithStop('A', 'L1', { x: 0, y: 0 });
    const stDiag = makeStation({
      id: 'A',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [makeStop('L1', { row: 0, col: 0 })],
      label: { row: 0, col: -1, rotation: 1, offset: 0, align: 'auto', valign: 'middle' }, // 45°
    });
    const upright = stationBoundaryRectsLocal(stUpright).label;
    const diag = stationBoundaryRectsLocal(stDiag).label;
    expect(upright).toBeDefined();
    expect(diag).toBeDefined();
    // The 45° label should not have axis-aligned vertices.
    const isAxisAligned = (poly: { x: number; y: number }[]) => {
      const xs = new Set(poly.map((p) => Math.round(p.x * 100) / 100));
      const ys = new Set(poly.map((p) => Math.round(p.y * 100) / 100));
      return xs.size === 2 && ys.size === 2;
    };
    expect(isAxisAligned(upright!)).toBe(true);
    expect(isAxisAligned(diag!)).toBe(false);
  });
});

describe('stationLocalToWorld', () => {
  it('translates by station.x/y when rotation is 0', () => {
    const st = makeStation({ id: 'A', x: 100, y: 50, rotation: 0 });
    expect(stationLocalToWorld(st, { x: 5, y: 7 })).toEqual({ x: 105, y: 57 });
  });

  it('rotates about station origin then translates for rotation=2 (90°)', () => {
    // Rotation index 2 = 90° clockwise (rotation*45° = 90°).
    const st = makeStation({ id: 'A', x: 0, y: 0, rotation: 2 });
    const out = stationLocalToWorld(st, { x: 10, y: 0 });
    expect(out.x).toBeCloseTo(0, 5);
    expect(out.y).toBeCloseTo(10, 5);
  });

  it('combines rotation and translation', () => {
    const st = makeStation({ id: 'A', x: 100, y: 50, rotation: 2 });
    const out = stationLocalToWorld(st, { x: 10, y: 0 });
    expect(out.x).toBeCloseTo(100, 5);
    expect(out.y).toBeCloseTo(60, 5);
  });
});

describe('stationsForRect', () => {
  it('returns ids of stations whose boundary overlaps the rect', () => {
    const a = stationWithStop('A', 'L1', { x: 0, y: 0 });
    const b = stationWithStop('B', 'L1', { x: 1000, y: 1000 });
    const stations = { A: a, B: b };
    const rect = { x0: -100, y0: -100, x1: 100, y1: 100 };
    expect(stationsForRect(stations, rect)).toEqual(['A']);
  });

  it('detects a station via its label rect when the marquee misses the cells rect', () => {
    // A long name so the painted label polygon (anchored left of the stop)
    // reaches well past the cells AABB — otherwise a rect over "the label" also
    // overlaps the cells rect, the cells branch fires first, and the label
    // branch in stationsForRect never runs. (Station at origin, rotation 0, so
    // local coords == world coords.)
    const st = { ...stationWithStop('A', 'L1', { x: 0, y: 0 }), name: 'Kongens Nytorv Station' };
    const stations = { A: st };
    const rects = stationBoundaryRectsLocal(st);
    const cellsMinX = Math.min(...rects.cells.map((p) => p.x));
    const labelMinX = Math.min(...rects.label!.map((p) => p.x));
    // Precondition: the label really does extend left of the cells rect.
    expect(labelMinX).toBeLessThan(cellsMinX);
    // A marquee entirely left of the cells rect but over the label's far end.
    const rect = { x0: labelMinX + 5, y0: -8, x1: cellsMinX - 5, y1: 8 };
    // It genuinely misses the cells rect — so a hit can ONLY come from the
    // label branch.
    expect(rectIntersectsPolygon(rect, rects.cells)).toBe(false);
    expect(stationsForRect(stations, rect)).toEqual(['A']);
  });

  it('returns empty when no station overlaps', () => {
    const a = stationWithStop('A', 'L1', { x: 0, y: 0 });
    const stations = { A: a };
    const rect = { x0: 1000, y0: 1000, x1: 2000, y1: 2000 };
    expect(stationsForRect(stations, rect)).toEqual([]);
  });

  it('excludes locked stations from marquee selection', () => {
    const a = { ...stationWithStop('A', 'L1', { x: 0, y: 0 }), locked: true };
    const b = stationWithStop('B', 'L1', { x: 10, y: 10 });
    const stations = { A: a, B: b };
    const rect = { x0: -100, y0: -100, x1: 100, y1: 100 };
    expect(stationsForRect(stations, rect)).toEqual(['B']);
  });

  it('includes locked stations when includeLocked is set (alt-marquee recovery)', () => {
    const a = { ...stationWithStop('A', 'L1', { x: 0, y: 0 }), locked: true };
    const stations = { A: a };
    const rect = { x0: -100, y0: -100, x1: 100, y1: 100 };
    expect(stationsForRect(stations, rect, undefined, undefined, true)).toEqual(['A']);
  });

  it('a waypoint station does NOT match a rect that only overlaps where the label would be', () => {
    // A rect just left of the origin — where a regular station's label cell
    // sits — should miss a waypoint, because a waypoint has no label polygon
    // and its cells AABB is tight to the stop only.
    const st = makeStation({
      id: 'A',
      isWaypoint: true,
      stops: [makeStop('L1', { row: 0, col: 0 })],
    });
    const stations = { A: st };
    const rect = { x0: -30, y0: -7, x1: -10, y1: 7 };
    expect(stationsForRect(stations, rect)).toEqual([]);
  });
});

describe('routeBulletsForRect', () => {
  it('returns ids of bullets whose square footprint overlaps the rect', () => {
    const b1 = makeBullet('b1', 0, 0, 12);
    const b2 = makeBullet('b2', 1000, 1000, 12);
    const bullets = { b1, b2 };
    const rect = { x0: -50, y0: -50, x1: 50, y1: 50 };
    expect(routeBulletsForRect(bullets, rect)).toEqual(['b1']);
  });

  it('detects a bullet whose footprint just barely intrudes the rect', () => {
    // Bullet centered at (60, 0) with size 12 → footprint x ∈ [48, 72].
    // Rect x ∈ [50, 70] → footprint overlaps in [50, 70]. Should hit.
    const b = makeBullet('b', 60, 0, 12);
    const rect = { x0: 50, y0: -10, x1: 70, y1: 10 };
    expect(routeBulletsForRect({ b }, rect)).toEqual(['b']);
  });

  it('returns empty when bullets are entirely outside the rect', () => {
    const b = makeBullet('b', 100, 100, 12);
    const rect = { x0: -10, y0: -10, x1: 10, y1: 10 };
    expect(routeBulletsForRect({ b }, rect)).toEqual([]);
  });

  it('handles inverted rect coords (negative width/height)', () => {
    const b = makeBullet('b', 0, 0, 12);
    // Rect from (50, 50) to (-50, -50) — same area, inverted endpoints.
    const rect = { x0: 50, y0: 50, x1: -50, y1: -50 };
    expect(routeBulletsForRect({ b }, rect)).toEqual(['b']);
  });

  it('excludes locked bullets from marquee selection', () => {
    const bullets = {
      a: { ...makeBullet('a', 0, 0, 12), locked: true },
      b: makeBullet('b', 0, 0, 12),
    };
    const rect = { x0: -50, y0: -50, x1: 50, y1: 50 };
    expect(routeBulletsForRect(bullets, rect)).toEqual(['b']);
  });

  it('includes locked bullets when includeLocked is set (alt-marquee recovery)', () => {
    const bullets = { a: { ...makeBullet('a', 0, 0, 12), locked: true } };
    const rect = { x0: -50, y0: -50, x1: 50, y1: 50 };
    expect(routeBulletsForRect(bullets, rect, true)).toEqual(['a']);
  });
});

describe('textLabelHitPolygon', () => {
  it('returns 4 corners', () => {
    const poly = textLabelHitPolygon(makeTextLabel({ id: 'g', text: 'Hi', fontSize: 16 }));
    expect(poly).toHaveLength(4);
  });

  it('unrotated polygon is axis-aligned', () => {
    const poly = textLabelHitPolygon(
      makeTextLabel({ id: 'g', text: 'Hi', fontSize: 16, rotation: 0 }),
    );
    const xs = new Set(poly.map((p) => Math.round(p.x * 100) / 100));
    const ys = new Set(poly.map((p) => Math.round(p.y * 100) / 100));
    expect(xs.size).toBe(2);
    expect(ys.size).toBe(2);
  });

  it('rotation=1 (45°) yields a non-axis-aligned polygon', () => {
    const poly = textLabelHitPolygon(
      makeTextLabel({ id: 'g', text: 'Hi', fontSize: 16, rotation: 1 }),
    );
    const xs = new Set(poly.map((p) => Math.round(p.x * 100) / 100));
    expect(xs.size).toBeGreaterThan(2);
  });

  it('translates polygon by the label x/y', () => {
    const at0 = textLabelHitPolygon(makeTextLabel({ id: 'g', text: 'Hi', x: 0, y: 0 }));
    const at100 = textLabelHitPolygon(makeTextLabel({ id: 'g', text: 'Hi', x: 100, y: 50 }));
    for (let i = 0; i < 4; i++) {
      expect(at100[i].x - at0[i].x).toBeCloseTo(100, 5);
      expect(at100[i].y - at0[i].y).toBeCloseTo(50, 5);
    }
  });
});

describe('textLabelsForRect', () => {
  it('returns the label ids whose hit polygon overlaps the rect', () => {
    const labels = {
      a: makeTextLabel({ id: 'a', x: 0, y: 0, text: 'Hello' }),
      b: makeTextLabel({ id: 'b', x: 1000, y: 1000, text: 'Hello' }),
    };
    const rect = { x0: -50, y0: -50, x1: 50, y1: 50 };
    expect(textLabelsForRect(labels, rect)).toEqual(['a']);
  });

  it('returns empty when no label intersects', () => {
    const labels = { a: makeTextLabel({ id: 'a', x: 0, y: 0, text: 'Hello' }) };
    const rect = { x0: 1000, y0: 1000, x1: 2000, y1: 2000 };
    expect(textLabelsForRect(labels, rect)).toEqual([]);
  });

  it('handles inverted rect endpoints', () => {
    const labels = { a: makeTextLabel({ id: 'a', x: 0, y: 0, text: 'Hi' }) };
    const rect = { x0: 50, y0: 50, x1: -50, y1: -50 };
    expect(textLabelsForRect(labels, rect)).toEqual(['a']);
  });

  it('hits a rotated label whose corners enter the rect after rotation', () => {
    // Wide label at the origin, rotated 90°. Rect placed where one of the
    // rotated corners lands should pick it up.
    const label = makeTextLabel({
      id: 'a',
      x: 0,
      y: 0,
      text: 'AAAAAAAAAAAAAAAA',
      fontSize: 40,
      rotation: 2, // 90°
    });
    // After 90° rotation, the wide bbox extends vertically; check a small
    // rect above the origin sees it.
    const rect = { x0: -10, y0: 60, x1: 10, y1: 100 };
    expect(textLabelsForRect({ a: label }, rect)).toEqual(['a']);
  });

  it('still hits an empty-text label via its hit padding', () => {
    const labels = { a: makeTextLabel({ id: 'a', x: 0, y: 0, text: '', fontSize: 16 }) };
    const rect = { x0: -2, y0: -2, x1: 2, y1: 2 };
    expect(textLabelsForRect(labels, rect)).toEqual(['a']);
  });

  it('excludes locked labels from marquee selection', () => {
    const labels = {
      a: makeTextLabel({ id: 'a', x: 0, y: 0, text: 'Hello', locked: true }),
      b: makeTextLabel({ id: 'b', x: 0, y: 0, text: 'Hello' }),
    };
    const rect = { x0: -50, y0: -50, x1: 50, y1: 50 };
    expect(textLabelsForRect(labels, rect)).toEqual(['b']);
  });

  it('includes locked labels when includeLocked is set (alt-marquee recovery)', () => {
    const labels = { a: makeTextLabel({ id: 'a', x: 0, y: 0, text: 'Hello', locked: true }) };
    const rect = { x0: -50, y0: -50, x1: 50, y1: 50 };
    expect(textLabelsForRect(labels, rect, true)).toEqual(['a']);
  });
});

describe('polygonsForRect', () => {
  // makePolygon's default square spans (-30,-30)..(30,30).
  it('returns polygons whose body overlaps the rect', () => {
    const polygons = {
      a: makePolygon({ id: 'a' }),
      b: makePolygon({
        id: 'b',
        vertices: [
          { x: 970, y: 970 },
          { x: 1030, y: 970 },
          { x: 1030, y: 1030 },
          { x: 970, y: 1030 },
        ],
      }),
    };
    const rect = { x0: -50, y0: -50, x1: 50, y1: 50 };
    expect(polygonsForRect(polygons, rect)).toEqual(['a']);
  });

  it('excludes locked polygons from marquee selection', () => {
    const polygons = {
      a: makePolygon({ id: 'a', locked: true }),
      b: makePolygon({ id: 'b' }),
    };
    const rect = { x0: -50, y0: -50, x1: 50, y1: 50 };
    expect(polygonsForRect(polygons, rect)).toEqual(['b']);
  });

  it('includes locked polygons when includeLocked is set (alt-marquee recovery)', () => {
    const polygons = { a: makePolygon({ id: 'a', locked: true }) };
    const rect = { x0: -50, y0: -50, x1: 50, y1: 50 };
    expect(polygonsForRect(polygons, rect, true)).toEqual(['a']);
  });

  it('selects an open polygon via its stroke chain only, never its empty interior', () => {
    const big = [
      { x: -100, y: -100 },
      { x: 100, y: -100 },
      { x: 100, y: 100 },
      { x: -100, y: 100 },
    ];
    const polygons = {
      open: makePolygon({ id: 'open', vertices: big, closed: false }),
      solid: makePolygon({ id: 'solid', vertices: big }),
    };
    // A marquee fully inside the vertex loop: the filled polygon hits, the
    // open one (no interior) does not.
    expect(polygonsForRect(polygons, { x0: -10, y0: -10, x1: 10, y1: 10 })).toEqual(['solid']);
    // A marquee straddling the top edge (not the closing edge) hits both.
    expect(polygonsForRect(polygons, { x0: -10, y0: -110, x1: 10, y1: -90 })).toEqual([
      'open',
      'solid',
    ]);
  });
});
