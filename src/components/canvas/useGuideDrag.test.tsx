import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useGuideDrag } from './useGuideDrag';
import { dragState, useDoc } from '../../state/store';
import { useSelection } from '../../state/selection';
import { useSnapPrefs } from '../../state/snapPrefs';
import { useViewportStore } from '../../state/viewportStore';
import { DEFAULT_DOC } from '../../model/transforms';
import { DEFAULT_SNAP_MODES, type SnapModes } from '../../geometry/snap';
import { makeGuide, makeStation } from '../../test/fixtures';

function pointerEvent(opts: {
  clientX: number;
  clientY: number;
  pointerId?: number;
  shiftKey?: boolean;
  buttons?: number;
  button?: number;
}): React.PointerEvent {
  return {
    clientX: opts.clientX,
    clientY: opts.clientY,
    pointerId: opts.pointerId ?? 1,
    shiftKey: opts.shiftKey ?? false,
    buttons: opts.buttons ?? 1,
    button: opts.button ?? 0,
    stopPropagation: () => {},
  } as unknown as React.PointerEvent;
}

const setModes = (partial: Partial<SnapModes>) =>
  useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES, ...partial } });

const seedGuides = () =>
  useDoc.setState({
    ...useDoc.getState(),
    guides: {
      gh: makeGuide({ id: 'gh', orientation: 'horizontal', offset: 100 }),
      gv: makeGuide({ id: 'gv', orientation: 'vertical', offset: 200 }),
    },
  });

let host: HTMLDivElement;
let svg: SVGSVGElement;

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
  useSelection.getState().clearAllSelections();
  useViewportStore.setState({ x: 0, y: 0, zoom: 1, gridSize: 20, showGuides: true });
  setModes({ line: false, all: 'off', grid: 'off' });
  dragState.suppressClick = false;
  // A real host box so the hook's well hit-test has a `.canvas-host` to
  // measure. jsdom rects are all zeros, so the well bands are the screen
  // strips y ∈ [0, 14] (top) and x ∈ [0, 14] (left).
  host = document.createElement('div');
  host.className = 'canvas-host';
  svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
  host.appendChild(svg);
  document.body.appendChild(host);
});

afterEach(() => {
  host.remove();
});

function render(zoom = 1) {
  const svgRef = { current: svg };
  // Identity screen→world (camera at origin, zoom folded into the deltas the
  // hook divides itself).
  return renderHook(() => useGuideDrag(svgRef, zoom, (x, y) => ({ x, y }))).result;
}

