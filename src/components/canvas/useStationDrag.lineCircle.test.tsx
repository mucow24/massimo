import { describe, it, expect, beforeEach } from 'vitest';
import { createRef, type RefObject } from 'react';
import { act, renderHook } from '@testing-library/react';
import { useStationDrag } from './useStationDrag';
import { useDoc, useSelection } from '../../state/store';
import { useSnapPrefs } from '../../state/snapPrefs';
import { DEFAULT_DOC } from '../../model/transforms';
import { DEFAULT_SNAP_MODES } from '../../geometry/snap';
import { stopPosWorld } from '../../geometry/interlining';
import { STOP_SIZE } from '../../geometry/orientation';
import { makeLine, makeLineCircle, makeStation, makeStop } from '../../test/fixtures';
import type { StationId } from '../../model/types';

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
    ctrlKey: false,
    metaKey: false,
    buttons: opts.buttons ?? 1,
  } as unknown as React.PointerEvent;
}

// Circle at (100,100), radius 70; zoom 1 so screen deltas are world deltas.
// Capture tolerance is 10; the release band is 3× = 30.
const CIRCLE = makeLineCircle({ id: 'c1', x: 100, y: 100, radius: 70 });

function seed(station: ReturnType<typeof makeStation>) {
  useDoc.setState({
    ...useDoc.getState(),
    ...DEFAULT_DOC,
    stations: { [station.id]: station },
    lineCircles: { c1: CIRCLE },
  });
}

function dragHook() {
  const svgRef = createRef<SVGSVGElement>() as RefObject<SVGSVGElement | null>;
  return renderHook(() => useStationDrag(svgRef, 1)).result;
}

const distFromCenter = (st: { x: number; y: number }) =>
  Math.hypot(st.x - CIRCLE.x, st.y - CIRCLE.y);

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
  useSelection.setState({
    ...useSelection.getState(),
    selectedStationIds: [],
    selectedLineCircleIds: [],
  });
  // Every alignment mode off: the ring capture is what's under test.
  useSnapPrefs.setState({
    modes: { ...DEFAULT_SNAP_MODES, line: false, all: 'off', grid: 'off' },
  });
});

