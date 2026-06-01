import { describe, it, expect, beforeEach } from 'vitest';
import { createRef, type RefObject } from 'react';
import { renderHook } from '@testing-library/react';
import { usePolygonDrag } from './usePolygonDrag';
import { useDoc, useSelection } from '../../state/store';
import { useSnapPrefs } from '../../state/snapPrefs';
import { DEFAULT_DOC } from '../../model/transforms';
import { DEFAULT_SNAP_MODES, type SnapModes } from '../../geometry/snap';
import { makePolygon } from '../../test/fixtures';

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
});

function render() {
  const svgRef = createRef<SVGSVGElement>() as RefObject<SVGSVGElement | null>;
  return renderHook(() => usePolygonDrag(svgRef, 1, false)).result;
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
