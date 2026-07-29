import { describe, it, expect, beforeEach } from 'vitest';
import { createRef, type RefObject } from 'react';
import { act, renderHook } from '@testing-library/react';
import { useStationDrag } from './useStationDrag';
import { useDoc, useSelection } from '../../state/store';
import { useSnapPrefs } from '../../state/snapPrefs';
import { DEFAULT_DOC } from '../../model/transforms';
import { DEFAULT_SNAP_MODES, type SnapModes } from '../../geometry/snap';
import { makeTextLabel, stationWithStop, makeLine } from '../../test/fixtures';
import { fakeSvgRef } from '../../test/interaction';
import { historyDepth, isHistoryGrouping } from '../../state/history';
import type { StationId } from '../../model/types';

const setModes = (partial: Partial<SnapModes>) =>
  useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES, ...partial } });

// Synthesize a React.PointerEvent-ish object exposing only the fields the
// hook actually reads (clientX, clientY, pointerId, shiftKey, ctrlKey/metaKey).
function pointerEvent(opts: {
  clientX: number;
  clientY: number;
  pointerId?: number;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  buttons?: number;
}): React.PointerEvent {
  return {
    clientX: opts.clientX,
    clientY: opts.clientY,
    pointerId: opts.pointerId ?? 1,
    shiftKey: opts.shiftKey ?? false,
    ctrlKey: opts.ctrlKey ?? false,
    metaKey: opts.metaKey ?? false,
    buttons: opts.buttons ?? 1,
  } as unknown as React.PointerEvent;
}

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useSelection.setState({
    ...useSelection.getState(),
    selectedStationIds: [],
    selectedRouteBulletIds: [],
    selectedLabelIds: [],
  });
});

describe('useStationDrag — snap engages within a constant screen distance', () => {
  it('zooming in shrinks the world-space snap radius (10px / zoom)', () => {
    setModes({ line: true, all: 'off', grid: 'off' });
    // D and T are line-adjacent on L1 with auto-vertical stops → T defines a
    // vertical snap axis at x=100. Drag D so its proposed X sits 7 world units
    // off that axis, at zoom 2 (so a 7-unit world offset == 14 screen px).
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1', stations: ['D', 'T'] }) },
      lineOrder: ['L1'],
      stations: {
        D: stationWithStop('D' as StationId, 'L1', { x: 0, y: 0 }),
        T: stationWithStop('T' as StationId, 'L1', { x: 100, y: 0 }),
      },
    });

    const svgRef = createRef<SVGSVGElement>() as RefObject<SVGSVGElement | null>;
    const { result } = renderHook(() => useStationDrag(svgRef, 2));

    // Drag D (no shift, snap active) to world (93, 50): screen Δ = (186, 100) at
    // zoom 2. perp dist to axis x=100 is 7.
    result.current.onStartDrag('D' as StationId, pointerEvent({ clientX: 200, clientY: 200 }));
    result.current.onPointerMove(pointerEvent({ clientX: 386, clientY: 300 }));
    result.current.onPointerUp(pointerEvent({ clientX: 386, clientY: 300 }));

    // Screen radius is 10px / 2 = 5 world units; 7 > 5 → no snap, X stays 93.
    expect(useDoc.getState().stations['D'].x).toBeCloseTo(93, 5);
    expect(useDoc.getState().stations['D'].y).toBeCloseTo(50, 5);
  });

  it('snaps a point INSIDE the radius to the axis (positive companion)', () => {
    // Mirror of the negative case at the same zoom. A point 4 world units off
    // the x=100 axis is inside the 5-unit world radius (10px / zoom 2), so it
    // MUST snap to x=100. The negative-only test passes even if snapping is
    // disabled / the tolerance collapses to 0; this one fails in that case.
    setModes({ line: true, all: 'off', grid: 'off' });
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1', stations: ['D', 'T'] }) },
      lineOrder: ['L1'],
      stations: {
        D: stationWithStop('D' as StationId, 'L1', { x: 0, y: 0 }),
        T: stationWithStop('T' as StationId, 'L1', { x: 100, y: 0 }),
      },
    });

    const svgRef = createRef<SVGSVGElement>() as RefObject<SVGSVGElement | null>;
    const { result } = renderHook(() => useStationDrag(svgRef, 2));

    // Drag D to world (96, 50): screen Δ = (192, 100) at zoom 2. Perp dist to
    // axis x=100 is 4 < 5 → snaps.
    result.current.onStartDrag('D' as StationId, pointerEvent({ clientX: 200, clientY: 200 }));
    result.current.onPointerMove(pointerEvent({ clientX: 392, clientY: 300 }));
    result.current.onPointerUp(pointerEvent({ clientX: 392, clientY: 300 }));

    expect(useDoc.getState().stations['D'].x).toBeCloseTo(100, 5);
    expect(useDoc.getState().stations['D'].y).toBeCloseTo(50, 5);
  });
});

