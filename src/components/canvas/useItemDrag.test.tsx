import { describe, it, expect, beforeEach } from 'vitest';
import { createRef, type RefObject } from 'react';
import { renderHook } from '@testing-library/react';
import { useItemDrag } from './useItemDrag';
import { useDoc, useSelection, dragState } from '../../state/store';
import { useSnapPrefs } from '../../state/snapPrefs';
import { DEFAULT_DOC } from '../../model/transforms';
import { DEFAULT_SNAP_MODES, type SnapModes } from '../../geometry/snap';
import { stationWithStop, makeLine } from '../../test/fixtures';
import type { StationId } from '../../model/types';

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
    selectedStationIds: [],
    selectedRouteBulletIds: [],
    selectedLabelIds: [],
    selectedPolygonIds: [],
  });
  setModes({ line: true, all: 'off', grid: 'off' });
  dragState.suppressClick = false;
});

describe('useItemDrag — bullet snap engages within a constant screen distance', () => {
  it('zooming in shrinks the world-space bullet snap radius (10px / zoom)', () => {
    // Station A has an auto-vertical stop on L1 at (0,0) → a vertical snap axis
    // at x=0. The bullet b1 is bound to L1, so it snaps onto that axis.
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1', stations: ['A'] }) },
      lineOrder: ['L1'],
      stations: { A: stationWithStop('A' as StationId, 'L1', { x: 0, y: 0 }) },
      routeBullets: {
        b1: { id: 'b1', x: 50, y: 50, rotation: 0, lineId: 'L1', shape: 'circle', size: 8 },
      },
    });

    const svgRef = createRef<SVGSVGElement>() as RefObject<SVGSVGElement | null>;
    const { result } = renderHook(() => useItemDrag(svgRef, 2, false));

    // Drag b1 (unselected → not a group drag; no shift) to world (7, 50): screen
    // Δ = (-86, 0) at zoom 2. perp dist to axis x=0 is 7.
    result.current.onBulletPointerDown('b1', pointerEvent({ clientX: 200, clientY: 200 }));
    result.current.onPointerMove(pointerEvent({ clientX: 114, clientY: 200 }));
    result.current.onPointerUp(pointerEvent({ clientX: 114, clientY: 200 }));

    // Screen radius is 10px / 2 = 5 world units; 7 > 5 → no snap, X stays 7.
    expect(useDoc.getState().routeBullets['b1'].x).toBeCloseTo(7, 5);
    expect(useDoc.getState().routeBullets['b1'].y).toBeCloseTo(50, 5);
  });
});
