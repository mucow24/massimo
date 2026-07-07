import { describe, it, expect, beforeEach } from 'vitest';
import { createRef, type RefObject } from 'react';
import { renderHook } from '@testing-library/react';
import { usePolygonDrag } from './usePolygonDrag';
import { useDoc, useSelection, dragState } from '../../state/store';
import { useSnapPrefs } from '../../state/snapPrefs';
import { DEFAULT_DOC } from '../../model/transforms';
import { DEFAULT_SNAP_MODES, type SnapModes } from '../../geometry/snap';
import { makePolygon, makeRouteBullet, makeSvgImage } from '../../test/fixtures';

function pointerEvent(opts: {
  clientX: number;
  clientY: number;
  pointerId?: number;
  shiftKey?: boolean;
  button?: number;
}): React.PointerEvent {
  return {
    clientX: opts.clientX,
    clientY: opts.clientY,
    pointerId: opts.pointerId ?? 1,
    shiftKey: opts.shiftKey ?? false,
    button: opts.button ?? 0,
    stopPropagation: () => {},
  } as unknown as React.PointerEvent;
}

const setModes = (partial: Partial<SnapModes>) =>
  useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES, ...partial } });

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useSelection.setState({
    ...useSelection.getState(),
    selectedPolygonIds: [],
    selectedStationIds: [],
    selectedRouteBulletIds: [],
    selectedLabelIds: [],
    selectedVertex: null,
  });
  setModes({ line: false, all: 'off', grid: 'off' });
  dragState.suppressClick = false;
});

function render(zoom = 1) {
  const svgRef = createRef<SVGSVGElement>() as RefObject<SVGSVGElement | null>;
  return renderHook(() => usePolygonDrag(svgRef, zoom, false)).result;
}

