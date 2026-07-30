import { describe, it, expect, beforeEach } from 'vitest';
import { createRef, type RefObject } from 'react';
import { act, renderHook } from '@testing-library/react';
import { useLineCircleDrag } from './useLineCircleDrag';
import { dragState, useDoc } from '../../state/store';
import { useSelection } from '../../state/selection';
import { useSnapPrefs } from '../../state/snapPrefs';
import { useViewportStore } from '../../state/viewportStore';
import { DEFAULT_DOC } from '../../model/transforms';
import { DEFAULT_SNAP_MODES, type SnapModes } from '../../geometry/snap';
import { makeLineCircle, makeStation, makeStop } from '../../test/fixtures';

function pointerEvent(opts: {
  clientX: number;
  clientY: number;
  pointerId?: number;
  shiftKey?: boolean;
  buttons?: number;
}): React.PointerEvent {
  return {
    clientX: opts.clientX,
    clientY: opts.clientY,
    pointerId: opts.pointerId ?? 1,
    shiftKey: opts.shiftKey ?? false,
    buttons: opts.buttons ?? 1,
    button: 0,
    stopPropagation: () => {},
  } as unknown as React.PointerEvent;
}

const setModes = (partial: Partial<SnapModes>) =>
  useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES, ...partial } });

// A lone circle centered at (100,100), r 70 — the east point (the resize knob)
// sits at (170,100).
const seedCircle = (locked?: boolean) =>
  useDoc.setState({
    ...useDoc.getState(),
    lineCircles: { c1: makeLineCircle({ id: 'c1', x: 100, y: 100, radius: 70, locked }) },
  });

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
  useSelection.getState().clearAllSelections();
  useViewportStore.setState({ x: 0, y: 0, zoom: 1, gridSize: 20 });
  setModes({ line: false, all: 'off', grid: 'off' });
  dragState.suppressClick = false;
});

function render(zoom = 1) {
  const svgRef = createRef<SVGSVGElement>() as RefObject<SVGSVGElement | null>;
  return renderHook(() => useLineCircleDrag(svgRef, zoom)).result;
}

describe('useLineCircleDrag — rim drag moves the circle', () => {
  it('translates the center by the world delta and selects the circle', () => {
    seedCircle();
    const r = render();
    act(() => r.current.onStartDrag('c1', 'rim', pointerEvent({ clientX: 200, clientY: 200 })));
    expect(useSelection.getState().selectedLineCircleIds).toEqual(['c1']);
    act(() => {
      r.current.onPointerMove(pointerEvent({ clientX: 230, clientY: 213, shiftKey: true }));
      r.current.onPointerUp(pointerEvent({ clientX: 230, clientY: 213 }));
    });
    expect(useDoc.getState().lineCircles.c1).toMatchObject({ x: 130, y: 113, radius: 70 });
  });

  it('divides the screen delta by the viewport zoom', () => {
    seedCircle();
    const r = render(2);
    act(() => r.current.onStartDrag('c1', 'rim', pointerEvent({ clientX: 200, clientY: 200 })));
    act(() => {
      r.current.onPointerMove(pointerEvent({ clientX: 260, clientY: 200, shiftKey: true }));
      r.current.onPointerUp(pointerEvent({ clientX: 260, clientY: 200 }));
    });
    // 60 screen px at zoom 2 is 30 world units.
    expect(useDoc.getState().lineCircles.c1.x).toBe(130);
  });

  it('snaps the CENTER, not the rim, and Shift bypasses mid-gesture', () => {
    setModes({ grid: 'both' });
    seedCircle();
    const r = render();
    act(() => r.current.onStartDrag('c1', 'rim', pointerEvent({ clientX: 200, clientY: 200 })));
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 214, clientY: 213 })));
    // Center proposes (114,113); the 20-unit grid pulls it to (120,120). The
    // rim the pointer actually grabbed is nowhere near a grid line.
    expect(useDoc.getState().lineCircles.c1).toMatchObject({ x: 120, y: 120 });
    act(() =>
      r.current.onPointerMove(pointerEvent({ clientX: 214, clientY: 213, shiftKey: true })),
    );
    expect(useDoc.getState().lineCircles.c1).toMatchObject({ x: 114, y: 113 });
  });

  it('clears the alignment guides when Shift takes over', () => {
    // Align-to-everything (not the grid, which needs no guide of its own):
    // a station at x 300 gives the dragged center a vertical to lock onto.
    setModes({ all: 'all' });
    seedCircle();
    useDoc.setState({
      ...useDoc.getState(),
      stations: { s1: makeStation({ id: 's1', x: 300, y: 400 }) },
    });
    const r = render();
    act(() => r.current.onStartDrag('c1', 'rim', pointerEvent({ clientX: 0, clientY: 0 })));
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 198, clientY: 0 })));
    // Center proposes x 298, inside tolerance of the station's 300 — it locks
    // and says so.
    expect(useDoc.getState().lineCircles.c1.x).toBe(300);
    expect(r.current.snapGuides.length).toBeGreaterThan(0);
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 198, clientY: 0, shiftKey: true })));
    expect(useDoc.getState().lineCircles.c1.x).toBe(298);
    expect(r.current.snapGuides).toEqual([]);
  });

  it('carries a bound station around with the circle', () => {
    seedCircle();
    useDoc.setState({
      ...useDoc.getState(),
      stations: {
        s1: makeStation({
          id: 's1',
          x: 170,
          y: 100,
          circleId: 'c1',
          stops: [makeStop('l1', { viaCircle: true })],
        }),
      },
    });
    const r = render();
    act(() => r.current.onStartDrag('c1', 'rim', pointerEvent({ clientX: 0, clientY: 0 })));
    act(() => {
      r.current.onPointerMove(pointerEvent({ clientX: 30, clientY: 0, shiftKey: true }));
      r.current.onPointerUp(pointerEvent({ clientX: 30, clientY: 0 }));
    });
    expect(useDoc.getState().stations.s1).toMatchObject({ x: 200, y: 100 });
  });
});