describe('useStationDrag — snap-guide identity across moves', () => {
  // Same fixture as the zoom tests above: D and T line-adjacent on L1 with
  // auto-vertical stops, so T defines a vertical snap axis at x=100. Zoom 2 —
  // the snap radius is 5 world units.
  beforeEach(() => {
    setModes({ line: true, all: 'off', grid: 'off' });
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1', stations: ['D', 'T'] }) },
      lineOrder: ['L1'],
      stations: {
        D: stationWithStop('D' as StationId, 'L1', { x: 0, y: 0 }),
        T: stationWithStop('T' as StationId, 'L1', { x: 100, y: 0 }),
      },
    });
  });

  it('keeps the same guides array when a move reproduces the previous guides', () => {
    const svgRef = createRef<SVGSVGElement>() as RefObject<SVGSVGElement | null>;
    const { result } = renderHook(() => useStationDrag(svgRef, 2));

    // World (96, 50): 4 units off the x=100 axis, inside the radius → snaps.
    act(() => {
      result.current.onStartDrag('D' as StationId, pointerEvent({ clientX: 200, clientY: 200 }));
      result.current.onPointerMove(pointerEvent({ clientX: 392, clientY: 300 }));
    });
    const first = result.current.snapGuides;
    expect(first.length).toBeGreaterThan(0); // the snapped move produced guides

    // The identical move again: same snap, value-equal guides — the state must
    // keep the previous array (same reference), not re-render with a fresh one.
    act(() => {
      result.current.onPointerMove(pointerEvent({ clientX: 392, clientY: 300 }));
    });
    expect(result.current.snapGuides).toBe(first);
  });

  it('keeps the initial empty array across no-snap moves (no fresh [] per move)', () => {
    const svgRef = createRef<SVGSVGElement>() as RefObject<SVGSVGElement | null>;
    const { result } = renderHook(() => useStationDrag(svgRef, 2));
    const initial = result.current.snapGuides;

    // World (70, 50): 30 units off the x=100 axis — far outside the radius, so
    // the move produces no guides. No-guides ⇒ no-guides must not mint a new [].
    act(() => {
      result.current.onStartDrag('D' as StationId, pointerEvent({ clientX: 200, clientY: 200 }));
      result.current.onPointerMove(pointerEvent({ clientX: 340, clientY: 300 }));
    });
    expect(result.current.snapGuides).toBe(initial);
  });
});

describe('useStationDrag — pointer capture', () => {
  it('captures the pointer on the first move past threshold and releases on up', () => {
    // The other drag hooks use fakeSvgRef and assert capture; this hook used a
    // bare createRef, so setPointerCapture was a silent no-op and never tested.
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1', stations: ['A'] }) },
      lineOrder: ['L1'],
      stations: { A: stationWithStop('A' as StationId, 'L1', { x: 0, y: 0 }) },
    });
    const { ref, svg } = fakeSvgRef();
    const { result } = renderHook(() => useStationDrag(ref, 1));

    result.current.onStartDrag(
      'A' as StationId,
      pointerEvent({ clientX: 200, clientY: 200, pointerId: 7 }),
    );
    // Not yet captured — capture is deferred to the first move past threshold.
    expect(svg.hasPointerCapture(7)).toBe(false);
    result.current.onPointerMove(pointerEvent({ clientX: 220, clientY: 200, pointerId: 7 }));
    expect(svg.hasPointerCapture(7)).toBe(true);
    result.current.onPointerUp(pointerEvent({ clientX: 220, clientY: 200, pointerId: 7 }));
    expect(svg.hasPointerCapture(7)).toBe(false);
  });
});

