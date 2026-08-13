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

describe('useLineCircleDrag — non-left buttons', () => {
  // A middle-button press on the rim bubbles to MapCanvas and starts a pan. If
  // it also armed the ring drag, both move handlers would run per frame: the map
  // pans AND the ring travels with the cursor, committing a moveLineCircle on
  // release. pointerLost is no rescue — buttons===4 is a live contact.
  it.each([
    ['middle', 1, 4],
    ['right', 2, 2],
  ])('ignores a %s-button press on the rim', (_name, button, buttons) => {
    seedCircle();
    const r = render();
    act(() =>
      r.current.onStartDrag(
        'c1',
        'rim',
        pointerEvent({ clientX: 200, clientY: 200, button, buttons }),
      ),
    );
    act(() => {
      r.current.onPointerMove(
        pointerEvent({ clientX: 260, clientY: 260, buttons, shiftKey: true }),
      );
      r.current.onPointerUp(pointerEvent({ clientX: 260, clientY: 260, buttons }));
    });
    expect(useDoc.getState().lineCircles.c1).toMatchObject({ x: 100, y: 100 });
    expect(useSelection.getState().selectedLineCircleIds).toEqual([]);
  });
});

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

  it('converts the align tolerance for the camera zoom', () => {
    // The engage radius is a constant number of SCREEN pixels, so at 2× the
    // world-space reach halves. A site that passed the raw world constant
    // would snap from twice as far out here and nowhere else — which is the
    // whole reason the tolerance has one home (snapToleranceAt, via
    // useDragSnap) rather than a copy per drag hook.
    setModes({ all: 'all' });
    useDoc.setState({
      ...useDoc.getState(),
      lineCircles: { c1: makeLineCircle({ id: 'c1', x: 100, y: 100, radius: 70 }) },
      stations: { s1: makeStation({ id: 's1', x: 200, y: 400, stops: [makeStop('L1')] }) },
    });
    /** Drag the rim east by `screenDx` px and report where the center landed. */
    const dragTo = (zoom: number, screenDx: number) => {
      useDoc.setState({
        ...useDoc.getState(),
        lineCircles: { c1: makeLineCircle({ id: 'c1', x: 100, y: 100, radius: 70 }) },
      });
      const r = render(zoom);
      act(() => r.current.onStartDrag('c1', 'rim', pointerEvent({ clientX: 200, clientY: 200 })));
      act(() => r.current.onPointerMove(pointerEvent({ clientX: 200 + screenDx, clientY: 200 })));
      return useDoc.getState().lineCircles.c1.x;
    };
    // At zoom 1 the reach is 10 world units: a center proposed at 193 locks
    // onto the station's x 200.
    expect(dragTo(1, 93)).toBe(200);
    // The same 7-unit world gap at zoom 2 (center proposed at 193 again, from
    // 186 screen px) is outside the 5-unit reach, so nothing engages.
    expect(dragTo(2, 186)).toBe(193);
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

describe('useLineCircleDrag — group drag', () => {
  // A ring in a multi-selection tows the rest of it, like every other master
  // kind. Its own pointer-down selection is the thing that used to make this
  // impossible: selectLineCircle clears every other list.
  const seedWithFreeStation = () => {
    seedCircle();
    useDoc.setState({
      ...useDoc.getState(),
      stations: { free: makeStation({ id: 'free', x: 500, y: 500 }) },
    });
  };

  it('tows the co-selected rest of the map by the rim delta', () => {
    seedWithFreeStation();
    useSelection.setState({
      ...useSelection.getState(),
      selectedStationIds: ['free'],
      selectedLineCircleIds: ['c1'],
    });
    const r = render();
    act(() => r.current.onStartDrag('c1', 'rim', pointerEvent({ clientX: 0, clientY: 0 })));
    // Grabbing a ring already in the selection must leave the selection alone.
    expect(useSelection.getState().selectedStationIds).toEqual(['free']);
    act(() => {
      r.current.onPointerMove(pointerEvent({ clientX: 30, clientY: -10, shiftKey: true }));
      r.current.onPointerUp(pointerEvent({ clientX: 30, clientY: -10 }));
    });
    const doc = useDoc.getState();
    expect(doc.lineCircles.c1).toMatchObject({ x: 130, y: 90 });
    expect(doc.stations.free).toMatchObject({ x: 530, y: 490 });
    // One undo for the whole group gesture.
    act(() => useDoc.temporal.getState().undo());
    expect(useDoc.getState().stations.free).toMatchObject({ x: 500, y: 500 });
  });

  it('still claims the selection when the grabbed ring was not in it', () => {
    seedWithFreeStation();
    useSelection.setState({ ...useSelection.getState(), selectedStationIds: ['free'] });
    const r = render();
    act(() => r.current.onStartDrag('c1', 'rim', pointerEvent({ clientX: 0, clientY: 0 })));
    expect(useSelection.getState().selectedLineCircleIds).toEqual(['c1']);
    expect(useSelection.getState().selectedStationIds).toEqual([]);
    act(() => {
      r.current.onPointerMove(pointerEvent({ clientX: 30, clientY: 0, shiftKey: true }));
      r.current.onPointerUp(pointerEvent({ clientX: 30, clientY: 0 }));
    });
    // Nothing towed: the ring wasn't part of the selection when grabbed.
    expect(useDoc.getState().stations.free).toMatchObject({ x: 500, y: 500 });
  });

  it('leaves the selection alone on a Shift-grab (the click owns the toggle)', () => {
    seedWithFreeStation();
    useSelection.setState({ ...useSelection.getState(), selectedStationIds: ['free'] });
    const r = render();
    act(() =>
      r.current.onStartDrag('c1', 'rim', pointerEvent({ clientX: 0, clientY: 0, shiftKey: true })),
    );
    expect(useSelection.getState().selectedStationIds).toEqual(['free']);
    expect(useSelection.getState().selectedLineCircleIds).toEqual([]);
  });

  it('does not tow anything while the KNOB resizes', () => {
    seedWithFreeStation();
    useSelection.setState({
      ...useSelection.getState(),
      selectedStationIds: ['free'],
      selectedLineCircleIds: ['c1'],
    });
    const r = render();
    act(() => r.current.onStartDrag('c1', 'knob', pointerEvent({ clientX: 170, clientY: 100 })));
    act(() => {
      r.current.onPointerMove(pointerEvent({ clientX: 200, clientY: 100 }));
      r.current.onPointerUp(pointerEvent({ clientX: 200, clientY: 100 }));
    });
    expect(useDoc.getState().lineCircles.c1.radius).toBe(100);
    expect(useDoc.getState().stations.free).toMatchObject({ x: 500, y: 500 });
  });

  it('excludes towed passengers from the snap pool', () => {
    // A ring whose passenger sits due north of where the center is heading: with
    // the passenger in the pool, "snap to all" would lock the center onto the
    // station it is carrying and the ring would stick.
    setModes({ all: 'all' });
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
    useSelection.setState({ ...useSelection.getState(), selectedLineCircleIds: ['c1'] });
    const r = render();
    act(() => r.current.onStartDrag('c1', 'rim', pointerEvent({ clientX: 0, clientY: 0 })));
    // Center proposes x 168 — 2 off the passenger's start x of 170, well inside
    // the 10-unit tolerance.
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 68, clientY: 0 })));
    expect(useDoc.getState().lineCircles.c1.x).toBe(168);
    expect(r.current.snapGuides).toEqual([]);
  });
});

