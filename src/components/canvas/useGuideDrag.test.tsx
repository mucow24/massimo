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
  ctrlKey?: boolean;
  buttons?: number;
  button?: number;
}): React.PointerEvent {
  return {
    clientX: opts.clientX,
    clientY: opts.clientY,
    pointerId: opts.pointerId ?? 1,
    shiftKey: opts.shiftKey ?? false,
    ctrlKey: opts.ctrlKey ?? false,
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

  it('a strip guide over a corner square tints THAT square, and still deletes', () => {
    seedGuides();
    const r = render();
    act(() => r.current.onStartDrag('gv', pointerEvent({ clientX: 200, clientY: 300 })));
    // x ≤ 14 is the vertical guide's whole delete zone, corner squares
    // included — but the tint follows the well under the POINTER, so the
    // square the cursor occupies is the one that lights up. (The jsdom host
    // rect is zero-height, so any left-edge point below the top corner reads
    // as the bottom one.)
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 8, clientY: 300, shiftKey: true })));
    expect(r.current.overWell).toBe('diagonal-down');
    act(() => r.current.onPointerUp(pointerEvent({ clientX: 8, clientY: 300 })));
    expect(useDoc.getState().guides.gv).toBeUndefined();
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

describe('useGuideDrag — neighbour spacing readout', () => {
  // gh (100) with a parallel guide either side of it, plus the vertical one
  // from the shared seed — which crosses, so it is never a neighbour.
  const seedNeighbours = () => {
    seedGuides();
    useDoc.setState({
      ...useDoc.getState(),
      guides: {
        ...useDoc.getState().guides,
        ghLo: makeGuide({ id: 'ghLo', orientation: 'horizontal', offset: 40 }),
        ghHi: makeGuide({ id: 'ghHi', orientation: 'horizontal', offset: 160 }),
      },
    });
  };

  it('measures to the nearest parallel guide either side, riding the cursor', () => {
    seedNeighbours();
    const r = render();
    act(() => r.current.onStartDrag('gh', pointerEvent({ clientX: 300, clientY: 100 })));
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 300, clientY: 137 })));
    expect(useDoc.getState().guides.gh.offset).toBe(137);
    expect(r.current.snapGuides).toEqual([
      { from: { x: 300, y: 137 }, to: { x: 300, y: 40 }, label: '97.0', quiet: true },
      { from: { x: 300, y: 137 }, to: { x: 300, y: 160 }, label: '23.0', quiet: true },
    ]);
    // The readout is gesture chrome: it goes when the gesture does.
    act(() => r.current.onPointerUp(pointerEvent({ clientX: 300, clientY: 137 })));
    expect(r.current.snapGuides).toEqual([]);
  });

  it('keeps measuring under Shift — Shift declines snapping, not measuring', () => {
    seedNeighbours();
    const r = render();
    act(() => r.current.onStartDrag('gh', pointerEvent({ clientX: 300, clientY: 100 })));
    act(() =>
      r.current.onPointerMove(pointerEvent({ clientX: 300, clientY: 137, shiftKey: true })),
    );
    expect(r.current.snapGuides.map((g) => g.label)).toEqual(['97.0', '23.0']);
  });

  it('measures to a TOWED parallel sibling, at its live offset, rather than past it', () => {
    seedNeighbours();
    useDoc.setState({
      ...useDoc.getState(),
      guides: {
        ...useDoc.getState().guides,
        ghFar: makeGuide({ id: 'ghFar', orientation: 'horizontal', offset: 300 }),
      },
    });
    useSelection.setState({ ...useSelection.getState(), selectedGuideIds: ['gh', 'ghHi'] });
    const r = render();
    act(() => r.current.onStartDrag('gh', pointerEvent({ clientX: 300, clientY: 100 })));
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 300, clientY: 137 })));
    // ghHi is towed to 197. It is out of the SNAP pool (a moving target), but
    // it is still ink on the canvas — measuring past it to ghFar would draw a
    // span straight through it.
    expect(useDoc.getState().guides.ghHi.offset).toBe(197);
    expect(r.current.snapGuides).toEqual([
      { from: { x: 300, y: 137 }, to: { x: 300, y: 40 }, label: '97.0', quiet: true },
      { from: { x: 300, y: 137 }, to: { x: 300, y: 197 }, label: '60.0', quiet: true },
    ]);
  });

  it('measures the well pull-out ghost too', () => {
    seedNeighbours();
    const r = render();
    act(() =>
      r.current.onWellPointerDown('horizontal', pointerEvent({ clientX: 300, clientY: 5 })),
    );
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 300, clientY: 137 })));
    expect(r.current.pull).toEqual({ orientation: 'horizontal', offset: 137 });
    // Nothing is excluded during a pull — the ghost isn't in the doc — so the
    // seeded gh at 100 is the neighbour below, not ghLo at 40.
    expect(r.current.snapGuides.map((g) => g.label)).toEqual(['37.0', '23.0']);
  });

  it('stays quiet while the View menu hides guides', () => {
    seedNeighbours();
    useViewportStore.setState({ showGuides: false });
    const r = render();
    act(() => r.current.onStartDrag('gh', pointerEvent({ clientX: 300, clientY: 100 })));
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 300, clientY: 137 })));
    expect(r.current.snapGuides).toEqual([]);
  });
});

