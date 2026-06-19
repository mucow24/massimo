import { describe, it, expect, beforeEach } from 'vitest';
import { createRef, type RefObject } from 'react';
import { renderHook } from '@testing-library/react';
import { useStationDrag } from './useStationDrag';
import { useDoc, useSelection } from '../../state/store';
import { useSnapPrefs } from '../../state/snapPrefs';
import { DEFAULT_DOC } from '../../model/transforms';
import { DEFAULT_SNAP_MODES, type SnapModes } from '../../geometry/snap';
import { makeTextLabel, stationWithStop, makeLine } from '../../test/fixtures';
import type { StationId } from '../../model/types';

const setModes = (partial: Partial<SnapModes>) =>
  useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES, ...partial } });

// Synthesize a React.PointerEvent-ish object exposing only the fields the
// hook actually reads (clientX, clientY, pointerId, shiftKey).
function pointerEvent(opts: {
  clientX: number;
  clientY: number;
  pointerId?: number;
  shiftKey?: boolean;
}): React.PointerEvent {
  return {
    clientX: opts.clientX,
    clientY: opts.clientY,
    pointerId: opts.pointerId ?? 1,
    shiftKey: opts.shiftKey ?? false,
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
