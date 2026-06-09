import { describe, it, expect } from 'vitest';
import {
  addPolygon,
  setPolygonVertices,
  moveVertex,
  insertVertex,
  deleteVertex,
  updatePolygon,
  rotatePolygon,
  deletePolygon,
  buildRotateMembers,
  rotateItemsAround,
  movePolygonUp,
  movePolygonDown,
  effectivePolygonOrder,
  resolvePolygonColors,
  POLYGON_STROKE_WIDTH_MIN,
  POLYGON_STROKE_WIDTH_MAX,
  POLYGON_FILL_OPACITY_MIN,
  POLYGON_FILL_OPACITY_MAX,
  POLYGON_CURVE_RADIUS_MIN,
} from './transforms';
import { makeDoc, makePolygon } from '../test/fixtures';

describe('polygon transforms', () => {
  it('addPolygon creates a square centered at (x, y) with default style', () => {
    const doc = addPolygon(makeDoc({}), 'p0', 100, 50);
    const poly = doc.polygons['p0'];
    expect(poly.vertices).toHaveLength(4);
    // Centroid is the click point.
    const cx = poly.vertices.reduce((s, v) => s + v.x, 0) / 4;
    const cy = poly.vertices.reduce((s, v) => s + v.y, 0) / 4;
    expect(cx).toBeCloseTo(100, 6);
    expect(cy).toBeCloseTo(50, 6);
    // Axis-aligned square: two distinct x's and two distinct y's.
    expect(new Set(poly.vertices.map((v) => v.x)).size).toBe(2);
    expect(new Set(poly.vertices.map((v) => v.y)).size).toBe(2);
    expect(poly.strokeWidth).toBeGreaterThanOrEqual(POLYGON_STROKE_WIDTH_MIN);
    expect(poly.strokeWidth).toBeLessThanOrEqual(POLYGON_STROKE_WIDTH_MAX);
    expect(poly.fill).toMatch(/^#/);
    expect(poly.stroke).toMatch(/^#/);
  });

  it('setPolygonVertices replaces the vertex list', () => {
    const doc = makeDoc({ polygons: [makePolygon({ id: 'p0' })] });
    const next = setPolygonVertices(doc, 'p0', [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 8 },
    ]);
    expect(next.polygons['p0'].vertices).toHaveLength(3);
    expect(next.polygons['p0'].vertices[1]).toEqual({ x: 10, y: 0 });
  });

  it('moveVertex moves a single vertex by index', () => {
    const doc = makeDoc({ polygons: [makePolygon({ id: 'p0' })] });
    const next = moveVertex(doc, 'p0', 2, 99, -7);
    expect(next.polygons['p0'].vertices[2]).toEqual({ x: 99, y: -7 });
    // Others untouched.
    expect(next.polygons['p0'].vertices[0]).toEqual(doc.polygons['p0'].vertices[0]);
  });

  it('insertVertex adds the edge midpoint after edgeIndex (and wraps last->first)', () => {
    const doc = makeDoc({ polygons: [makePolygon({ id: 'p0' })] });
    // Edge 0 -> 1 of the default square: (-30,-30) -> (30,-30), midpoint (0,-30).
    const a = insertVertex(doc, 'p0', 0);
    expect(a.polygons['p0'].vertices).toHaveLength(5);
    expect(a.polygons['p0'].vertices[1]).toEqual({ x: 0, y: -30 });
    // Last edge wraps: (-30,30) -> (-30,-30), midpoint (-30,0), appended at end.
    const b = insertVertex(doc, 'p0', 3);
    expect(b.polygons['p0'].vertices).toHaveLength(5);
    expect(b.polygons['p0'].vertices[4]).toEqual({ x: -30, y: 0 });
  });

  it('deleteVertex removes a vertex but is a no-op at the 3-vertex floor', () => {
    const square = makeDoc({ polygons: [makePolygon({ id: 'p0' })] });
    const tri = deleteVertex(square, 'p0', 1);
    expect(tri.polygons['p0'].vertices).toHaveLength(3);
    // Deleting again would degenerate the polygon -> no-op.
    const stillTri = deleteVertex(tri, 'p0', 0);
    expect(stillTri.polygons['p0'].vertices).toHaveLength(3);
    expect(stillTri).toBe(tri); // unchanged reference
  });

  it('updatePolygon patches style and clamps strokeWidth at MIN only (textbox accepts arbitrary above)', () => {
    const doc = makeDoc({ polygons: [makePolygon({ id: 'p0' })] });
    const a = updatePolygon(doc, 'p0', { fill: '#ff0000', stroke: '#00ff00', strokeWidth: 4 });
    expect(a.polygons['p0'].fill).toBe('#ff0000');
    expect(a.polygons['p0'].stroke).toBe('#00ff00');
    expect(a.polygons['p0'].strokeWidth).toBe(4);
    expect(updatePolygon(doc, 'p0', { strokeWidth: 999 }).polygons['p0'].strokeWidth).toBe(999);
    expect(updatePolygon(doc, 'p0', { strokeWidth: -5 }).polygons['p0'].strokeWidth).toBe(
      POLYGON_STROKE_WIDTH_MIN,
    );
  });

  it('rotatePolygon rotates vertices 45° clockwise about the centroid', () => {
    // Square centered at origin -> rotates into a diamond.
    const doc = makeDoc({ polygons: [makePolygon({ id: 'p0' })] });
    const next = rotatePolygon(doc, 'p0');
    const r = 30 * Math.SQRT2; // half-diagonal
    // Top-left (-30,-30) orbits to the top of the diamond (0, -r).
    expect(next.polygons['p0'].vertices[0].x).toBeCloseTo(0, 6);
    expect(next.polygons['p0'].vertices[0].y).toBeCloseTo(-r, 6);
    // Centroid is preserved.
    const cy = next.polygons['p0'].vertices.reduce((s, v) => s + v.y, 0) / 4;
    expect(cy).toBeCloseTo(0, 6);
  });

  it('deletePolygon removes the polygon and its entry in polygonOrder', () => {
    const doc = makeDoc({ polygons: [makePolygon({ id: 'p0' }), makePolygon({ id: 'p1' })] });
    const next = deletePolygon(doc, 'p0');
    expect(next.polygons['p0']).toBeUndefined();
    expect(next.polygons['p1']).toBeDefined();
    expect(next.polygonOrder).toEqual(['p1']);
  });

  it('updatePolygon sets + clamps fillOpacity and toggles locked', () => {
    const doc = makeDoc({ polygons: [makePolygon({ id: 'p0' })] });
    expect(updatePolygon(doc, 'p0', { fillOpacity: 40 }).polygons['p0'].fillOpacity).toBe(40);
    expect(updatePolygon(doc, 'p0', { fillOpacity: 999 }).polygons['p0'].fillOpacity).toBe(
      POLYGON_FILL_OPACITY_MAX,
    );
    expect(updatePolygon(doc, 'p0', { fillOpacity: -5 }).polygons['p0'].fillOpacity).toBe(
      POLYGON_FILL_OPACITY_MIN,
    );
    expect(updatePolygon(doc, 'p0', { locked: true }).polygons['p0'].locked).toBe(true);
  });

  it('updatePolygon toggles closed; addPolygon leaves it unset (closed by default)', () => {
    const doc = makeDoc({ polygons: [makePolygon({ id: 'p0' })] });
    expect(updatePolygon(doc, 'p0', { closed: false }).polygons['p0'].closed).toBe(false);
    const reopened = updatePolygon(updatePolygon(doc, 'p0', { closed: false }), 'p0', {
      closed: true,
    });
    expect(reopened.polygons['p0'].closed).toBe(true);
    // New polygons omit the field — missing ⇒ closed, like legacy saves.
    expect(addPolygon(makeDoc({}), 'p1', 0, 0).polygons['p1'].closed).toBeUndefined();
  });

  it('updatePolygon sets curveRadius, clamping at MIN only, without disturbing other fields', () => {
    const doc = makeDoc({ polygons: [makePolygon({ id: 'p0', strokeWidth: 3 })] });
    expect(updatePolygon(doc, 'p0', { curveRadius: 20 }).polygons['p0'].curveRadius).toBe(20);
    // Above the slider max is allowed (the renderer caps the effective radius
    // per-corner at half the shorter adjacent edge).
    expect(updatePolygon(doc, 'p0', { curveRadius: 999 }).polygons['p0'].curveRadius).toBe(999);
    expect(updatePolygon(doc, 'p0', { curveRadius: -5 }).polygons['p0'].curveRadius).toBe(
      POLYGON_CURVE_RADIUS_MIN,
    );
    const next = updatePolygon(doc, 'p0', { curveRadius: 12 });
    expect(next.polygons['p0'].vertices).toEqual(doc.polygons['p0'].vertices);
    expect(next.polygons['p0'].strokeWidth).toBe(3);
  });

  it('updatePolygon sets the dark-mode fill and stroke independently of the light colors', () => {
    const doc = makeDoc({
      polygons: [makePolygon({ id: 'p0', fill: '#112233', stroke: '#445566' })],
    });
    const next = updatePolygon(doc, 'p0', { darkFill: '#101010', darkStroke: '#202020' });
    expect(next.polygons['p0'].darkFill).toBe('#101010');
    expect(next.polygons['p0'].darkStroke).toBe('#202020');
    // Light colors untouched.
    expect(next.polygons['p0'].fill).toBe('#112233');
    expect(next.polygons['p0'].stroke).toBe('#445566');
  });

  it('addPolygon initializes the dark colors equal to the light colors', () => {
    const p = addPolygon(makeDoc({}), 'p0', 0, 0).polygons['p0'];
    expect(p.darkFill).toBe(p.fill);
    expect(p.darkStroke).toBe(p.stroke);
  });

  it('changing a light color leaves the dark color untouched — they are independent', () => {
    const doc = addPolygon(makeDoc({}), 'p0', 0, 0);
    const original = doc.polygons['p0'];
    const next = updatePolygon(doc, 'p0', { fill: '#ff0000', stroke: '#00ff00' });
    // Light colors update as asked...
    expect(next.polygons['p0'].fill).toBe('#ff0000');
    expect(next.polygons['p0'].stroke).toBe('#00ff00');
    // ...and the dark colors keep their creation values rather than tracking
    // the light ones.
    expect(next.polygons['p0'].darkFill).toBe(original.darkFill);
    expect(next.polygons['p0'].darkStroke).toBe(original.darkStroke);
    expect(resolvePolygonColors(next.polygons['p0'], true)).toEqual({
      fill: original.fill,
      stroke: original.stroke,
    });
  });

  it('addPolygon appends to polygonOrder; move up/down reorders (later = on top)', () => {
    let doc = makeDoc({});
    doc = addPolygon(doc, 'a', 0, 0);
    doc = addPolygon(doc, 'b', 0, 0);
    doc = addPolygon(doc, 'c', 0, 0);
    expect(doc.polygonOrder).toEqual(['a', 'b', 'c']); // c on top

    doc = movePolygonUp(doc, 'a'); // a moves toward top
    expect(doc.polygonOrder).toEqual(['b', 'a', 'c']);

    doc = movePolygonDown(doc, 'c'); // c moves toward bottom
    expect(doc.polygonOrder).toEqual(['b', 'c', 'a']);

    // No-ops at the ends.
    expect(movePolygonUp(doc, 'a').polygonOrder).toEqual(['b', 'c', 'a']); // 'a' already top
    expect(movePolygonDown(doc, 'b').polygonOrder).toEqual(['b', 'c', 'a']); // 'b' already bottom
  });

  it('effectivePolygonOrder backfills ids missing from a legacy/partial order', () => {
    const polys = {
      p0: makePolygon({ id: 'p0' }),
      p1: makePolygon({ id: 'p1' }),
      p2: makePolygon({ id: 'p2' }),
    };
    // Stored order omits p2 (legacy) and references a stale id.
    expect(effectivePolygonOrder(polys, ['p1', 'gone', 'p0'])).toEqual(['p1', 'p0', 'p2']);
  });

  describe('resolvePolygonColors', () => {
    it('returns the light fill/stroke in light mode, ignoring any dark overrides', () => {
      const poly = makePolygon({
        id: 'p0',
        fill: '#aaaaaa',
        stroke: '#bbbbbb',
        darkFill: '#111111',
        darkStroke: '#222222',
      });
      expect(resolvePolygonColors(poly, false)).toEqual({ fill: '#aaaaaa', stroke: '#bbbbbb' });
    });

    it('returns the dark overrides in dark mode when present', () => {
      const poly = makePolygon({
        id: 'p0',
        fill: '#aaaaaa',
        stroke: '#bbbbbb',
        darkFill: '#111111',
        darkStroke: '#222222',
      });
      expect(resolvePolygonColors(poly, true)).toEqual({ fill: '#111111', stroke: '#222222' });
    });

    it('returns the light colors in dark mode when the dark colors equal them (uncustomized)', () => {
      const poly = makePolygon({ id: 'p0', fill: '#aaaaaa', stroke: '#bbbbbb' });
      expect(resolvePolygonColors(poly, true)).toEqual({ fill: '#aaaaaa', stroke: '#bbbbbb' });
    });
  });

  it('rotateItemsAround orbits polygon members and supports a polygon pivot', () => {
    // Pivot polygon centered at origin; member polygon centered at (100, 0).
    const pivot = makePolygon({ id: 'p0' });
    const member = makePolygon({
      id: 'p1',
      vertices: [
        { x: 70, y: -30 },
        { x: 130, y: -30 },
        { x: 130, y: 30 },
        { x: 70, y: 30 },
      ],
    });
    const doc = makeDoc({ polygons: [pivot, member] });
    const members = buildRotateMembers([], [], [], ['p0', 'p1']);
    const next = rotateItemsAround(doc, { type: 'polygon', id: 'p0' }, members);
    // Member centroid (100,0) orbits 45° CW about origin -> (70.71, 70.71).
    const c = next.polygons['p1'].vertices.reduce(
      (acc, v) => ({ x: acc.x + v.x / 4, y: acc.y + v.y / 4 }),
      { x: 0, y: 0 },
    );
    expect(c.x).toBeCloseTo(100 * Math.SQRT1_2, 4);
    expect(c.y).toBeCloseTo(100 * Math.SQRT1_2, 4);
  });
});