describe('useGuideDrag — snap to grid length', () => {
  // gh (100) is the dragged guide, ghLo (40) the parallel neighbour a cadence
  // can run from. The grid is 20 throughout (the shared beforeEach).
  const seedCadence = (neighbour = 40) =>
    useDoc.setState({
      ...useDoc.getState(),
      guides: {
        gh: makeGuide({ id: 'gh', orientation: 'horizontal', offset: 100 }),
        ghLo: makeGuide({ id: 'ghLo', orientation: 'horizontal', offset: neighbour }),
      },
    });

  const addGuide = (id: string, offset: number) =>
    useDoc.setState({
      ...useDoc.getState(),
      guides: {
        ...useDoc.getState().guides,
        [id]: makeGuide({ id, orientation: 'horizontal', offset }),
      },
    });

  it('notches the offset a whole grid length from the nearest parallel guide', () => {
    setModes({ tens: true });
    seedCadence();
    const r = render();
    act(() => r.current.onStartDrag('gh', pointerEvent({ clientX: 300, clientY: 100 })));
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 300, clientY: 137 })));
    // Raw 137 is 97 above ghLo; the nearest whole 20 is 100 → 140. The spacing
    // readout is the feedback — the gap it names IS the cadence.
    expect(useDoc.getState().guides.gh.offset).toBe(140);
    expect(r.current.snapGuides.map((g) => g.label)).toEqual(['100.0']);
  });

  it('measures from the NEAREST parallel guide, not just any of them', () => {
    setModes({ tens: true });
    seedCadence();
    addGuide('ghHi', 150);
    const r = render();
    act(() => r.current.onStartDrag('gh', pointerEvent({ clientX: 300, clientY: 100 })));
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 300, clientY: 137 })));
    // ghHi is 13 away, ghLo 97: the cadence runs from ghHi, one grid length
    // below it — 130, not the 140 ghLo would have given.
    expect(useDoc.getState().guides.gh.offset).toBe(130);
  });

  it('never takes its cadence from a guide towed by the same drag', () => {
    setModes({ tens: true });
    seedCadence();
    addGuide('ghHi', 150);
    useSelection.setState({ ...useSelection.getState(), selectedGuideIds: ['gh', 'ghHi'] });
    const r = render();
    act(() => r.current.onStartDrag('gh', pointerEvent({ clientX: 300, clientY: 100 })));
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 300, clientY: 137 })));
    // ghHi is the nearer guide but it moves WITH the grab, so its gap never
    // changes: the anchor is stationary ghLo, and the notch is 140.
    expect(useDoc.getState().guides.gh.offset).toBe(140);
    expect(useDoc.getState().guides.ghHi.offset).toBe(190);
  });

  it('never lands the guide on top of the guide it measures from', () => {
    setModes({ tens: true });
    seedCadence();
    const r = render();
    act(() => r.current.onStartDrag('gh', pointerEvent({ clientX: 300, clientY: 100 })));
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 300, clientY: 45 })));
    // Within half a step of ghLo the only whole multiple on offer is zero,
    // which would stack the two guides — the one thing guides never do. The
    // cadence stands down and the drag stays where the pointer put it.
    expect(useDoc.getState().guides.gh.offset).toBe(45);
  });

  it('yields the axis the hard grid pins, and keeps the one it does not', () => {
    setModes({ tens: true, grid: 'both' });
    seedCadence(45);
    const r = render();
    act(() => r.current.onStartDrag('gh', pointerEvent({ clientX: 300, clientY: 100 })));
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 300, clientY: 133 })));
    // Grid owns the quantization where it constrains: raw 133 → 140, not the
    // 125 the cadence off ghLo (45) would have given.
    expect(useDoc.getState().guides.gh.offset).toBe(140);
    // A VERTICAL grid pins X — nothing this guide can move — so the cadence
    // is back on.
    act(() => setModes({ tens: true, grid: 'vertical' }));
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 300, clientY: 133 })));
    expect(useDoc.getState().guides.gh.offset).toBe(125);
  });

  it('stays put when the nearest notch is out of tolerance', () => {
    setModes({ tens: true });
    seedCadence();
    // Zoom 2 halves the world-unit tolerance to 5, so a half-step miss on the
    // 20 grid no longer reaches.
    const r = render(2);
    act(() => r.current.onStartDrag('gh', pointerEvent({ clientX: 300, clientY: 100 })));
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 300, clientY: 80 })));
    expect(useDoc.getState().guides.gh.offset).toBe(90);
  });

  it('Shift declines the cadence, like every other snap', () => {
    setModes({ tens: true });
    seedCadence();
    const r = render();
    act(() => r.current.onStartDrag('gh', pointerEvent({ clientX: 300, clientY: 100 })));
    act(() =>
      r.current.onPointerMove(pointerEvent({ clientX: 300, clientY: 137, shiftKey: true })),
    );
    expect(useDoc.getState().guides.gh.offset).toBe(137);
  });

  it('the better-aligned of a station alignment and the cadence wins', () => {
    setModes({ tens: true, all: 'all' });
    seedCadence();
    useDoc.setState({
      ...useDoc.getState(),
      stations: { s1: makeStation({ id: 's1', x: 250, y: 150 }) },
    });
    const r = render();
    act(() => r.current.onStartDrag('gh', pointerEvent({ clientX: 300, clientY: 100 })));
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 300, clientY: 147 })));
    // The station is 3 off, the notch at 140 is 7: the alignment wins and
    // draws its segment (50 across to the station) above the readout.
    expect(useDoc.getState().guides.gh.offset).toBe(150);
    expect(r.current.snapGuides.map((g) => g.label)).toEqual(['50.0', '110.0']);
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 300, clientY: 143 })));
    // Now the notch is 3 off and the station 7: the cadence wins, and the
    // station's chrome goes with it — it would claim a snap that didn't happen.
    expect(useDoc.getState().guides.gh.offset).toBe(140);
    expect(r.current.snapGuides.map((g) => g.label)).toEqual(['100.0']);
  });

  it('notches the well pull-out ghost too', () => {
    setModes({ tens: true });
    seedCadence();
    const r = render();
    act(() =>
      r.current.onWellPointerDown('horizontal', pointerEvent({ clientX: 300, clientY: 5 })),
    );
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 300, clientY: 137 })));
    // Nothing is excluded during a pull, so the nearest parallel guide is gh
    // (100): 137 is 37 above it, and the nearest whole 20 is 40.
    expect(r.current.pull).toEqual({ orientation: 'horizontal', offset: 140 });
  });

  it('a diagonal notches the true perpendicular gap, not its intercept', () => {
    setModes({ tens: true });
    useDoc.setState({
      ...useDoc.getState(),
      guides: {
        gd: makeGuide({ id: 'gd', orientation: 'diagonal-down', offset: 100 }),
        gdLo: makeGuide({ id: 'gdLo', orientation: 'diagonal-down', offset: 0 }),
      },
    });
    const r = render();
    act(() => r.current.onStartDrag('gd', pointerEvent({ clientX: 100, clientY: 100 })));
    // dy −10, dx 0 → raw intercept 90, which is 63.6 of true distance from
    // gdLo. The nearest whole 20 of DISTANCE is 60 — an intercept of 60√2.
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 100, clientY: 90 })));
    expect(useDoc.getState().guides.gd.offset).toBeCloseTo(60 * Math.SQRT2, 9);
    expect(r.current.snapGuides.map((g) => g.label)).toEqual(['60.0']);
  });
});

