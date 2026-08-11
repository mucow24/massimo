import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook, render as rtlRender, fireEvent } from '@testing-library/react';
import App from '../App';
import { useRectSelect, type RectSelectApi } from '../components/canvas/useRectSelect';
import { useDoc, useSelection, dragState } from '../state/store';
import { useViewportStore } from '../state/viewportStore';
import { DEFAULT_DOC } from '../model/transforms';
import { makePolygon } from '../test/fixtures';
import { fakeSvgRef, pointerEvent } from '../test/interaction';
import type { Pt } from '../geometry/polygonUnion';

// Identity screen→world so a pointer at client (x, y) lands at world (x, y).
const identity = (mx: number, my: number): Pt => ({ x: mx, y: my });

type Result = { current: RectSelectApi };
const down = (r: Result, e: React.PointerEvent) => act(() => r.current.onPointerDown(e));
const move = (r: Result, e: React.PointerEvent) => act(() => r.current.onPointerMove(e));
const up = (r: Result, e: React.PointerEvent) => act(() => r.current.onPointerUp(e));

// P1 spans world (0,0)-(60,60); P2 spans world (200,200)-(260,260). Disjoint,
// so a marquee can enclose exactly one of them.
const square = (id: string, ox: number, oy: number) =>
  makePolygon({
    id,
    vertices: [
      { x: ox, y: oy },
      { x: ox + 60, y: oy },
      { x: ox + 60, y: oy + 60 },
      { x: ox, y: oy + 60 },
    ],
  });

beforeEach(() => {
  useDoc.setState({
    ...useDoc.getState(),
    ...DEFAULT_DOC,
    polygons: { p1: square('p1', 0, 0), p2: square('p2', 200, 200) },
    backgroundOrder: ['p1', 'p2'],
  });
  useSelection.setState({
    ...useSelection.getState(),
    toolMode: 'arrow',
    spaceHeld: false,
    uiMode: { kind: 'idle' },
    selectedStationIds: [],
    selectedRouteBulletIds: [],
    selectedLabelIds: [],
    selectedPolygonIds: [],
    selectedSvgImageIds: [],
    selectedVertices: null,
  });
  useViewportStore.setState({ showNetwork: true });
  dragState.suppressClick = false;
});

function render() {
  const { ref } = fakeSvgRef();
  const { result } = renderHook(() => useRectSelect(ref, identity));
  return { result, ref };
}

// Drag a marquee from (x0,y0) to (x1,y1) on the canvas background.
function marquee(result: Result, ref: { current: SVGSVGElement | null }, box: number[]) {
  const [x0, y0, x1, y1] = box;
  down(result, pointerEvent({ clientX: x0, clientY: y0, target: ref.current }));
  move(result, pointerEvent({ clientX: x1, clientY: y1 }));
  up(result, pointerEvent({ clientX: x1, clientY: y1 }));
}

describe('marquee must not leave a stale vertex selection behind', () => {
  it('a plain marquee that deselects the vertex-owning polygon clears selectedVertices', () => {
    const { result, ref } = render();
    // User clicks polygon p1, then one of its vertex handles.
    useSelection.getState().selectPolygon('p1');
    useSelection.getState().selectVertices({ polygonId: 'p1', indices: [2] });
    expect(useSelection.getState().selectedVertices).toEqual({ polygonId: 'p1', indices: [2] });

    // Marquee around p2 only (no modifiers) → 'set' mode replaces the polygon
    // selection with [p2]. p1 is no longer selected, so its vertex handles are
    // not rendered at all — the vertex selection must not survive.
    marquee(result, ref, [150, 150, 300, 300]);

    expect(useSelection.getState().selectedPolygonIds).toEqual(['p2']);
    expect(useSelection.getState().selectedVertices).toBeNull();
  });

  it('an empty marquee over blank canvas clears selectedVertices', () => {
    const { result, ref } = render();
    useSelection.getState().selectPolygon('p1');
    useSelection.getState().selectVertices({ polygonId: 'p1', indices: [2] });

    // Band over empty space, hitting nothing.
    marquee(result, ref, [400, 400, 500, 500]);

    expect(useSelection.getState().selectedPolygonIds).toEqual([]);
    expect(useSelection.getState().selectedVertices).toBeNull();
  });

  it('a shift-marquee (add) that widens past the vertex-owning polygon clears selectedVertices', () => {
    const { result, ref } = render();
    useSelection.getState().selectPolygon('p1');
    useSelection.getState().selectVertices({ polygonId: 'p1', indices: [2] });

    const [x0, y0, x1, y1] = [150, 150, 300, 300];
    down(result, pointerEvent({ clientX: x0, clientY: y0, target: ref.current }));
    move(result, pointerEvent({ clientX: x1, clientY: y1, shiftKey: true }));
    up(result, pointerEvent({ clientX: x1, clientY: y1, shiftKey: true }));

    // Now p1 + p2 are both selected: vertex editing is single-polygon, so the
    // active vertex set is stale (exactly what togglePolygonSelection clears).
    expect(useSelection.getState().selectedPolygonIds).toEqual(['p1', 'p2']);
    expect(useSelection.getState().selectedVertices).toBeNull();
  });
});

describe('user-visible consequence: Delete after a marquee', () => {
  it('deletes the marquee-selected polygon, not a vertex of the deselected one', () => {
    rtlRender(<App />);
    useSelection.getState().selectPolygon('p1');
    useSelection.getState().selectVertices({ polygonId: 'p1', indices: [2] });

    // Exactly the commit sequence useRectSelect.onPointerUp runs in 'set' mode
    // for a marquee that swept up only p2.
    const sel = useSelection.getState();
    sel.setStationSelection([]);
    sel.setRouteBulletSelection([]);
    sel.setLabelSelection([]);
    sel.setPolygonSelection(['p2']);
    sel.setSvgImageSelection([]);

    // The canvas now shows p2 selected and p1 with no vertex handles.
    expect(useSelection.getState().selectedPolygonIds).toEqual(['p2']);

    fireEvent.keyDown(window, { key: 'Delete' });

    const polys = useDoc.getState().polygons;
    // p1 must be untouched — it isn't selected and shows no handles.
    expect(polys['p1'].vertices).toHaveLength(4);
    // p2 is what the user selected, so it's what Delete removes.
    expect(polys['p2']).toBeUndefined();
  });
});