describe('useStationDrag — line-circle binding', () => {
  it('a free station dragged onto a rim binds, projects and takes the tangent octant', () => {
    seed(makeStation({ id: 'D', x: 200, y: 100 }));
    const result = dragHook();
    // Cursor ends at (175, 100): 5 world units off the rim — inside capture.
    result.current.onStartDrag('D' as StationId, pointerEvent({ clientX: 300, clientY: 300 }));
    result.current.onPointerMove(pointerEvent({ clientX: 275, clientY: 300 }));
    result.current.onPointerUp(pointerEvent({ clientX: 275, clientY: 300 }));
    const st = useDoc.getState().stations['D'];
    expect(st.circleId).toBe('c1');
    expect(st.x).toBeCloseTo(170, 6);
    expect(st.y).toBeCloseTo(100, 6);
    expect(st.rotation).toBe(0); // tangent at the east point, label upright
  });

  it('a bound station slides ALONG the circle while the cursor stays in the release band', () => {
    seed(makeStation({ id: 'S', x: 170, y: 100, rotation: 0, circleId: 'c1' }));
    const result = dragHook();
    // Cursor to (110, 190): 20.6 off the rim — inside the 30-unit band.
    result.current.onStartDrag('S' as StationId, pointerEvent({ clientX: 300, clientY: 300 }));
    result.current.onPointerMove(pointerEvent({ clientX: 240, clientY: 390 }));
    result.current.onPointerUp(pointerEvent({ clientX: 240, clientY: 390 }));
    const st = useDoc.getState().stations['S'];
    expect(st.circleId).toBe('c1');
    expect(distFromCenter(st)).toBeCloseTo(70, 6);
    // Near the south point: tangent is horizontal → rotation 2.
    expect(st.rotation).toBe(2);
  });

  it('pulling past the release band detaches and follows the cursor', () => {
    seed(makeStation({ id: 'S', x: 170, y: 100, rotation: 0, circleId: 'c1' }));
    const result = dragHook();
    // Cursor to (300, 100): 130 off the rim — far past the band.
    result.current.onStartDrag('S' as StationId, pointerEvent({ clientX: 300, clientY: 300 }));
    result.current.onPointerMove(pointerEvent({ clientX: 430, clientY: 300 }));
    result.current.onPointerUp(pointerEvent({ clientX: 430, clientY: 300 }));
    const st = useDoc.getState().stations['S'];
    expect(st.circleId).toBeUndefined();
    expect(st.x).toBeCloseTo(300, 6);
    expect(st.y).toBeCloseTo(100, 6);
  });

  it('Shift detaches instantly, even inside the band', () => {
    seed(makeStation({ id: 'S', x: 170, y: 100, rotation: 0, circleId: 'c1' }));
    const result = dragHook();
    // A tiny move that stays ON the rim's neighborhood — but Shift is held.
    result.current.onStartDrag('S' as StationId, pointerEvent({ clientX: 300, clientY: 300 }));
    result.current.onPointerMove(pointerEvent({ clientX: 308, clientY: 300, shiftKey: true }));
    result.current.onPointerUp(pointerEvent({ clientX: 308, clientY: 300, shiftKey: true }));
    const st = useDoc.getState().stations['S'];
    expect(st.circleId).toBeUndefined();
    expect(st.x).toBeCloseTo(178, 6);
  });

  // Cursor points below sit exactly ON the rim, so capture/release never enter
  // into it — only WHERE along the rim the seat lands. Coordinates are the rim
  // point at the stated polar angle, converted to screen by the grab offset.
  describe('cardinal magnetism (modes.circle)', () => {
    const cardinalsOn = () =>
      useSnapPrefs.setState({
        modes: { ...DEFAULT_SNAP_MODES, line: false, all: 'off', grid: 'off', circle: true },
      });

    it('pulls a free station onto the 9 o’clock cardinal exactly', () => {
      cardinalsOn();
      seed(makeStation({ id: 'D', x: 200, y: 100 }));
      const result = dragHook();
      // Rim point at θ = π − 0.06: 4.2 units of arc shy of due west.
      result.current.onStartDrag('D' as StationId, pointerEvent({ clientX: 300, clientY: 300 }));
      result.current.onPointerMove(pointerEvent({ clientX: 130.125962, clientY: 304.19748 }));
      result.current.onPointerUp(pointerEvent({ clientX: 130.125962, clientY: 304.19748 }));
      const st = useDoc.getState().stations['D'];
      expect(st.circleId).toBe('c1');
      expect(st.x).toBeCloseTo(30, 6);
      expect(st.y).toBeCloseTo(100, 6);
      // Tangent at due west is vertical, same as at due east.
      expect(st.rotation).toBe(0);
    });

    it('leaves the same drag un-quantized when cardinals are off', () => {
      // The control: proves the assertion above is the mode's doing, not the
      // plain rim projection landing there anyway.
      seed(makeStation({ id: 'D', x: 200, y: 100 }));
      const result = dragHook();
      result.current.onStartDrag('D' as StationId, pointerEvent({ clientX: 300, clientY: 300 }));
      result.current.onPointerMove(pointerEvent({ clientX: 130.125962, clientY: 304.19748 }));
      result.current.onPointerUp(pointerEvent({ clientX: 130.125962, clientY: 304.19748 }));
      const st = useDoc.getState().stations['D'];
      expect(st.x).toBeCloseTo(30.125962, 5);
      expect(st.y).toBeCloseTo(104.19748, 5);
    });

    it('leaves a seat far from every cardinal alone', () => {
      cardinalsOn();
      seed(makeStation({ id: 'D', x: 200, y: 100 }));
      const result = dragHook();
      // θ = 0.4 rad — 27 units of arc from the nearest cardinal, well outside.
      result.current.onStartDrag('D' as StationId, pointerEvent({ clientX: 300, clientY: 300 }));
      result.current.onPointerMove(pointerEvent({ clientX: 264.47427, clientY: 327.259284 }));
      result.current.onPointerUp(pointerEvent({ clientX: 264.47427, clientY: 327.259284 }));
      const st = useDoc.getState().stations['D'];
      expect(st.x).toBeCloseTo(164.47427, 5);
      expect(st.y).toBeCloseTo(127.259284, 5);
    });

    it('notches a BOUND station sliding along the ring onto 6 o’clock', () => {
      cardinalsOn();
      seed(makeStation({ id: 'S', x: 170, y: 100, rotation: 0, circleId: 'c1' }));
      const result = dragHook();
      // θ = π/2 − 0.05: 3.5 units of arc shy of due south.
      result.current.onStartDrag('S' as StationId, pointerEvent({ clientX: 300, clientY: 300 }));
      result.current.onPointerMove(pointerEvent({ clientX: 233.498542, clientY: 369.912518 }));
      result.current.onPointerUp(pointerEvent({ clientX: 233.498542, clientY: 369.912518 }));
      const st = useDoc.getState().stations['S'];
      expect(st.circleId).toBe('c1');
      expect(st.x).toBeCloseTo(100, 6);
      expect(st.y).toBeCloseTo(170, 6);
      expect(st.rotation).toBe(2); // horizontal tangent at the south point
    });

    it('still detaches on Shift — cardinals must not revive a bypassed snap', () => {
      cardinalsOn();
      seed(makeStation({ id: 'S', x: 170, y: 100, rotation: 0, circleId: 'c1' }));
      const result = dragHook();
      result.current.onStartDrag('S' as StationId, pointerEvent({ clientX: 300, clientY: 300 }));
      result.current.onPointerMove(pointerEvent({ clientX: 308, clientY: 300, shiftKey: true }));
      result.current.onPointerUp(pointerEvent({ clientX: 308, clientY: 300, shiftKey: true }));
      const st = useDoc.getState().stations['S'];
      expect(st.circleId).toBeUndefined();
      expect(st.x).toBeCloseTo(178, 6);
    });

    it('tows group siblings by the QUANTIZED delta, not the raw one', () => {
      // The master's seat and the siblings' translation must come from ONE
      // point. Reading the cursor for one and the seat for the other leaves the
      // group sheared by however far the cardinal pull moved the master.
      cardinalsOn();
      useDoc.setState({
        ...useDoc.getState(),
        ...DEFAULT_DOC,
        stations: {
          S: makeStation({ id: 'S', x: 170, y: 100, rotation: 0, circleId: 'c1' }),
          T: makeStation({ id: 'T', x: 400, y: 400 }),
        },
        lineCircles: { c1: CIRCLE },
      });
      useSelection.setState({
        ...useSelection.getState(),
        selectedStationIds: ['S' as StationId, 'T' as StationId],
      });
      const result = dragHook();
      result.current.onStartDrag('S' as StationId, pointerEvent({ clientX: 300, clientY: 300 }));
      result.current.onPointerMove(pointerEvent({ clientX: 233.498542, clientY: 369.912518 }));
      result.current.onPointerUp(pointerEvent({ clientX: 233.498542, clientY: 369.912518 }));
      const doc = useDoc.getState();
      expect(doc.stations['S'].x).toBeCloseTo(100, 6);
      expect(doc.stations['S'].y).toBeCloseTo(170, 6);
      // Master moved (−70, +70) from its start, so the sibling must too.
      expect(doc.stations['T'].x).toBeCloseTo(330, 6);
      expect(doc.stations['T'].y).toBeCloseTo(470, 6);
    });

    it('stands down entirely when the ring itself is towed', () => {
      // `ringTowed` skips the whole circle block, cardinals included: with the
      // ring travelling too there is no rim to seat against, so the assembly
      // translates rigidly even though the drag ends near a cardinal.
      cardinalsOn();
      seed(makeStation({ id: 'S', x: 170, y: 100, rotation: 0, circleId: 'c1' }));
      useSelection.setState({
        ...useSelection.getState(),
        selectedStationIds: ['S' as StationId],
        selectedLineCircleIds: ['c1'],
      });
      const result = dragHook();
      result.current.onStartDrag('S' as StationId, pointerEvent({ clientX: 300, clientY: 300 }));
      result.current.onPointerMove(pointerEvent({ clientX: 300, clientY: 260 }));
      result.current.onPointerUp(pointerEvent({ clientX: 300, clientY: 260 }));
      const doc = useDoc.getState();
      // Straight up by 40, NOT pulled to a cardinal of the moved ring.
      expect(doc.lineCircles.c1).toMatchObject({ x: 100, y: 60 });
      expect(doc.stations['S'].x).toBeCloseTo(170, 6);
      expect(doc.stations['S'].y).toBeCloseTo(60, 6);
    });
  });

  it('a bound station co-selected WITH its ring drags the whole assembly rigidly', () => {
    seed(makeStation({ id: 'S', x: 170, y: 100, rotation: 0, circleId: 'c1' }));
    useSelection.setState({
      ...useSelection.getState(),
      selectedStationIds: ['S'],
      selectedLineCircleIds: ['c1'],
    });
    const result = dragHook();
    // Straight up: on a lone bound station this would slide it round the rim
    // (the constraint). With the ring towed there is nothing to slide against —
    // the ring travels too, so station and center both move by (0, -40).
    result.current.onStartDrag('S' as StationId, pointerEvent({ clientX: 300, clientY: 300 }));
    result.current.onPointerMove(pointerEvent({ clientX: 300, clientY: 260 }));
    result.current.onPointerUp(pointerEvent({ clientX: 300, clientY: 260 }));
    const doc = useDoc.getState();
    expect(doc.lineCircles.c1).toMatchObject({ x: 100, y: 60 });
    expect(doc.stations['S'].x).toBeCloseTo(170, 6);
    expect(doc.stations['S'].y).toBeCloseTo(60, 6);
    // Still bound, still seated on the rim at its original angle.
    expect(doc.stations['S'].circleId).toBe('c1');
    expect(doc.stations['S'].rotation).toBe(0);
  });

  it('keeps the towed assembly bound even when Shift bypasses snapping', () => {
    // Shift on a lone bound station detaches it; with the ring coming along
    // there is no constraint to bypass, so the binding survives.
    seed(makeStation({ id: 'S', x: 170, y: 100, rotation: 0, circleId: 'c1' }));
    useSelection.setState({
      ...useSelection.getState(),
      selectedStationIds: ['S'],
      selectedLineCircleIds: ['c1'],
    });
    const result = dragHook();
    result.current.onStartDrag('S' as StationId, pointerEvent({ clientX: 300, clientY: 300 }));
    result.current.onPointerMove(pointerEvent({ clientX: 320, clientY: 300, shiftKey: true }));
    result.current.onPointerUp(pointerEvent({ clientX: 320, clientY: 300, shiftKey: true }));
    const doc = useDoc.getState();
    expect(doc.stations['S'].circleId).toBe('c1');
    expect(doc.lineCircles.c1).toMatchObject({ x: 120, y: 100 });
    expect(doc.stations['S'].x).toBeCloseTo(190, 6);
  });

  // A straight cursor path across a wide arc dips far inside the rim — 55
  // units at the sweep below — so an ordinary "slide it round the ring" drag
  // leaves the release band partway and re-captures at the far end. The
  // station's cells are untouched by that round trip, but the rotation it
  // carries is the seat it LEFT, so a plain re-bind re-reads the layout
  // through a frame a quarter turn out and mirrors the lanes across the rim.
  describe('an escape and return inside one drag', () => {
    // A big ring, centered on the origin, so the seat angles are readable.
    const BIG = makeLineCircle({ id: 'big', x: 0, y: 0, radius: 300 });
    const rim = (deg: number) => ({
      x: BIG.radius * Math.cos((deg * Math.PI) / 180),
      y: BIG.radius * Math.sin((deg * Math.PI) / 180),
    });
    const laneRadius = (lineId: string) => {
      const doc = useDoc.getState();
      const st = doc.stations['S'];
      const p = stopPosWorld(st.stops.find((c) => c.lineId === lineId)!, st, doc.lineCircles);
      return Math.hypot(p.x - BIG.x, p.y - BIG.y);
    };

    function seedTwoLane() {
      const at = rim(130);
      useDoc.setState({
        ...useDoc.getState(),
        ...DEFAULT_DOC,
        lineCircles: { big: BIG },
        stations: {
          // The seat at 130° reads its radial frame a half turn from local +x,
          // so the lane OUTSIDE the ring is col −1 there.
          S: makeStation({
            id: 'S',
            ...at,
            rotation: 7,
            circleId: 'big',
            stops: [
              makeStop('l1', { viaCircle: true }),
              makeStop('l2', { col: -1, viaCircle: true }),
            ],
          }),
        },
        lines: {
          l1: makeLine({ id: 'l1', stations: ['S' as StationId] }),
          l2: makeLine({ id: 'l2', stations: ['S' as StationId] }),
        },
      });
      useDoc.temporal.getState().clear();
    }

    it('keeps the outer lane outside when the ring re-captures the station', () => {
      seedTwoLane();
      expect(laneRadius('l2')).toBeCloseTo(BIG.radius + STOP_SIZE, 6);
      const result = dragHook();
      const from = rim(130);
      const to = rim(60);
      result.current.onStartDrag('S' as StationId, pointerEvent({ clientX: 1000, clientY: 1000 }));
      let escaped = false;
      for (let i = 1; i <= 8; i++) {
        const t = i / 8;
        act(() =>
          result.current.onPointerMove(
            pointerEvent({
              clientX: 1000 + (to.x - from.x) * t,
              clientY: 1000 + (to.y - from.y) * t,
            }),
          ),
        );
        if (useDoc.getState().stations['S'].circleId === undefined) escaped = true;
      }
      result.current.onPointerUp(
        pointerEvent({ clientX: 1000 + (to.x - from.x), clientY: 1000 + (to.y - from.y) }),
      );
      // The round trip really happened — otherwise this test proves nothing.
      expect(escaped).toBe(true);
      const st = useDoc.getState().stations['S'];
      expect(st.circleId).toBe('big');
      expect(Math.hypot(st.x, st.y)).toBeCloseTo(BIG.radius, 6);
      expect(laneRadius('l1')).toBeCloseTo(BIG.radius, 6);
      expect(laneRadius('l2')).toBeCloseTo(BIG.radius + STOP_SIZE, 6);
    });

    it('still folds the whole round trip into one undo', () => {
      seedTwoLane();
      const before = useDoc.getState().stations['S'];
      const result = dragHook();
      const from = rim(130);
      const to = rim(60);
      result.current.onStartDrag('S' as StationId, pointerEvent({ clientX: 1000, clientY: 1000 }));
      for (let i = 1; i <= 8; i++) {
        const t = i / 8;
        act(() =>
          result.current.onPointerMove(
            pointerEvent({
              clientX: 1000 + (to.x - from.x) * t,
              clientY: 1000 + (to.y - from.y) * t,
            }),
          ),
        );
      }
      result.current.onPointerUp(
        pointerEvent({ clientX: 1000 + (to.x - from.x), clientY: 1000 + (to.y - from.y) }),
      );
      act(() => useDoc.temporal.getState().undo());
      expect(useDoc.getState().stations['S']).toEqual(before);
      expect(useDoc.temporal.getState().pastStates.length).toBe(0);
    });
  });

  it('one undo reverts a bind-drag entirely (binding included)', () => {
    seed(makeStation({ id: 'D', x: 200, y: 100 }));
    const result = dragHook();
    result.current.onStartDrag('D' as StationId, pointerEvent({ clientX: 300, clientY: 300 }));
    result.current.onPointerMove(pointerEvent({ clientX: 275, clientY: 300 }));
    result.current.onPointerUp(pointerEvent({ clientX: 275, clientY: 300 }));
    expect(useDoc.getState().stations['D'].circleId).toBe('c1');
    useDoc.temporal.getState().undo();
    const st = useDoc.getState().stations['D'];
    expect(st.circleId).toBeUndefined();
    expect(st.x).toBe(200);
    expect(st.y).toBe(100);
  });
});
