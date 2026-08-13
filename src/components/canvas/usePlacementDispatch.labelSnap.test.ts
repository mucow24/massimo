import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePlacementDispatch, snapPlacement } from '../../components/canvas/usePlacementDispatch';
import { makePreviewTextLabel } from '../../components/canvas/LabelPlacingPreview';
import { useDoc, useSelection, type UiMode } from '../../state/store';
import { useSnapPrefs } from '../../state/snapPrefs';
import { useViewportStore } from '../../state/viewportStore';
import { DEFAULT_DOC } from '../../model/transforms';
import { defaultStyleProps } from '../../model/styles';
import { DEFAULT_SNAP_MODES, snapPointToGrid } from '../../geometry/snap';
import { polygonSnapAnchor } from '../../geometry/polygon';
import { textLabelAlignCorners } from '../../geometry/stationBoundary';
import { pointerEvent } from '../../test/interaction';
import type { ViewportApi } from '../../components/canvas/useViewport';

// Identity screen→world, zoom 1 — same harness as usePlacementDispatch.test.tsx.
const fakeView = {
  screenToWorld: (x: number, y: number) => ({ x, y }),
  viewport: { x: 0, y: 0, zoom: 1 },
} as ViewportApi;

const resetSelection = (uiMode: UiMode) =>
  useSelection.setState({
    ...useSelection.getState(),
    uiMode,
    selectedStationIds: [],
    selectedRouteBulletIds: [],
    selectedLabelIds: [],
    selectedPolygonIds: [],
    selectedSvgImageIds: [],
  });

beforeEach(() => {
  localStorage.clear();
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
  useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES, grid: 'both' } });
  resetSelection({ kind: 'idle' });
});

// Drop one label in placing-label mode at the given client point.
const place = (cx: number, cy: number) => {
  resetSelection({ kind: 'placing-label' });
  const { result } = renderHook(() => usePlacementDispatch(fakeView));
  act(() => {
    result.current.handleCanvasPlace(pointerEvent({ clientX: cx, clientY: cy }));
  });
  return Object.values(useDoc.getState().textLabels)[0];
};

describe('placing-label snap vs. the doc-default label style', () => {
  it('the ghost preview lands where the drop lands (snapPlacement docstring parity)', () => {
    // Redefine the designated "Default" text-label style — what the Styles
    // panel editors / define-by-example do. New labels are stamped with it
    // (store.addTextLabel → S.applyDefaultStyle), and LabelPlacingPreview
    // renders the ghost wearing it.
    act(() => {
      useDoc.getState().updateStyleProps('default-textLabel', { fontSize: 40, weight: 700 });
    });
    const style = defaultStyleProps(useDoc.getState(), 'textLabel');

    // The ghost the user sees this frame: a real-styled label centered on the
    // snapPlacement result (MapCanvas: setCursorWorld({x: snap.x, y: snap.y})).
    const snap = snapPlacement(
      { kind: 'placing-label' },
      { x: 37, y: 23 },
      false,
      useSnapPrefs.getState().modes,
      useViewportStore.getState().gridSize,
      1,
    );
    const ghost = polygonSnapAnchor(textLabelAlignCorners(makePreviewTextLabel(snap, style)));

    const label = place(37, 23);
    expect(label.fontSize).toBe(40); // sanity: the drop wears the default style
    const dropped = polygonSnapAnchor(textLabelAlignCorners(label));

    // Preview must match the placed position.
    expect(ghost.x).toBeCloseTo(dropped.x, 5);
    expect(ghost.y).toBeCloseTo(dropped.y, 5);
  });

  it('the ghost preview lands where the drop lands with ALL snapping off', () => {
    // The unsnapped arm of the same parity rule: with every mode off the drop
    // point is the raw cursor, so this catches a ghost/commit divergence that
    // grid snapping would otherwise round away. (Ported from the former
    // usePlacementDispatch.labelDrop.test.ts, whose other case was a duplicate
    // of the parity test above.)
    useSnapPrefs.setState({
      modes: { ...DEFAULT_SNAP_MODES, line: false, grid: 'off', all: 'off' },
    });
    act(() => {
      useDoc.getState().updateStyleProps('default-textLabel', { fontSize: 40 });
    });
    const style = defaultStyleProps(useDoc.getState(), 'textLabel');

    const snap = snapPlacement(
      { kind: 'placing-label' },
      { x: 37, y: 23 },
      false,
      useSnapPrefs.getState().modes,
      useViewportStore.getState().gridSize,
      1,
    );
    const ghost = polygonSnapAnchor(textLabelAlignCorners(makePreviewTextLabel(snap, style)));

    const label = place(37, 23);
    expect(label.fontSize).toBe(40); // sanity: the drop wears the default style
    const dropped = polygonSnapAnchor(textLabelAlignCorners(label));

    expect(ghost.x).toBeCloseTo(dropped.x, 5);
    expect(ghost.y).toBeCloseTo(dropped.y, 5);
  });

  it('a center-aligned default style still drops the label onto the guide it snapped to', () => {
    act(() => {
      useDoc
        .getState()
        .updateStyleProps('default-textLabel', { fontSize: 40, weight: 700, align: 'center' });
    });

    const label = place(37, 23);
    expect(label.align).toBe('center'); // sanity: the default style really applied

    // Grid snapping is on, so the label's drag reference point (its ALIGNMENT
    // box's topmost-then-leftmost corner, per useItemDrag) must land ON the grid.
    const anchor = polygonSnapAnchor(textLabelAlignCorners(label));
    const onGrid = snapPointToGrid(anchor.x, anchor.y, 'both');
    expect(anchor.x).toBeCloseTo(onGrid.x, 5);
    expect(anchor.y).toBeCloseTo(onGrid.y, 5);
  });
});