describe('useGuideDrag — dragging an existing guide', () => {
  it('moves a horizontal guide by the vertical world delta only, and selects at pointer-down', () => {
    seedGuides();
    const r = render();
    act(() => r.current.onStartDrag('gh', pointerEvent({ clientX: 300, clientY: 100 })));
    expect(useSelection.getState().selectedGuideIds).toEqual(['gh']);
    act(() => {
      r.current.onPointerMove(pointerEvent({ clientX: 350, clientY: 137, shiftKey: true }));
      r.current.onPointerUp(pointerEvent({ clientX: 350, clientY: 137 }));
    });
    expect(useDoc.getState().guides.gh.offset).toBe(137);
  });

  it('moves a vertical guide by the horizontal delta, divided by the zoom', () => {
    seedGuides();
    const r = render(2);
    act(() => r.current.onStartDrag('gv', pointerEvent({ clientX: 200, clientY: 300 })));
    act(() => {
      r.current.onPointerMove(pointerEvent({ clientX: 260, clientY: 300, shiftKey: true }));
      r.current.onPointerUp(pointerEvent({ clientX: 260, clientY: 300 }));
    });
    // 60 screen px at zoom 2 is 30 world units.
    expect(useDoc.getState().guides.gv.offset).toBe(230);
  });

  it('snaps to an aligned station through the constrained point snapper, Shift bypasses', () => {
    setModes({ all: 'all' });
    seedGuides();
    useDoc.setState({
      ...useDoc.getState(),
      stations: { s1: makeStation({ id: 's1', x: 300, y: 150 }) },
    });
    const r = render();
    act(() => r.current.onStartDrag('gh', pointerEvent({ clientX: 400, clientY: 100 })));
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 400, clientY: 147 })));
    // Raw 147, within tolerance of the station's y 150 — the horizontal
    // alignment locks, and the labeled segment says so.
    expect(useDoc.getState().guides.gh.offset).toBe(150);
    expect(r.current.snapGuides.length).toBeGreaterThan(0);
    act(() =>
      r.current.onPointerMove(pointerEvent({ clientX: 400, clientY: 147, shiftKey: true })),
    );
    expect(useDoc.getState().guides.gh.offset).toBe(147);
    expect(r.current.snapGuides).toEqual([]);
  });

  it('honors the hard grid on its one axis', () => {
    setModes({ grid: 'both' });
    seedGuides();
    const r = render();
    act(() => r.current.onStartDrag('gh', pointerEvent({ clientX: 400, clientY: 100 })));
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 400, clientY: 133 })));
    // Raw 133 on the 20 grid → 140.
    expect(useDoc.getState().guides.gh.offset).toBe(140);
  });

  it('never snaps a guide to another guide', () => {
    setModes({ all: 'all' });
    seedGuides();
    useDoc.setState({
      ...useDoc.getState(),
      guides: {
        ...useDoc.getState().guides,
        gh2: makeGuide({ id: 'gh2', orientation: 'horizontal', offset: 152 }),
      },
    });
    const r = render();
    act(() => r.current.onStartDrag('gh', pointerEvent({ clientX: 400, clientY: 100 })));
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 400, clientY: 150 })));
    // 2 units from gh2 — if guides targeted guides this would land 152.
    expect(useDoc.getState().guides.gh.offset).toBe(150);
  });

  it('tows a co-selected station rigidly along the guide axis only', () => {
    seedGuides();
    useDoc.setState({
      ...useDoc.getState(),
      stations: { free: makeStation({ id: 'free', x: 500, y: 500 }) },
    });
    useSelection.setState({
      ...useSelection.getState(),
      selectedStationIds: ['free'],
      selectedGuideIds: ['gh'],
    });
    const r = render();
    act(() => r.current.onStartDrag('gh', pointerEvent({ clientX: 0, clientY: 0 })));
    // Grabbing a guide already in the selection leaves the selection alone.
    expect(useSelection.getState().selectedStationIds).toEqual(['free']);
    act(() => {
      // A diagonal pointer path: the guide takes only dy, and so does the tow.
      r.current.onPointerMove(pointerEvent({ clientX: 80, clientY: 30, shiftKey: true }));
      r.current.onPointerUp(pointerEvent({ clientX: 80, clientY: 30 }));
    });
    expect(useDoc.getState().guides.gh.offset).toBe(130);
    expect(useDoc.getState().stations.free).toMatchObject({ x: 500, y: 530 });
    // One undo entry for the whole group gesture.
    act(() => useDoc.temporal.getState().undo());
    expect(useDoc.getState().guides.gh.offset).toBe(100);
    expect(useDoc.getState().stations.free).toMatchObject({ x: 500, y: 500 });
  });

  it('refuses to arm on a locked guide', () => {
    useDoc.setState({
      ...useDoc.getState(),
      guides: { gh: makeGuide({ id: 'gh', orientation: 'horizontal', offset: 100, locked: true }) },
    });
    const r = render();
    act(() => r.current.onStartDrag('gh', pointerEvent({ clientX: 300, clientY: 100 })));
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 300, clientY: 200 })));
    expect(useDoc.getState().guides.gh.offset).toBe(100);
    expect(useSelection.getState().selectedGuideIds).toEqual([]);
  });

  it('rolls back on pointercancel and on a button-less move', () => {
    seedGuides();
    const r = render();
    act(() => r.current.onStartDrag('gh', pointerEvent({ clientX: 300, clientY: 100 })));
    act(() =>
      r.current.onPointerMove(pointerEvent({ clientX: 300, clientY: 160, shiftKey: true })),
    );
    expect(useDoc.getState().guides.gh.offset).toBe(160);
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 300, clientY: 180, buttons: 0 })));
    expect(useDoc.getState().guides.gh.offset).toBe(100);
  });

  it('deletes the guide when released back into its home well', () => {
    seedGuides();
    const r = render();
    act(() => r.current.onStartDrag('gh', pointerEvent({ clientX: 300, clientY: 100 })));
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 300, clientY: 8, shiftKey: true })));
    // Hovering the top strip advertises the delete.
    expect(r.current.overWell).toBe('horizontal');
    act(() => r.current.onPointerUp(pointerEvent({ clientX: 300, clientY: 8 })));
    expect(useDoc.getState().guides.gh).toBeUndefined();
    expect(useSelection.getState().selectedGuideIds).toEqual([]);
    // One undo restores it.
    act(() => useDoc.temporal.getState().undo());
    expect(useDoc.getState().guides.gh).toBeDefined();
  });

  it("the OTHER orientation's well does not delete", () => {
    seedGuides();
    const r = render();
    act(() => r.current.onStartDrag('gh', pointerEvent({ clientX: 300, clientY: 100 })));
    // x ≤ 14 is the LEFT well — home of vertical guides, not this one.
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 8, clientY: 160, shiftKey: true })));
    expect(r.current.overWell).toBeNull();
    act(() => r.current.onPointerUp(pointerEvent({ clientX: 8, clientY: 160 })));
    expect(useDoc.getState().guides.gh.offset).toBe(160);
  });
});