describe('usePolygonDrag — whole-polygon drag', () => {
  it('translates every vertex by the drag delta (shift bypasses snap)', () => {
    useDoc.setState({ ...useDoc.getState(), polygons: { p0: makePolygon({ id: 'p0' }) } });
    const r = render();
    r.current.onPolygonPointerDown('p0', pointerEvent({ clientX: 200, clientY: 200 }));
    r.current.onPointerMove(pointerEvent({ clientX: 210, clientY: 200, shiftKey: true }));
    r.current.onPointerMove(pointerEvent({ clientX: 240, clientY: 200, shiftKey: true }));
    r.current.onPointerUp(pointerEvent({ clientX: 240, clientY: 200 }));

    // Default square centered at origin -> all vertices shift +40 in x.
    const verts = useDoc.getState().polygons['p0'].vertices;
    expect(verts[0]).toEqual({ x: 10, y: -30 });
    expect(verts[2]).toEqual({ x: 70, y: 30 });
  });

  it('grid snap lands the highest-then-leftmost vertex on the grid', () => {
    setModes({ grid: 'both' });
    useDoc.setState({ ...useDoc.getState(), polygons: { p0: makePolygon({ id: 'p0' }) } });
    const r = render();
    // Anchor of the default square is (-30,-30). Move +12/+13 screen -> anchor
    // proposes (-18,-17) -> grid (-20,-20) -> delta (+10,+10).
    r.current.onPolygonPointerDown('p0', pointerEvent({ clientX: 200, clientY: 200 }));
    r.current.onPointerMove(pointerEvent({ clientX: 210, clientY: 200 }));
    r.current.onPointerMove(pointerEvent({ clientX: 212, clientY: 213 }));
    r.current.onPointerUp(pointerEvent({ clientX: 212, clientY: 213 }));

    // Highest-then-leftmost vertex (-30,-30) snaps onto the grid intersection
    // (-20,-20); the whole square shifts by that (+10,+10) delta.
    const verts = useDoc.getState().polygons['p0'].vertices;
    expect(verts[0]).toEqual({ x: -20, y: -20 });
    expect(verts[2]).toEqual({ x: 40, y: 40 });
  });

  it("'Snap to all' aligns the anchor vertex to a route bullet's center", () => {
    setModes({ line: false, all: 'all', grid: 'off' });
    useDoc.setState({
      ...useDoc.getState(),
      polygons: { p0: makePolygon({ id: 'p0' }) },
      routeBullets: { b0: makeRouteBullet({ id: 'b0', x: 100, y: 55 }) },
    });
    const r = render();
    // Anchor of the default square is (-30,-30). Δscreen (127,10) proposes
    // (97,-20): 3 from the bullet's vertical axis x=100 → snaps to (100,-20).
    r.current.onPolygonPointerDown('p0', pointerEvent({ clientX: 200, clientY: 200 }));
    r.current.onPointerMove(pointerEvent({ clientX: 210, clientY: 200 }));
    r.current.onPointerMove(pointerEvent({ clientX: 327, clientY: 210 }));
    r.current.onPointerUp(pointerEvent({ clientX: 327, clientY: 210 }));

    const verts = useDoc.getState().polygons['p0'].vertices;
    expect(verts[0].x).toBeCloseTo(100, 6);
    expect(verts[0].y).toBeCloseTo(-20, 6);
    expect(verts[2].x).toBeCloseTo(160, 6);
    expect(verts[2].y).toBeCloseTo(40, 6);
  });

  it('a group-drag master aligns to STATIONARY targets but never to co-selected siblings', () => {
    setModes({ line: false, all: 'all', grid: 'off' });
    useDoc.setState({
      ...useDoc.getState(),
      polygons: {
        p0: makePolygon({ id: 'p0' }),
        // Co-selected sibling with a vertex CLOSER to the drop than the bullet:
        // if the exclusion is missing, x snaps to 95 instead of 100.
        p1: makePolygon({ id: 'p1', vertices: [{ x: 95, y: -200 }] }),
      },
      polygonOrder: ['p0', 'p1'],
      routeBullets: { b0: makeRouteBullet({ id: 'b0', x: 100, y: 55 }) },
    });
    useSelection.setState({ ...useSelection.getState(), selectedPolygonIds: ['p0', 'p1'] });
    const r = render();
    // Δscreen (127,10) proposes the anchor at (97,-20): 3 from the stationary
    // bullet's vertical axis x=100, 2 from co-selected p1's vertex axis x=95.
    r.current.onPolygonPointerDown('p0', pointerEvent({ clientX: 200, clientY: 200 }));
    r.current.onPointerMove(pointerEvent({ clientX: 210, clientY: 200 }));
    r.current.onPointerMove(pointerEvent({ clientX: 327, clientY: 210 }));
    r.current.onPointerUp(pointerEvent({ clientX: 327, clientY: 210 }));

    const doc = useDoc.getState();
    expect(doc.polygons['p0'].vertices[0].x).toBeCloseTo(100, 6);
    expect(doc.polygons['p0'].vertices[0].y).toBeCloseTo(-20, 6);
    // The towed sibling translates by the post-snap delta (130, 10).
    expect(doc.polygons['p1'].vertices[0].x).toBeCloseTo(225, 6);
    expect(doc.polygons['p1'].vertices[0].y).toBeCloseTo(-190, 6);
  });

  it('a click (no movement past threshold) cancels the history group, leaving vertices put', () => {
    useDoc.setState({ ...useDoc.getState(), polygons: { p0: makePolygon({ id: 'p0' }) } });
    const r = render();
    r.current.onPolygonPointerDown('p0', pointerEvent({ clientX: 200, clientY: 200 }));
    r.current.onPointerMove(pointerEvent({ clientX: 202, clientY: 201 })); // < 4px
    r.current.onPointerUp(pointerEvent({ clientX: 202, clientY: 201 }));
    expect(useDoc.getState().polygons['p0'].vertices[0]).toEqual({ x: -30, y: -30 });
  });
});