describe('useGuideDrag — diagonal guides', () => {
  const seedDiagonals = () =>
    useDoc.setState({
      ...useDoc.getState(),
      guides: {
        gd: makeGuide({ id: 'gd', orientation: 'diagonal-down', offset: 0 }),
        gu: makeGuide({ id: 'gu', orientation: 'diagonal-up', offset: 400 }),
      },
    });

  it('moves a \\ guide by the intercept projection of the pointer delta', () => {
    seedDiagonals();
    const r = render();
    act(() => r.current.onStartDrag('gd', pointerEvent({ clientX: 100, clientY: 100 })));
    act(() => {
      // dx 30, dy 50 → intercept delta dy − dx = 20.
      r.current.onPointerMove(pointerEvent({ clientX: 130, clientY: 150, shiftKey: true }));
      r.current.onPointerUp(pointerEvent({ clientX: 130, clientY: 150 }));
    });
    expect(useDoc.getState().guides.gd.offset).toBe(20);
  });

  it('moves a / guide by dy + dx, divided by the zoom', () => {
    seedDiagonals();
    const r = render(2);
    act(() => r.current.onStartDrag('gu', pointerEvent({ clientX: 100, clientY: 100 })));
    act(() => {
      // dx 30, dy 50 → (50 + 30) / 2 = 40 world units.
      r.current.onPointerMove(pointerEvent({ clientX: 130, clientY: 150, shiftKey: true }));
      r.current.onPointerUp(pointerEvent({ clientX: 130, clientY: 150 }));
    });
    expect(useDoc.getState().guides.gu.offset).toBe(440);
  });

  it('snaps so the guide passes through an aligned station', () => {
    setModes({ all: 'all' });
    seedDiagonals();
    useDoc.setState({
      ...useDoc.getState(),
      stations: { s1: makeStation({ id: 's1', x: 300, y: 150 }) },
    });
    const r = render();
    act(() => r.current.onStartDrag('gd', pointerEvent({ clientX: 100, clientY: 100 })));
    // Raw intercept −147, within tolerance of the station's y − x = −150.
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 100, clientY: -47 })));
    expect(useDoc.getState().guides.gd.offset).toBe(-150);
    expect(r.current.snapGuides.length).toBeGreaterThan(0);
  });

  it('the hard grid quantizes the intercept — full lattice only', () => {
    setModes({ grid: 'both' });
    seedDiagonals();
    const r = render();
    act(() => r.current.onStartDrag('gd', pointerEvent({ clientX: 100, clientY: 100 })));
    // Raw intercept 33 on the 20 grid → 40.
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 100, clientY: 133 })));
    expect(useDoc.getState().guides.gd.offset).toBe(40);
    // A directional grid has no diagonal crossings to offer: raw wins.
    act(() => setModes({ grid: 'horizontal' }));
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 100, clientY: 133 })));
    expect(useDoc.getState().guides.gd.offset).toBe(33);
  });

  it('tows co-selected items by the perpendicular carry, half per axis', () => {
    seedDiagonals();
    useDoc.setState({
      ...useDoc.getState(),
      stations: { free: makeStation({ id: 'free', x: 500, y: 500 }) },
    });
    useSelection.setState({
      ...useSelection.getState(),
      selectedStationIds: ['free'],
      selectedGuideIds: ['gd'],
    });
    const r = render();
    act(() => r.current.onStartDrag('gd', pointerEvent({ clientX: 300, clientY: 300 })));
    act(() => {
      r.current.onPointerMove(pointerEvent({ clientX: 300, clientY: 340, shiftKey: true }));
      r.current.onPointerUp(pointerEvent({ clientX: 300, clientY: 340 }));
    });
    expect(useDoc.getState().guides.gd.offset).toBe(40);
    expect(useDoc.getState().stations.free).toMatchObject({ x: 480, y: 520 });
  });

  it('deletes a \\ guide dropped on the lower-left corner well, not elsewhere', () => {
    seedDiagonals();
    const r = render();
    act(() => r.current.onStartDrag('gd', pointerEvent({ clientX: 300, clientY: 300 })));
    // The top strip is the HORIZONTAL home — not this guide's well.
    act(() =>
      r.current.onPointerMove(pointerEvent({ clientX: 300, clientY: 292, shiftKey: true })),
    );
    expect(r.current.overWell).toBeNull();
    // The lower-left corner square is (x ≤ 14, y past the bottom edge — the
    // jsdom host rect is zero-height, so any y qualifies).
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 8, clientY: 200, shiftKey: true })));
    expect(r.current.overWell).toBe('diagonal-down');
    act(() => r.current.onPointerUp(pointerEvent({ clientX: 8, clientY: 200 })));
    expect(useDoc.getState().guides.gd).toBeUndefined();
  });

  it('pulls a / guide out of the upper-left corner well', () => {
    const r = render();
    act(() => r.current.onWellPointerDown('diagonal-up', pointerEvent({ clientX: 5, clientY: 5 })));
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 200, clientY: 100 })));
    expect(r.current.pull).toEqual({ orientation: 'diagonal-up', offset: 300 });
    act(() => r.current.onPointerUp(pointerEvent({ clientX: 200, clientY: 100 })));
    const guides = Object.values(useDoc.getState().guides);
    expect(guides).toHaveLength(1);
    expect(guides[0]).toMatchObject({ orientation: 'diagonal-up', offset: 300 });
    expect(useSelection.getState().selectedGuideIds).toEqual([guides[0].id]);
  });

  it('pulls a \\ guide out of the lower-left corner well', () => {
    const r = render();
    act(() =>
      r.current.onWellPointerDown('diagonal-down', pointerEvent({ clientX: 5, clientY: 395 })),
    );
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 200, clientY: 300 })));
    expect(r.current.pull).toEqual({ orientation: 'diagonal-down', offset: 100 });
    act(() => r.current.onPointerUp(pointerEvent({ clientX: 200, clientY: 300 })));
    const guides = Object.values(useDoc.getState().guides);
    expect(guides[0]).toMatchObject({ orientation: 'diagonal-down', offset: 100 });
  });
});