describe('useStationDrag — group drag with text labels', () => {
  it('moves a selected text label by the same delta when dragging a selected station', () => {
    // Seed: one line, two stations on it, and a free-floating text label.
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1', stations: ['A', 'B'] }) },
      lineOrder: ['L1'],
      stations: {
        A: stationWithStop('A' as StationId, 'L1', { x: 0, y: 0 }),
        B: stationWithStop('B' as StationId, 'L1', { x: 100, y: 0 }),
      },
      textLabels: {
        g1: makeTextLabel({ id: 'g1', x: 50, y: -50, text: 'Midtown' }),
      },
    });
    useSelection.setState({
      ...useSelection.getState(),
      selectedStationIds: ['A' as StationId, 'B' as StationId],
      selectedLabelIds: ['g1'],
    });

    const svgRef = createRef<SVGSVGElement>() as RefObject<SVGSVGElement | null>;
    const { result } = renderHook(() => useStationDrag(svgRef, 1));

    // Grab station A at screen (200, 200), shift held to bypass snap so the
    // delta in world coords is exact.
    result.current.onStartDrag(
      'A' as StationId,
      pointerEvent({ clientX: 200, clientY: 200, shiftKey: true }),
    );
    // First move past the 4px threshold to register a drag.
    result.current.onPointerMove(pointerEvent({ clientX: 210, clientY: 200, shiftKey: true }));
    // Move to a known delta: +40 in x.
    result.current.onPointerMove(pointerEvent({ clientX: 240, clientY: 200, shiftKey: true }));
    result.current.onPointerUp(pointerEvent({ clientX: 240, clientY: 200 }));

    const doc = useDoc.getState();
    // Grabbed station moved +40 in x.
    expect(doc.stations['A'].x).toBeCloseTo(40, 5);
    expect(doc.stations['A'].y).toBeCloseTo(0, 5);
    // Sibling station B moved by the same delta.
    expect(doc.stations['B'].x).toBeCloseTo(140, 5);
    expect(doc.stations['B'].y).toBeCloseTo(0, 5);
    // The text label was part of the multi-selection — it should travel
    // with the group by the same delta.
    expect(doc.textLabels['g1'].x).toBeCloseTo(90, 5);
    expect(doc.textLabels['g1'].y).toBeCloseTo(-50, 5);
  });

  it('does not move an unselected label when dragging a multi-station group', () => {
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1', stations: ['A', 'B'] }) },
      lineOrder: ['L1'],
      stations: {
        A: stationWithStop('A' as StationId, 'L1', { x: 0, y: 0 }),
        B: stationWithStop('B' as StationId, 'L1', { x: 100, y: 0 }),
      },
      textLabels: {
        g1: makeTextLabel({ id: 'g1', x: 50, y: -50, text: 'Midtown' }),
      },
    });
    useSelection.setState({
      ...useSelection.getState(),
      selectedStationIds: ['A' as StationId, 'B' as StationId],
      selectedLabelIds: [],
    });

    const svgRef = createRef<SVGSVGElement>() as RefObject<SVGSVGElement | null>;
    const { result } = renderHook(() => useStationDrag(svgRef, 1));

    result.current.onStartDrag(
      'A' as StationId,
      pointerEvent({ clientX: 200, clientY: 200, shiftKey: true }),
    );
    result.current.onPointerMove(pointerEvent({ clientX: 210, clientY: 200, shiftKey: true }));
    result.current.onPointerMove(pointerEvent({ clientX: 240, clientY: 200, shiftKey: true }));
    result.current.onPointerUp(pointerEvent({ clientX: 240, clientY: 200 }));

    const doc = useDoc.getState();
    expect(doc.stations['A'].x).toBeCloseTo(40, 5);
    expect(doc.stations['B'].x).toBeCloseTo(140, 5);
    // Unselected label stays put.
    expect(doc.textLabels['g1'].x).toBeCloseTo(50, 5);
    expect(doc.textLabels['g1'].y).toBeCloseTo(-50, 5);
  });
});