describe('usePolygonDrag — vertex drag', () => {
  it("'Snap to all' aligns the dragged vertex to an svg image corner", () => {
    setModes({ line: false, all: 'all', grid: 'off' });
    useDoc.setState({
      ...useDoc.getState(),
      polygons: {
        p0: makePolygon({
          id: 'p0',
          vertices: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 50, y: 80 },
          ],
        }),
      },
      svgImages: { i0: makeSvgImage({ id: 'i0', x: 200, y: 100 }) },
      svgImageOrder: ['i0'],
    });
    const r = render();
    // Image corners at (150,70)/(250,70)/(250,130)/(150,130). Δscreen (103,35)
    // proposes the apex at (153,115): 3 from the corners' vertical axis x=150.
    r.current.onVertexPointerDown('p0', 2, pointerEvent({ clientX: 200, clientY: 200 }));
    r.current.onPointerMove(pointerEvent({ clientX: 210, clientY: 200 }));
    r.current.onPointerMove(pointerEvent({ clientX: 303, clientY: 235 }));
    r.current.onPointerUp(pointerEvent({ clientX: 303, clientY: 235 }));

    const verts = useDoc.getState().polygons['p0'].vertices;
    expect(verts[2].x).toBeCloseTo(150, 6);
    expect(verts[2].y).toBeCloseTo(115, 6);
  });

  it('moves only the grabbed vertex and "Snap to line" aligns it to a sibling vertex', () => {
    setModes({ line: true, all: 'off', grid: 'off' });
    // Triangle: apex at (50,80); base corners at (0,0) and (100,0).
    useDoc.setState({
      ...useDoc.getState(),
      polygons: {
        p0: makePolygon({
          id: 'p0',
          vertices: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 50, y: 80 },
          ],
        }),
      },
    });
    useSelection.setState({ ...useSelection.getState(), selectedPolygonIds: ['p0'] });
    const r = render();
    // Drag apex (index 2) left toward x=0 (aligns vertically with vertex 0).
    r.current.onVertexPointerDown('p0', 2, pointerEvent({ clientX: 200, clientY: 200 }));
    r.current.onPointerMove(pointerEvent({ clientX: 190, clientY: 200 }));
    r.current.onPointerMove(pointerEvent({ clientX: 153, clientY: 205 })); // dx -47, dy +5 -> (3,85)
    r.current.onPointerUp(pointerEvent({ clientX: 153, clientY: 205 }));

    const verts = useDoc.getState().polygons['p0'].vertices;
    expect(verts[2].x).toBeCloseTo(0, 6); // snapped to vertex 0's x
    expect(verts[2].y).toBeCloseTo(85, 6); // y free
    // Base corners untouched.
    expect(verts[0]).toEqual({ x: 0, y: 0 });
    expect(verts[1]).toEqual({ x: 100, y: 0 });
  });

  it('snap engages within a constant SCREEN distance — zooming in shrinks the world radius', () => {
    setModes({ line: true, all: 'off', grid: 'off' });
    // Triangle: apex at (50,80); base corners at (0,0) and (100,0). The apex's
    // X can snap onto vertex 0's x=0. We drag the apex to the SAME world point
    // (7, 80) at two zooms; 7 world units off the axis.
    const seed = () =>
      useDoc.setState({
        ...useDoc.getState(),
        polygons: {
          p0: makePolygon({
            id: 'p0',
            vertices: [
              { x: 0, y: 0 },
              { x: 100, y: 0 },
              { x: 50, y: 80 },
            ],
          }),
        },
      });

    // Zoom 1: 7 ≤ 10px radius → snaps to x=0 (baseline, unchanged by this work).
    seed();
    const r1 = render(1);
    r1.current.onVertexPointerDown('p0', 2, pointerEvent({ clientX: 200, clientY: 200 }));
    r1.current.onPointerMove(pointerEvent({ clientX: 157, clientY: 200 })); // dx -43 → world (7,80)
    r1.current.onPointerUp(pointerEvent({ clientX: 157, clientY: 200 }));
    expect(useDoc.getState().polygons['p0'].vertices[2].x).toBeCloseTo(0, 6);

    // Zoom 2: same world point (7,80), but the screen radius is now 10px / 2 = 5
    // world units. 7 > 5 → no snap; the vertex stays at x=7.
    seed();
    const r2 = render(2);
    r2.current.onVertexPointerDown('p0', 2, pointerEvent({ clientX: 200, clientY: 200 }));
    r2.current.onPointerMove(pointerEvent({ clientX: 114, clientY: 200 })); // dx -86 /2 → world (7,80)
    r2.current.onPointerUp(pointerEvent({ clientX: 114, clientY: 200 }));
    expect(useDoc.getState().polygons['p0'].vertices[2].x).toBeCloseTo(7, 6);
  });

  it('shift bypasses the vertex snap', () => {
    setModes({ line: true, all: 'off', grid: 'off' });
    useDoc.setState({
      ...useDoc.getState(),
      polygons: {
        p0: makePolygon({
          id: 'p0',
          vertices: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 50, y: 80 },
          ],
        }),
      },
    });
    const r = render();
    r.current.onVertexPointerDown('p0', 2, pointerEvent({ clientX: 200, clientY: 200 }));
    r.current.onPointerMove(pointerEvent({ clientX: 190, clientY: 200, shiftKey: true }));
    r.current.onPointerMove(pointerEvent({ clientX: 153, clientY: 205, shiftKey: true }));
    r.current.onPointerUp(pointerEvent({ clientX: 153, clientY: 205 }));
    expect(useDoc.getState().polygons['p0'].vertices[2]).toEqual({ x: 3, y: 85 });
  });
});