describe('useLineCircleDrag — knob drag resizes', () => {
  it("takes the radius from the pointer's horizontal world distance, on the quarter grid", () => {
    seedCircle();
    const r = render();
    act(() => r.current.onStartDrag('c1', 'knob', pointerEvent({ clientX: 170, clientY: 100 })));
    act(() => {
      r.current.onPointerMove(pointerEvent({ clientX: 200.1, clientY: 160 }));
      r.current.onPointerUp(pointerEvent({ clientX: 200.1, clientY: 160 }));
    });
    // +30.1 horizontally (vertical travel is ignored), rounded to the 0.25 grid.
    expect(useDoc.getState().lineCircles.c1).toMatchObject({ x: 100, y: 100, radius: 100 });
  });

  it('clamps at the radius floor rather than inverting', () => {
    seedCircle();
    const r = render();
    act(() => r.current.onStartDrag('c1', 'knob', pointerEvent({ clientX: 170, clientY: 100 })));
    act(() => {
      r.current.onPointerMove(pointerEvent({ clientX: -30, clientY: 100 }));
      r.current.onPointerUp(pointerEvent({ clientX: -30, clientY: 100 }));
    });
    expect(useDoc.getState().lineCircles.c1.radius).toBe(14);
  });

  it('arms the diameter readout on the first real move, and drops it on pointerup', () => {
    seedCircle();
    const r = render();
    act(() => r.current.onStartDrag('c1', 'knob', pointerEvent({ clientX: 170, clientY: 100 })));
    // Pointer-down alone is a click, not a resize: no readout yet.
    expect(r.current.resizingId).toBeNull();
    // A sub-threshold twitch is still a click.
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 172, clientY: 100 })));
    expect(r.current.resizingId).toBeNull();
    expect(useDoc.getState().lineCircles.c1.radius).toBe(70);
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 190, clientY: 100 })));
    expect(r.current.resizingId).toBe('c1');
    act(() => r.current.onPointerUp(pointerEvent({ clientX: 190, clientY: 100 })));
    expect(r.current.resizingId).toBeNull();
  });
});

describe('useLineCircleDrag — gesture guards', () => {
  it('refuses to arm on a locked circle', () => {
    seedCircle(true);
    const r = render();
    act(() => r.current.onStartDrag('c1', 'rim', pointerEvent({ clientX: 200, clientY: 200 })));
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 260, clientY: 260 })));
    expect(useDoc.getState().lineCircles.c1).toMatchObject({ x: 100, y: 100 });
    expect(useSelection.getState().selectedLineCircleIds).toEqual([]);
  });

  it('rolls the doc back on pointercancel instead of committing', () => {
    seedCircle();
    const r = render();
    act(() => r.current.onStartDrag('c1', 'rim', pointerEvent({ clientX: 200, clientY: 200 })));
    act(() =>
      r.current.onPointerMove(pointerEvent({ clientX: 260, clientY: 200, shiftKey: true })),
    );
    expect(useDoc.getState().lineCircles.c1.x).toBe(160);
    act(() => r.current.onPointerCancel());
    expect(useDoc.getState().lineCircles.c1).toMatchObject({ x: 100, y: 100 });
    expect(r.current.snapGuides).toEqual([]);
  });

  it('treats a button-less move as a lost pointerup and rolls back', () => {
    seedCircle();
    const r = render();
    act(() => r.current.onStartDrag('c1', 'rim', pointerEvent({ clientX: 200, clientY: 200 })));
    act(() =>
      r.current.onPointerMove(pointerEvent({ clientX: 260, clientY: 200, shiftKey: true })),
    );
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 300, clientY: 200, buttons: 0 })));
    expect(useDoc.getState().lineCircles.c1).toMatchObject({ x: 100, y: 100 });
  });

  it('leaves one undo entry for a whole drag', () => {
    seedCircle();
    const r = render();
    act(() => r.current.onStartDrag('c1', 'rim', pointerEvent({ clientX: 200, clientY: 200 })));
    act(() => {
      r.current.onPointerMove(pointerEvent({ clientX: 230, clientY: 200, shiftKey: true }));
      r.current.onPointerMove(pointerEvent({ clientX: 260, clientY: 200, shiftKey: true }));
      r.current.onPointerUp(pointerEvent({ clientX: 260, clientY: 200 }));
    });
    expect(useDoc.getState().lineCircles.c1.x).toBe(160);
    act(() => useDoc.temporal.getState().undo());
    expect(useDoc.getState().lineCircles.c1.x).toBe(100);
  });
});