describe('useGuideDrag — Ctrl bounds the guide (resize phase)', () => {
  // The jsdom host rect is all zeros, which reads as a zero-area visible box —
  // every foot would sit "outside" and flip the span straight to infinite. The
  // resize tests give the host a real box (the wells then live in its bands).
  const hostRect = (w = 800, h = 600) => {
    host.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: w,
        bottom: h,
        width: w,
        height: h,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as globalThis.DOMRect;
  };

  it('Ctrl at pointer-down scrubs from the press foot: it marks one END, the cursor the other', () => {
    hostRect();
    seedGuides();
    const r = render();
    act(() =>
      r.current.onStartDrag('gh', pointerEvent({ clientX: 300, clientY: 100, ctrlKey: true })),
    );
    act(() =>
      r.current.onPointerMove(
        pointerEvent({ clientX: 420, clientY: 108, ctrlKey: true, shiftKey: true }),
      ),
    );
    const g = useDoc.getState().guides.gh;
    expect(g.offset).toBe(100);
    // Highlighter semantics: the span IS the swept stretch, 300 → 420.
    expect(g.extent).toEqual({ center: 360, halfLength: 60 });
    // The gesture chrome is a live length readout spanning the extent — the
    // neighbour spacing readout stands down while the offset is frozen.
    expect(r.current.snapGuides).toEqual([
      { from: { x: 300, y: 100 }, to: { x: 420, y: 100 }, label: '120.0' },
    ]);
    act(() => r.current.onPointerUp(pointerEvent({ clientX: 420, clientY: 108, ctrlKey: true })));
    expect(useDoc.getState().guides.gh.extent).toEqual({ center: 360, halfLength: 60 });
    // One undo entry for the whole gesture.
    act(() => useDoc.temporal.getState().undo());
    expect(useDoc.getState().guides.gh.extent).toBeUndefined();
  });

  it('Ctrl mid-gesture anchors an end at its first frame; releasing Ctrl resumes the offset with no jump', () => {
    hostRect();
    seedGuides();
    const r = render();
    act(() => r.current.onStartDrag('gh', pointerEvent({ clientX: 300, clientY: 100 })));
    act(() =>
      r.current.onPointerMove(pointerEvent({ clientX: 300, clientY: 140, shiftKey: true })),
    );
    expect(useDoc.getState().guides.gh.offset).toBe(140);
    // The first Ctrl frame marks one end at ITS cursor foot; a zero-width
    // frame writes no extent yet.
    act(() =>
      r.current.onPointerMove(
        pointerEvent({ clientX: 380, clientY: 152, ctrlKey: true, shiftKey: true }),
      ),
    );
    expect(useDoc.getState().guides.gh.offset).toBe(140);
    expect(useDoc.getState().guides.gh.extent).toBeUndefined();
    act(() =>
      r.current.onPointerMove(
        pointerEvent({ clientX: 460, clientY: 152, ctrlKey: true, shiftKey: true }),
      ),
    );
    // The swept stretch 380 → 460.
    expect(useDoc.getState().guides.gh.extent).toEqual({ center: 420, halfLength: 40 });
    expect(useDoc.getState().guides.gh.offset).toBe(140);
    // Ctrl up: the offset resumes exactly where it froze (the perpendicular
    // drift during the resize never lands)…
    act(() =>
      r.current.onPointerMove(pointerEvent({ clientX: 460, clientY: 152, shiftKey: true })),
    );
    expect(useDoc.getState().guides.gh.offset).toBe(140);
    // …and further travel moves it from there, extent riding along untouched.
    act(() =>
      r.current.onPointerMove(pointerEvent({ clientX: 460, clientY: 172, shiftKey: true })),
    );
    expect(useDoc.getState().guides.gh.offset).toBe(160);
    expect(useDoc.getState().guides.gh.extent).toEqual({ center: 420, halfLength: 40 });
    act(() => r.current.onPointerUp(pointerEvent({ clientX: 460, clientY: 172 })));
    act(() => useDoc.temporal.getState().undo());
    expect(useDoc.getState().guides.gh.offset).toBe(100);
    expect(useDoc.getState().guides.gh.extent).toBeUndefined();
  });

  it('sweeping past the visible canvas edge flips the guide back to infinite; back inside re-bounds', () => {
    hostRect(800, 600);
    seedGuides();
    const r = render();
    act(() =>
      r.current.onStartDrag('gh', pointerEvent({ clientX: 300, clientY: 100, ctrlKey: true })),
    );
    act(() =>
      r.current.onPointerMove(
        pointerEvent({ clientX: 500, clientY: 100, ctrlKey: true, shiftKey: true }),
      ),
    );
    expect(useDoc.getState().guides.gh.extent).toEqual({ center: 400, halfLength: 100 });
    // The foot crosses x = 800 — the visible edge — and the span lets go.
    act(() =>
      r.current.onPointerMove(
        pointerEvent({ clientX: 820, clientY: 100, ctrlKey: true, shiftKey: true }),
      ),
    );
    expect(useDoc.getState().guides.gh.extent).toBeUndefined();
    // Coming back inside re-bounds it from the same anchored end.
    act(() =>
      r.current.onPointerMove(
        pointerEvent({ clientX: 700, clientY: 100, ctrlKey: true, shiftKey: true }),
      ),
    );
    expect(useDoc.getState().guides.gh.extent).toEqual({ center: 500, halfLength: 200 });
    act(() => r.current.onPointerUp(pointerEvent({ clientX: 700, clientY: 100, ctrlKey: true })));
  });

  it('the swept endpoint snaps along the axis — a station column sets the half-length; Shift declines', () => {
    hostRect();
    setModes({ all: 'all' });
    seedGuides();
    useDoc.setState({
      ...useDoc.getState(),
      stations: { s1: makeStation({ id: 's1', x: 423, y: 500 }) },
    });
    const r = render();
    act(() =>
      r.current.onStartDrag('gh', pointerEvent({ clientX: 300, clientY: 100, ctrlKey: true })),
    );
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 420, clientY: 100, ctrlKey: true })));
    // Cursor t 420, the station's column at x 423 within tolerance — the end
    // lands ON the column: the span runs 300 → 423.
    expect(useDoc.getState().guides.gh.extent).toEqual({ center: 361.5, halfLength: 61.5 });
    act(() =>
      r.current.onPointerMove(
        pointerEvent({ clientX: 420, clientY: 100, ctrlKey: true, shiftKey: true }),
      ),
    );
    expect(useDoc.getState().guides.gh.extent).toEqual({ center: 360, halfLength: 60 });
    act(() => r.current.onPointerUp(pointerEvent({ clientX: 420, clientY: 100, ctrlKey: true })));
  });

  it('the swept endpoint snaps onto a crossing guide, shown engaged', () => {
    hostRect();
    seedGuides();
    const r = render();
    act(() =>
      r.current.onStartDrag('gh', pointerEvent({ clientX: 300, clientY: 100, ctrlKey: true })),
    );
    act(() => r.current.onPointerMove(pointerEvent({ clientX: 204, clientY: 100, ctrlKey: true })));
    // gv crosses at x 200; the swept end clicks onto the crossing: 200 → 300.
    expect(useDoc.getState().guides.gh.extent).toEqual({ center: 250, halfLength: 50 });
    expect(r.current.snapGuides.some((g) => g.alignGuideId === 'gv')).toBe(true);
    act(() => r.current.onPointerUp(pointerEvent({ clientX: 204, clientY: 100, ctrlKey: true })));
  });

  it('a release inside the home well during resize commits — it does not delete', () => {
    hostRect();
    seedGuides();
    const r = render();
    act(() =>
      r.current.onStartDrag('gh', pointerEvent({ clientX: 300, clientY: 100, ctrlKey: true })),
    );
    // The sweep ends inside the top band — the offset drag's delete zone —
    // but a resize release never deletes: the guide can't have been carried
    // anywhere (its offset is frozen).
    act(() =>
      r.current.onPointerMove(
        pointerEvent({ clientX: 40, clientY: 8, ctrlKey: true, shiftKey: true }),
      ),
    );
    expect(r.current.overWell).toBeNull();
    act(() => r.current.onPointerUp(pointerEvent({ clientX: 40, clientY: 8, ctrlKey: true })));
    expect(useDoc.getState().guides.gh).toBeDefined();
    // The swept stretch 40 → 300.
    expect(useDoc.getState().guides.gh.extent).toEqual({ center: 170, halfLength: 130 });
  });

  it('towed siblings freeze during resize and resume after from the true total', () => {
    hostRect();
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
    act(() => r.current.onStartDrag('gh', pointerEvent({ clientX: 300, clientY: 100 })));
    act(() =>
      r.current.onPointerMove(pointerEvent({ clientX: 300, clientY: 130, shiftKey: true })),
    );
    expect(useDoc.getState().stations.free).toMatchObject({ x: 500, y: 530 });
    // Resize frames tow nothing…
    act(() =>
      r.current.onPointerMove(
        pointerEvent({ clientX: 360, clientY: 135, ctrlKey: true, shiftKey: true }),
      ),
    );
    act(() =>
      r.current.onPointerMove(
        pointerEvent({ clientX: 420, clientY: 135, ctrlKey: true, shiftKey: true }),
      ),
    );
    expect(useDoc.getState().stations.free).toMatchObject({ x: 500, y: 530 });
    expect(useDoc.getState().guides.gh.offset).toBe(130);
    // …and the resumed offset drag carries them from the true total delta.
    act(() =>
      r.current.onPointerMove(pointerEvent({ clientX: 420, clientY: 145, shiftKey: true })),
    );
    expect(useDoc.getState().guides.gh.offset).toBe(140);
    expect(useDoc.getState().stations.free).toMatchObject({ x: 500, y: 540 });
    act(() => r.current.onPointerUp(pointerEvent({ clientX: 420, clientY: 145 })));
  });

  it('one motion: pull from the well, Ctrl mid-pull, sweep, release commits a bounded guide', () => {
    hostRect();
    const r = render();
    act(() =>
      r.current.onWellPointerDown('horizontal', pointerEvent({ clientX: 300, clientY: 5 })),
    );
    act(() =>
      r.current.onPointerMove(pointerEvent({ clientX: 300, clientY: 140, shiftKey: true })),
    );
    expect(r.current.pull).toEqual({ orientation: 'horizontal', offset: 140 });
    act(() =>
      r.current.onPointerMove(
        pointerEvent({ clientX: 310, clientY: 140, ctrlKey: true, shiftKey: true }),
      ),
    );
    act(() =>
      r.current.onPointerMove(
        pointerEvent({ clientX: 500, clientY: 140, ctrlKey: true, shiftKey: true }),
      ),
    );
    // The swept stretch 310 → 500.
    expect(r.current.pull).toEqual({
      orientation: 'horizontal',
      offset: 140,
      extent: { center: 405, halfLength: 95 },
    });
    act(() => r.current.onPointerUp(pointerEvent({ clientX: 500, clientY: 140, ctrlKey: true })));
    const guides = Object.values(useDoc.getState().guides);
    expect(guides).toHaveLength(1);
    expect(guides[0]).toMatchObject({
      orientation: 'horizontal',
      offset: 140,
      extent: { center: 405, halfLength: 95 },
    });
    expect(useSelection.getState().selectedGuideIds).toEqual([guides[0].id]);
  });

  it('Ctrl held from the well press anchors the pull sweep at the press foot', () => {
    hostRect();
    const r = render();
    act(() =>
      r.current.onWellPointerDown(
        'horizontal',
        pointerEvent({ clientX: 300, clientY: 5, ctrlKey: true }),
      ),
    );
    // The first moved frame must still mint the offset — there is no line to
    // bound before it — so the ghost appears unbounded…
    act(() =>
      r.current.onPointerMove(
        pointerEvent({ clientX: 302, clientY: 140, ctrlKey: true, shiftKey: true }),
      ),
    );
    expect(r.current.pull).toEqual({ orientation: 'horizontal', offset: 140 });
    // …and the sweep then anchors at the PRESS foot (x 300), not wherever the
    // second frame happens to land — same rule as Ctrl at the grab of an
    // existing guide.
    act(() =>
      r.current.onPointerMove(
        pointerEvent({ clientX: 450, clientY: 140, ctrlKey: true, shiftKey: true }),
      ),
    );
    expect(r.current.pull).toEqual({
      orientation: 'horizontal',
      offset: 140,
      extent: { center: 375, halfLength: 75 },
    });
    act(() => r.current.onPointerUp(pointerEvent({ clientX: 450, clientY: 140, ctrlKey: true })));
    const guides = Object.values(useDoc.getState().guides);
    expect(guides[0]).toMatchObject({ offset: 140, extent: { center: 375, halfLength: 75 } });
  });

  it('a diagonal sweep bounds in true length along the line', () => {
    hostRect();
    useDoc.setState({
      ...useDoc.getState(),
      guides: { gd: makeGuide({ id: 'gd', orientation: 'diagonal-down', offset: 0 }) },
    });
    const r = render();
    act(() =>
      r.current.onStartDrag('gd', pointerEvent({ clientX: 100, clientY: 100, ctrlKey: true })),
    );
    act(() =>
      r.current.onPointerMove(
        pointerEvent({ clientX: 180, clientY: 180, ctrlKey: true, shiftKey: true }),
      ),
    );
    const ext = useDoc.getState().guides.gd.extent;
    expect(ext).toBeDefined();
    // Press foot (100,100) → t = 100√2, sweep to (180,180) → t = 180√2: the
    // swept stretch in TRUE length along the line.
    expect(ext!.center).toBeCloseTo(140 * Math.SQRT2, 9);
    expect(ext!.halfLength).toBeCloseTo(40 * Math.SQRT2, 9);
    expect(useDoc.getState().guides.gd.offset).toBe(0);
    act(() => r.current.onPointerUp(pointerEvent({ clientX: 180, clientY: 180, ctrlKey: true })));
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