describe('usePolygonDrag — edge "+" insert-and-drag', () => {
  it('"+" pointerdown inserts the midpoint vertex and dragging moves the new one', () => {
    useDoc.setState({ ...useDoc.getState(), polygons: { p0: makePolygon({ id: 'p0' }) } });
    useSelection.setState({ ...useSelection.getState(), selectedPolygonIds: ['p0'] });
    const r = render();
    // Default square edge 0: (-30,-30) -> (30,-30); midpoint (0,-30) inserted at index 1.
    r.current.onEdgeAddPointerDown('p0', 0, pointerEvent({ clientX: 200, clientY: 200 }));
    expect(useDoc.getState().polygons['p0'].vertices).toHaveLength(5);
    expect(useDoc.getState().polygons['p0'].vertices[1]).toEqual({ x: 0, y: -30 });
    // The new vertex is selected, so Delete would target it.
    expect(useSelection.getState().selectedVertex).toEqual({ polygonId: 'p0', index: 1 });
    // Drag it by (+20, +40) world (shift bypasses snap).
    r.current.onPointerMove(pointerEvent({ clientX: 210, clientY: 200, shiftKey: true }));
    r.current.onPointerMove(pointerEvent({ clientX: 220, clientY: 240, shiftKey: true }));
    r.current.onPointerUp(pointerEvent({ clientX: 220, clientY: 240 }));
    const verts = useDoc.getState().polygons['p0'].vertices;
    expect(verts).toHaveLength(5);
    expect(verts[1]).toEqual({ x: 20, y: 10 }); // (0,-30) + (20,40)
  });

  it('a plain "+" tap (no drag) still inserts the vertex at the midpoint', () => {
    useDoc.setState({ ...useDoc.getState(), polygons: { p0: makePolygon({ id: 'p0' }) } });
    const r = render();
    r.current.onEdgeAddPointerDown('p0', 0, pointerEvent({ clientX: 200, clientY: 200 }));
    r.current.onPointerUp(pointerEvent({ clientX: 200, clientY: 200 }));
    const verts = useDoc.getState().polygons['p0'].vertices;
    expect(verts).toHaveLength(5);
    expect(verts[1]).toEqual({ x: 0, y: -30 });
  });
});

describe('usePolygonDrag — locked polygons are inert', () => {
  beforeEach(() => {
    useDoc.setState({
      ...useDoc.getState(),
      polygons: { p0: makePolygon({ id: 'p0', locked: true }) },
    });
    useSelection.setState({ ...useSelection.getState(), selectedPolygonIds: ['p0'] });
  });

  it('whole-drag does not move a locked polygon', () => {
    const before = useDoc.getState().polygons['p0'].vertices;
    const r = render();
    r.current.onPolygonPointerDown('p0', pointerEvent({ clientX: 200, clientY: 200 }));
    r.current.onPointerMove(pointerEvent({ clientX: 260, clientY: 220 }));
    r.current.onPointerUp(pointerEvent({ clientX: 260, clientY: 220 }));
    expect(useDoc.getState().polygons['p0'].vertices).toEqual(before);
  });

  it('vertex-drag does not move a locked polygon vertex', () => {
    const before = useDoc.getState().polygons['p0'].vertices;
    const r = render();
    r.current.onVertexPointerDown('p0', 0, pointerEvent({ clientX: 200, clientY: 200 }));
    r.current.onPointerMove(pointerEvent({ clientX: 260, clientY: 220 }));
    r.current.onPointerUp(pointerEvent({ clientX: 260, clientY: 220 }));
    expect(useDoc.getState().polygons['p0'].vertices).toEqual(before);
  });

  it('edge "+" does not insert a vertex on a locked polygon', () => {
    const r = render();
    r.current.onEdgeAddPointerDown('p0', 0, pointerEvent({ clientX: 200, clientY: 200 }));
    r.current.onPointerUp(pointerEvent({ clientX: 200, clientY: 200 }));
    expect(useDoc.getState().polygons['p0'].vertices).toHaveLength(4);
  });

  it('lets the pointerdown bubble (no stopPropagation) so a marquee can begin over it', () => {
    const r = render();
    let stopped = false;
    const e = {
      clientX: 200,
      clientY: 200,
      pointerId: 1,
      shiftKey: false,
      button: 0,
      stopPropagation: () => {
        stopped = true;
      },
    } as unknown as React.PointerEvent;
    r.current.onPolygonPointerDown('p0', e);
    expect(stopped).toBe(false);
  });
});

describe('usePolygonDrag — an unlocked polygon swallows its pointerdown', () => {
  it('stops propagation so dragging the body does not also rubber-band', () => {
    useDoc.setState({ ...useDoc.getState(), polygons: { p0: makePolygon({ id: 'p0' }) } });
    const r = render();
    let stopped = false;
    const e = {
      clientX: 200,
      clientY: 200,
      pointerId: 1,
      shiftKey: false,
      button: 0,
      stopPropagation: () => {
        stopped = true;
      },
    } as unknown as React.PointerEvent;
    r.current.onPolygonPointerDown('p0', e);
    expect(stopped).toBe(true);
  });
});
