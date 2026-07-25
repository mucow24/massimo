import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePlacementDispatch, snapPlacement } from '../../components/canvas/usePlacementDispatch';
import { makePreviewTextLabel } from '../../components/canvas/LabelPlacingPreview';
import { useDoc, useSelection, type UiMode } from '../../state/store';
import { useSnapPrefs } from '../../state/snapPrefs';
import { useViewportStore } from '../../state/viewportStore';
import { DEFAULT_DOC } from '../../model/transforms';
import { DEFAULT_SNAP_MODES } from '../../geometry/snap';
import { defaultStyleProps } from '../../model/styles';
import { textLabelCorners } from '../../geometry/stationBoundary';
import { pointerEvent } from '../../test/interaction';
import type { ViewportApi } from '../../components/canvas/useViewport';

// Identity screen→world at zoom 1 — same harness as usePlacementDispatch.test.tsx.
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
  useViewportStore.setState({ gridSize: 10 });
  resetSelection({ kind: 'idle' });
});

/**
 * MapCanvas.onPointerMove puts the ghost at snapPlacement's point and renders it
 * with the doc's default textLabel style (LabelPlacingPreview `style` prop).
 * Reproduce that here so the assertion is about the pixels the user sees.
 */
const ghostCorners = (cursor: { x: number; y: number }) => {
  const snapped = snapPlacement(
    { kind: 'placing-label' },
    cursor,
    false,
    useSnapPrefs.getState().modes,
    useViewportStore.getState().gridSize,
    1,
  );
  const doc = useDoc.getState();
  return textLabelCorners(
    makePreviewTextLabel({ x: snapped.x, y: snapped.y }, defaultStyleProps(doc, 'textLabel')),
  );
};

const dropCorners = (cursor: { x: number; y: number }) => {
  resetSelection({ kind: 'placing-label' });
  const { result } = renderHook(() => usePlacementDispatch(fakeView));
  act(() => {
    result.current.handleCanvasPlace(pointerEvent({ clientX: cursor.x, clientY: cursor.y }));
  });
  const label = Object.values(useDoc.getState().textLabels)[0];
  return textLabelCorners(label);
};

describe('placing-label ghost vs drop after the Default label style is redefined', () => {
  it('puts the dropped label exactly where the ghost showed it (snapping on)', () => {
    useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES, grid: 'both' } });
    // Styles panel → textLabel "Default" → 40px. New labels are stamped with the
    // CURRENT default props (store.addTextLabel → S.applyDefaultStyle), and the
    // ghost already renders with them.
    act(() => {
      useDoc.getState().updateStyleProps('default-textLabel', { fontSize: 40 });
    });

    const ghost = ghostCorners({ x: 37, y: 23 });
    const drop = dropCorners({ x: 37, y: 23 });
    // Plumbing sanity: the drop really wears the redefined default.
    expect(Object.values(useDoc.getState().textLabels)[0].fontSize).toBe(40);

    // "preview == commit by construction" (ARCHITECTURE, Placement parity).
    expect(drop[0]).toEqual(ghost[0]);
  });

  it('puts the dropped label exactly where the ghost showed it (all snapping off)', () => {
    useSnapPrefs.setState({
      modes: { ...DEFAULT_SNAP_MODES, line: false, grid: 'off', all: 'off' },
    });
    act(() => {
      useDoc.getState().updateStyleProps('default-textLabel', { fontSize: 40 });
    });

    const ghost = ghostCorners({ x: 37, y: 23 });
    const drop = dropCorners({ x: 37, y: 23 });
    expect(drop[0]).toEqual(ghost[0]);
  });
});