describe('useStationDrag — selection-only label group drag', () => {
  it('a single selected station + selected label drags both as a group', () => {
    // Mirrors the bullet behavior: bullets tag along even when the grabbed
    // station is the only station in the selection. Labels should match.
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1', stations: ['A'] }) },
      lineOrder: ['L1'],
      stations: {
        A: stationWithStop('A' as StationId, 'L1', { x: 0, y: 0 }),
      },
      textLabels: {
        g1: makeTextLabel({ id: 'g1', x: 50, y: -50 }),
      },
    });
    useSelection.setState({
      ...useSelection.getState(),
      selectedStationIds: ['A' as StationId],
      selectedLabelIds: ['g1'],
    });

    const svgRef = createRef<SVGSVGElement>() as RefObject<SVGSVGElement | null>;
    const { result } = renderHook(() => useStationDrag(svgRef, 1));

    result.current.onStartDrag(
      'A' as StationId,
      pointerEvent({ clientX: 200, clientY: 200, shiftKey: true }),
    );
    result.current.onPointerMove(pointerEvent({ clientX: 210, clientY: 200, shiftKey: true }));
    result.current.onPointerMove(pointerEvent({ clientX: 230, clientY: 215, shiftKey: true }));
    result.current.onPointerUp(pointerEvent({ clientX: 230, clientY: 215 }));

    const doc = useDoc.getState();
    expect(doc.stations['A'].x).toBeCloseTo(30, 5);
    expect(doc.stations['A'].y).toBeCloseTo(15, 5);
    expect(doc.textLabels['g1'].x).toBeCloseTo(80, 5);
    expect(doc.textLabels['g1'].y).toBeCloseTo(-35, 5);
  });
});

describe('useStationDrag — pointercancel reverts the in-flight drag', () => {
  it('restores the station to its start, pushes no history entry, and disarms the drag', () => {
    // Shift bypasses snap so the live moveStation delta is exact.
    setModes({ line: false, all: 'off', grid: 'off' });
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1', stations: ['A'] }) },
      lineOrder: ['L1'],
      stations: { A: stationWithStop('A' as StationId, 'L1', { x: 0, y: 0 }) },
    });
    const depthBefore = historyDepth();

    const svgRef = createRef<SVGSVGElement>() as RefObject<SVGSVGElement | null>;
    const { result } = renderHook(() => useStationDrag(svgRef, 1));

    result.current.onStartDrag(
      'A' as StationId,
      pointerEvent({ clientX: 200, clientY: 200, shiftKey: true }),
    );
    // Move past threshold: +60 x / +40 y in world (zoom 1). moveStation writes live.
    result.current.onPointerMove(pointerEvent({ clientX: 260, clientY: 240, shiftKey: true }));
    // Sanity: the live drag actually displaced the station before the cancel.
    expect(useDoc.getState().stations['A'].x).toBeCloseTo(60, 5);
    expect(useDoc.getState().stations['A'].y).toBeCloseTo(40, 5);

    // The browser fires pointercancel mid-drag (palm rejection, capture loss).
    result.current.onPointerCancel();

    const doc = useDoc.getState();
    // Reverted to the pre-drag position — the drop was never committed.
    expect(doc.stations['A'].x).toBe(0);
    expect(doc.stations['A'].y).toBe(0);
    // No history entry pushed...
    expect(historyDepth()).toBe(depthBefore);
    // ...and recording resumed (the paused group is closed, not stranded).
    expect(isHistoryGrouping()).toBe(false);

    // The drag ref is cleared: a stray pointermove after cancel is inert (it
    // must NOT resume the drag with no button held).
    result.current.onPointerMove(pointerEvent({ clientX: 400, clientY: 400, shiftKey: true }));
    expect(useDoc.getState().stations['A'].x).toBe(0);
  });
});

