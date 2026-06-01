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
  POLYGON_STROKE_WIDTH_MIN,
  POLYGON_STROKE_WIDTH_MAX,
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

  it('updatePolygon patches style and clamps strokeWidth to [0, 10]', () => {
    const doc = makeDoc({ polygons: [makePolygon({ id: 'p0' })] });
    const a = updatePolygon(doc, 'p0', { fill: '#ff0000', stroke: '#00ff00', strokeWidth: 4 });
    expect(a.polygons['p0'].fill).toBe('#ff0000');
    expect(a.polygons['p0'].stroke).toBe('#00ff00');
    expect(a.polygons['p0'].strokeWidth).toBe(4);
    expect(updatePolygon(doc, 'p0', { strokeWidth: 999 }).polygons['p0'].strokeWidth).toBe(
      POLYGON_STROKE_WIDTH_MAX,
    );
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

  it('deletePolygon removes the polygon', () => {
    const doc = makeDoc({ polygons: [makePolygon({ id: 'p0' }), makePolygon({ id: 'p1' })] });
    const next = deletePolygon(doc, 'p0');
    expect(next.polygons['p0']).toBeUndefined();
    expect(next.polygons['p1']).toBeDefined();
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
