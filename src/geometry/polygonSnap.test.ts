import { describe, it, expect } from 'vitest';
import { polygonSnapAnchor, polygonCentroid } from './polygon';
import { snapPolygonPoint } from './polygonSnap';
import { DEFAULT_SNAP_MODES, type SnapModes } from './snap';

const modes = (partial: Partial<SnapModes>): SnapModes => ({ ...DEFAULT_SNAP_MODES, ...partial });

describe('polygon geometry helpers', () => {
  it('polygonSnapAnchor picks the highest, then leftmost vertex', () => {
    const verts = [
      { x: 10, y: 5 },
      { x: -3, y: 0 }, // highest (min y)
      { x: -8, y: 0 }, // also highest, more left -> wins the tie
      { x: 4, y: 9 },
    ];
    expect(polygonSnapAnchor(verts)).toEqual({ x: -8, y: 0 });
  });

  it('polygonCentroid averages the vertices', () => {
    expect(
      polygonCentroid([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ]),
    ).toEqual({ x: 5, y: 5 });
  });
});

describe('snapPolygonPoint', () => {
  const noTargets = { lineTargets: [], allTargets: [] };

  it('grid mode snaps to the nearest grid intersection', () => {
    const r = snapPolygonPoint({
      proposed: { x: 12, y: 23 },
      ...noTargets,
      modes: modes({ grid: 'both' }),
    });
    expect(r).toMatchObject({ x: 10, y: 20 });
    expect(r.guides).toHaveLength(0);
  });

  it('grid horizontal/vertical lock only one axis', () => {
    expect(
      snapPolygonPoint({
        proposed: { x: 12, y: 23 },
        ...noTargets,
        modes: modes({ grid: 'horizontal' }),
      }),
    ).toMatchObject({ x: 12, y: 20 });
    expect(
      snapPolygonPoint({
        proposed: { x: 12, y: 23 },
        ...noTargets,
        modes: modes({ grid: 'vertical' }),
      }),
    ).toMatchObject({ x: 10, y: 23 });
  });

  it('line mode aligns vertically to a sibling vertex (snaps x) and emits a guide', () => {
    const r = snapPolygonPoint({
      proposed: { x: 102, y: 50 },
      lineTargets: [{ x: 100, y: 0 }],
      allTargets: [],
      modes: modes({ line: true, all: 'off', grid: 'off' }),
    });
    expect(r.x).toBeCloseTo(100, 6);
    expect(r.y).toBeCloseTo(50, 6); // y free
    expect(r.guides.length).toBeGreaterThanOrEqual(1);
  });

  it('line mode aligns diagonally to a sibling vertex', () => {
    // Target at origin; proposed near the +45° (y=x) line through it.
    const r = snapPolygonPoint({
      proposed: { x: 40, y: 44 },
      lineTargets: [{ x: 0, y: 0 }],
      allTargets: [],
      modes: modes({ line: true, all: 'off', grid: 'off' }),
    });
    // Projects onto y = x -> both coords meet near 42.
    expect(r.x).toBeCloseTo(42, 6);
    expect(r.y).toBeCloseTo(42, 6);
    expect(r.guides.length).toBeGreaterThanOrEqual(1);
  });

  it('line mode ignores allTargets (only the current polygon snaps)', () => {
    const r = snapPolygonPoint({
      proposed: { x: 102, y: 50 },
      lineTargets: [],
      allTargets: [{ x: 100, y: 0 }], // a station, but "line" must not see it
      modes: modes({ line: true, all: 'off', grid: 'off' }),
    });
    expect(r.x).toBeCloseTo(102, 6); // unchanged
    expect(r.guides).toHaveLength(0);
  });

  it('all mode snaps to a station stop-center and honors the direction sub-setting', () => {
    // 'vertical' direction => only X may align.
    const r = snapPolygonPoint({
      proposed: { x: 203, y: 80 },
      lineTargets: [],
      allTargets: [{ x: 200, y: 0 }],
      modes: modes({ line: false, all: 'vertical', grid: 'off' }),
    });
    expect(r.x).toBeCloseTo(200, 6);
    expect(r.y).toBeCloseTo(80, 6); // horizontal not allowed
    expect(r.guides.length).toBeGreaterThanOrEqual(1);
  });

  it('all mode includes other polygons vertices', () => {
    const r = snapPolygonPoint({
      proposed: { x: 51, y: 49 },
      lineTargets: [],
      allTargets: [{ x: 50, y: 50 }],
      modes: modes({ line: false, all: 'all', grid: 'off' }),
    });
    expect(r.x).toBeCloseTo(50, 6);
    expect(r.y).toBeCloseTo(50, 6);
  });

  it('corner: vertical + horizontal both engage -> snaps to the intersection', () => {
    const r = snapPolygonPoint({
      proposed: { x: 101, y: 199 },
      lineTargets: [
        { x: 100, y: 0 }, // shares X
        { x: 0, y: 200 }, // shares Y
      ],
      allTargets: [],
      modes: modes({ line: true, all: 'off', grid: 'off' }),
    });
    expect(r.x).toBeCloseTo(100, 6);
    expect(r.y).toBeCloseTo(200, 6);
    expect(r.guides.length).toBe(2);
  });

  it('out of tolerance leaves the point unchanged with no guides', () => {
    // (500, 123) is far from any axis through the two targets (incl. diagonals).
    const r = snapPolygonPoint({
      proposed: { x: 500, y: 123 },
      lineTargets: [{ x: 100, y: 0 }],
      allTargets: [{ x: 0, y: 0 }],
      modes: modes({ line: true, all: 'all', grid: 'off' }),
    });
    expect(r).toMatchObject({ x: 500, y: 123 });
    expect(r.guides).toHaveLength(0);
  });
});