describe('useGuideDrag — pulling a new guide from a well', () => {
  it('shows a snapping ghost and commits one selected guide on release', () => {
    setModes({ all: 'all' });
    useDoc.setState({
      ...useDoc.getState(),
      stations: { s1: makeStation({ id: 's1', x: 300, y: 150 }) },
    });
    const r = render();
    act(() =>
      r.current.onWellPointerDown('horizontal', pointerEvent({ clientX: 300, clientY: 5 })),
    );
    expect(r.current.pull).toBeNull();
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 300, clientY: 147 })));
    // The ghost snapped onto the station's y.
    expect(r.current.pull).toEqual({ orientation: 'horizontal', offset: 150 });
    act(() => r.current.onPointerUp(pointerEvent({ clientX: 300, clientY: 147 })));
    const guides = Object.values(useDoc.getState().guides);
    expect(guides).toHaveLength(1);
    expect(guides[0]).toMatchObject({ orientation: 'horizontal', offset: 150 });
    expect(useSelection.getState().selectedGuideIds).toEqual([guides[0].id]);
    expect(r.current.pull).toBeNull();
    // The commit is one plain write — a single undo removes it.
    act(() => useDoc.temporal.getState().undo());
    expect(useDoc.getState().guides).toEqual({});
  });

  it('a release back inside the well creates nothing', () => {
    const r = render();
    act(() =>
      r.current.onWellPointerDown('horizontal', pointerEvent({ clientX: 300, clientY: 5 })),
    );
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 300, clientY: 120 })));
    expect(r.current.pull).not.toBeNull();
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 300, clientY: 6 })));
    expect(r.current.overWell).toBe('horizontal');
    act(() => r.current.onPointerUp(pointerEvent({ clientX: 300, clientY: 6 })));
    expect(useDoc.getState().guides).toEqual({});
  });

  it('a sub-threshold well click creates nothing', () => {
    const r = render();
    act(() => r.current.onWellPointerDown('vertical', pointerEvent({ clientX: 5, clientY: 300 })));
    act(() => r.current.onPointerUp(pointerEvent({ clientX: 5, clientY: 300 })));
    expect(useDoc.getState().guides).toEqual({});
  });

  it('pulls a vertical guide from the left well by the pointer x', () => {
    const r = render();
    act(() => r.current.onWellPointerDown('vertical', pointerEvent({ clientX: 5, clientY: 300 })));
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 240, clientY: 300 })));
    act(() => r.current.onPointerUp(pointerEvent({ clientX: 240, clientY: 300 })));
    const guides = Object.values(useDoc.getState().guides);
    expect(guides[0]).toMatchObject({ orientation: 'vertical', offset: 240 });
  });
});