describe('useStationDrag — a move with no buttons cancels the dead gesture', () => {
  it('reverts and disarms when a move arrives with buttons === 0 (lost pointerup)', () => {
    // Press → alt-tab → release the button elsewhere → return: no pointerup or
    // pointercancel ever reached the svg (sub-threshold presses hold no
    // capture, and even a captured pointer gets none once the window blurred).
    // The armed ref then sees plain HOVER moves, which arrive with
    // buttons === 0 — they must cancel the gesture, not glue the station to
    // the cursor.
    setModes({ line: false, all: 'off', grid: 'off' });
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1', stations: ['A'] }) },
      lineOrder: ['L1'],
      stations: { A: stationWithStop('A' as StationId, 'L1', { x: 0, y: 0 }) },
    });
    const depthBefore = historyDepth();

    const svgRef = createRef<SVGSVGElement>() as RefObject<SVGSVGElement | null>;
    const { result } = renderHook(() => useStationDrag(svgRef, 1));

    result.current.onStartDrag(
      'A' as StationId,
      pointerEvent({ clientX: 200, clientY: 200, shiftKey: true }),
    );
    result.current.onPointerMove(pointerEvent({ clientX: 260, clientY: 240, shiftKey: true }));
    expect(useDoc.getState().stations['A'].x).toBeCloseTo(60, 5);

    // The first hover move after focus returns: no buttons held.
    result.current.onPointerMove(pointerEvent({ clientX: 400, clientY: 400, buttons: 0 }));

    expect(useDoc.getState().stations['A'].x).toBe(0);
    expect(historyDepth()).toBe(depthBefore);
    expect(isHistoryGrouping()).toBe(false);
    // Disarmed: later moves are inert.
    result.current.onPointerMove(pointerEvent({ clientX: 500, clientY: 500 }));
    expect(useDoc.getState().stations['A'].x).toBe(0);
  });
});

describe('useStationDrag — Ctrl toggles redistribute mode live, mid-drag', () => {
  // A—M—B on one line; M is the intervening stop redistribute reflows. Shift is
  // held throughout to bypass snap so the grabbed station's world position is
  // exact; grid is off so redistribute doesn't round M off the straight line.
  beforeEach(() =>
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1', stations: ['A', 'M', 'B'] }) },
      lineOrder: ['L1'],
      stations: {
        A: stationWithStop('A' as StationId, 'L1', { x: 0, y: 0 }),
        M: stationWithStop('M' as StationId, 'L1', { x: 50, y: 0 }),
        B: stationWithStop('B' as StationId, 'L1', { x: 100, y: 0 }),
      },
    }),
  );

  it('pressing Ctrl mid-drag starts redistributing between the anchor and grab', () => {
    setModes({ line: false, all: 'off', grid: 'off' });
    const svgRef = createRef<SVGSVGElement>() as RefObject<SVGSVGElement | null>;
    const { result } = renderHook(() => useStationDrag(svgRef, 1));

    // A is the captured anchor; grab B. Start the drag: move B to (100, 100)
    // with NO modifier — a plain drag, so M must stay put.
    result.current.onStartDrag(
      'B' as StationId,
      pointerEvent({ clientX: 300, clientY: 200, shiftKey: true }),
      'A' as StationId,
    );
    result.current.onPointerMove(pointerEvent({ clientX: 300, clientY: 300, shiftKey: true }));
    expect(useDoc.getState().stations['M'].x).toBeCloseTo(50, 5);
    expect(useDoc.getState().stations['M'].y).toBeCloseTo(0, 5);

    // Now hold Ctrl and keep dragging (same spot): redistribute kicks in, so M
    // reflows onto the straight A→B line — the midpoint of (0,0)→(100,100).
    result.current.onPointerMove(
      pointerEvent({ clientX: 300, clientY: 300, shiftKey: true, ctrlKey: true }),
    );
    expect(useDoc.getState().stations['M'].x).toBeCloseTo(50, 5);
    expect(useDoc.getState().stations['M'].y).toBeCloseTo(50, 5);
  });

  it('releasing Ctrl mid-drag falls back to a plain drag (stops redistributing)', () => {
    setModes({ line: false, all: 'off', grid: 'off' });
    const svgRef = createRef<SVGSVGElement>() as RefObject<SVGSVGElement | null>;
    const { result } = renderHook(() => useStationDrag(svgRef, 1));

    // Ctrl-drag B to (100, 100): M redistributes to the (0,0)→(100,100) midpoint.
    result.current.onStartDrag(
      'B' as StationId,
      pointerEvent({ clientX: 300, clientY: 200, shiftKey: true }),
      'A' as StationId,
    );
    result.current.onPointerMove(
      pointerEvent({ clientX: 300, clientY: 300, shiftKey: true, ctrlKey: true }),
    );
    expect(useDoc.getState().stations['M'].x).toBeCloseTo(50, 5);
    expect(useDoc.getState().stations['M'].y).toBeCloseTo(50, 5);

    // Release Ctrl and drag B elsewhere (to (300, 0)): now a plain drag, so only
    // B moves — M stays where the last redistribute left it, not reflowed again.
    result.current.onPointerMove(pointerEvent({ clientX: 500, clientY: 200, shiftKey: true }));
    expect(useDoc.getState().stations['B'].x).toBeCloseTo(300, 5);
    expect(useDoc.getState().stations['M'].x).toBeCloseTo(50, 5);
    expect(useDoc.getState().stations['M'].y).toBeCloseTo(50, 5);
  });
});