describe('useLineCircleDrag — centre drag', () => {
  // The centre handle is a second grab for the same gesture the rim gives, and
  // it exists because a line riding lane 0 buries the rim outright. It must
  // therefore behave as a MOVE in every respect the rim does — the hook
  // branches on the part, so "same by accident" is one edit away from wrong.
  it('moves the circle, leaving the radius alone', () => {
    seedCircle();
    const r = render();
    act(() => r.current.onStartDrag('c1', 'center', pointerEvent({ clientX: 100, clientY: 100 })));
    act(() => {
      r.current.onPointerMove(pointerEvent({ clientX: 140, clientY: 130, shiftKey: true }));
      r.current.onPointerUp(pointerEvent({ clientX: 140, clientY: 130 }));
    });
    const c = useDoc.getState().lineCircles.c1;
    expect(c).toMatchObject({ x: 140, y: 130 });
    expect(c.radius).toBe(70);
  });

  it('tows the co-selected rest of the map, exactly as the rim does', () => {
    seedCircle();
    useDoc.setState({
      ...useDoc.getState(),
      stations: { free: makeStation({ id: 'free', x: 500, y: 500 }) },
    });
    useSelection.setState({
      ...useSelection.getState(),
      selectedStationIds: ['free'],
      selectedLineCircleIds: ['c1'],
    });
    const r = render();
    act(() => r.current.onStartDrag('c1', 'center', pointerEvent({ clientX: 0, clientY: 0 })));
    act(() => {
      r.current.onPointerMove(pointerEvent({ clientX: 30, clientY: -10, shiftKey: true }));
      r.current.onPointerUp(pointerEvent({ clientX: 30, clientY: -10 }));
    });
    expect(useDoc.getState().stations.free).toMatchObject({ x: 530, y: 490 });
  });

  it('never arms the diameter readout — that belongs to the resize', () => {
    seedCircle();
    const r = render();
    act(() => r.current.onStartDrag('c1', 'center', pointerEvent({ clientX: 100, clientY: 100 })));
    act(() =>
      r.current.onPointerMove(pointerEvent({ clientX: 140, clientY: 100, shiftKey: true })),
    );
    expect(r.current.resizingId).toBeNull();
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

  it('Shift frees the radius from the quarter grid, like every other drag', () => {
    // The grid is a GESTURE snap now (the transform keeps whatever radius it is
    // handed), so Shift can decline it the way it declines the point snapper on
    // a move — and the hook's contract says it does.
    seedCircle();
    const r = render();
    act(() => r.current.onStartDrag('c1', 'knob', pointerEvent({ clientX: 170, clientY: 100 })));
    act(() => {
      r.current.onPointerMove(pointerEvent({ clientX: 200.1, clientY: 160, shiftKey: true }));
      r.current.onPointerUp(pointerEvent({ clientX: 200.1, clientY: 160, shiftKey: true }));
    });
    expect(useDoc.getState().lineCircles.c1.radius).toBe(100.1);
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