describe('useStationDrag — locked stations', () => {
  beforeEach(() => setModes({ line: false, all: 'off', grid: 'off' }));

  it('does not move a locked station when dragged', () => {
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1', stations: ['A'] }) },
      lineOrder: ['L1'],
      stations: { A: { ...stationWithStop('A' as StationId, 'L1', { x: 0, y: 0 }), locked: true } },
    });
    const svgRef = createRef<SVGSVGElement>() as RefObject<SVGSVGElement | null>;
    const { result } = renderHook(() => useStationDrag(svgRef, 1));

    result.current.onStartDrag(
      'A' as StationId,
      pointerEvent({ clientX: 200, clientY: 200, shiftKey: true }),
    );
    result.current.onPointerMove(pointerEvent({ clientX: 260, clientY: 240, shiftKey: true }));
    result.current.onPointerUp(pointerEvent({ clientX: 260, clientY: 240 }));

    const doc = useDoc.getState();
    expect(doc.stations['A'].x).toBe(0);
    expect(doc.stations['A'].y).toBe(0);
  });

  it('does not tow a locked sibling in a group drag', () => {
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1', stations: ['A', 'B'] }) },
      lineOrder: ['L1'],
      stations: {
        A: stationWithStop('A' as StationId, 'L1', { x: 0, y: 0 }),
        B: { ...stationWithStop('B' as StationId, 'L1', { x: 100, y: 0 }), locked: true },
      },
    });
    useSelection.setState({
      ...useSelection.getState(),
      selectedStationIds: ['A' as StationId, 'B' as StationId],
    });
    const svgRef = createRef<SVGSVGElement>() as RefObject<SVGSVGElement | null>;
    const { result } = renderHook(() => useStationDrag(svgRef, 1));

    result.current.onStartDrag(
      'A' as StationId,
      pointerEvent({ clientX: 200, clientY: 200, shiftKey: true }),
    );
    result.current.onPointerMove(pointerEvent({ clientX: 210, clientY: 200, shiftKey: true }));
    result.current.onPointerMove(pointerEvent({ clientX: 240, clientY: 200, shiftKey: true }));
    result.current.onPointerUp(pointerEvent({ clientX: 240, clientY: 200 }));

    const doc = useDoc.getState();
    // Grabbed station A moved +40; the locked sibling B stays put.
    expect(doc.stations['A'].x).toBeCloseTo(40, 5);
    expect(doc.stations['B'].x).toBe(100);
    expect(doc.stations['B'].y).toBe(0);
  });
});
