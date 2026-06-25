import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePlacementDispatch } from './usePlacementDispatch';
import { useDoc, useSelection } from '../../state/store';
import { useSnapPrefs } from '../../state/snapPrefs';
import { DEFAULT_DOC } from '../../model/transforms';
import { DEFAULT_SNAP_MODES } from '../../geometry/snap';
import { makeLine } from '../../test/fixtures';
import { pointerEvent } from '../../test/interaction';
import type { ViewportApi } from './useViewport';
import type { UiMode } from '../../state/store';

// Deterministic station-name preview: the hook pre-rolls a name from
// randomStationName, so a stub sequence lets us assert the reroll precisely.
vi.mock('../../state/stationNames', () => {
  let i = 0;
  const names = ['Alpha', 'Beta', 'Gamma', 'Delta'];
  return { randomStationName: () => names[i++ % names.length] };
});

// Identity screen→world so a click at (cx, cy) lands at world (cx, cy).
const fakeView = { screenToWorld: (x: number, y: number) => ({ x, y }) } as ViewportApi;

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
  // All snap modes off so the placed point is exactly the click world point.
  useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES, grid: 'off' } });
  resetSelection({ kind: 'idle' });
});

describe('usePlacementDispatch', () => {
  it('placing-station: drops a station at the click, named the previewed name, then rerolls', () => {
    resetSelection({ kind: 'placing-station' });
    const { result } = renderHook(() => usePlacementDispatch(fakeView));

    const previewed = result.current.previewName;
    expect(previewed).not.toBeNull();

    let consumed = false;
    act(() => {
      consumed = result.current.handleCanvasPlace(pointerEvent({ clientX: 30, clientY: 40 }));
    });
    expect(consumed).toBe(true);

    const stations = Object.values(useDoc.getState().stations);
    expect(stations).toHaveLength(1);
    expect(stations[0].x).toBe(30);
    expect(stations[0].y).toBe(40);
    expect(stations[0].name).toBe(previewed);
    // The next preview was rerolled to a different name.
    expect(result.current.previewName).not.toBe(previewed);
  });

  it('placing-svg: drops the imported image centered at the click, exits, and selects it', () => {
    resetSelection({
      kind: 'placing-svg',
      image: { href: 'data:image/svg+xml;base64,AAA', width: 80, height: 40 },
    });
    const { result } = renderHook(() => usePlacementDispatch(fakeView));

    let consumed = false;
    act(() => {
      consumed = result.current.handleCanvasPlace(pointerEvent({ clientX: 12, clientY: 34 }));
    });
    expect(consumed).toBe(true);

    const images = Object.values(useDoc.getState().svgImages);
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      x: 12,
      y: 34,
      width: 80,
      height: 40,
      rotation: 0,
      href: 'data:image/svg+xml;base64,AAA',
    });
    expect(useSelection.getState().uiMode.kind).toBe('idle');
    expect(useSelection.getState().selectedSvgImageIds).toEqual([images[0].id]);
  });

  it('creating-route-bullet: adds a bullet bound to the first line in z-order', () => {
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1' }), L2: makeLine({ id: 'L2' }) },
      lineOrder: ['L1', 'L2'],
    });
    resetSelection({ kind: 'creating-route-bullet' });
    const { result } = renderHook(() => usePlacementDispatch(fakeView));

    let consumed = false;
    act(() => {
      consumed = result.current.handleCanvasPlace(pointerEvent({ clientX: 12, clientY: 34 }));
    });
    expect(consumed).toBe(true);

    const bullets = Object.values(useDoc.getState().routeBullets);
    expect(bullets).toHaveLength(1);
    expect(bullets[0].lineId).toBe('L1');
    expect(bullets[0].x).toBe(12);
    expect(bullets[0].y).toBe(34);
  });

  it('placing-label: adds a label, exits to idle, and selects the new label', () => {
    resetSelection({ kind: 'placing-label' });
    const { result } = renderHook(() => usePlacementDispatch(fakeView));

    let consumed = false;
    act(() => {
      consumed = result.current.handleCanvasPlace(pointerEvent({ clientX: 7, clientY: 8 }));
    });
    expect(consumed).toBe(true);

    const labels = Object.keys(useDoc.getState().textLabels);
    expect(labels).toHaveLength(1);
    expect(useSelection.getState().uiMode.kind).toBe('idle');
    expect(useSelection.getState().selectedLabelIds).toContain(labels[0]);
  });

  it('creating-polygon: adds a polygon, exits to idle, and selects it', () => {
    resetSelection({ kind: 'creating-polygon' });
    const { result } = renderHook(() => usePlacementDispatch(fakeView));

    let consumed = false;
    act(() => {
      consumed = result.current.handleCanvasPlace(pointerEvent({ clientX: 1, clientY: 2 }));
    });
    expect(consumed).toBe(true);

    const polys = Object.keys(useDoc.getState().polygons);
    expect(polys).toHaveLength(1);
    expect(useSelection.getState().uiMode.kind).toBe('idle');
    expect(useSelection.getState().selectedPolygonIds).toContain(polys[0]);
  });

  it('idle: returns false (deselect fallthrough) and mutates nothing', () => {
    resetSelection({ kind: 'idle' });
    const { result } = renderHook(() => usePlacementDispatch(fakeView));

    let consumed = true;
    act(() => {
      consumed = result.current.handleCanvasPlace(pointerEvent({ clientX: 9, clientY: 9 }));
    });
    expect(consumed).toBe(false);
    expect(Object.keys(useDoc.getState().stations)).toHaveLength(0);
    expect(Object.keys(useDoc.getState().routeBullets)).toHaveLength(0);
    expect(Object.keys(useDoc.getState().textLabels)).toHaveLength(0);
    expect(Object.keys(useDoc.getState().polygons)).toHaveLength(0);
  });

  it.each<UiMode['kind']>(['creating-line-tag', 'layering'])(
    'exit-only mode %s: returns true and drops to idle without mutating the doc',
    (kind) => {
      resetSelection({ kind } as UiMode);
      const { result } = renderHook(() => usePlacementDispatch(fakeView));

      let consumed = false;
      act(() => {
        consumed = result.current.handleCanvasPlace(pointerEvent({ clientX: 5, clientY: 5 }));
      });
      expect(consumed).toBe(true);
      expect(useSelection.getState().uiMode.kind).toBe('idle');
      expect(Object.keys(useDoc.getState().stations)).toHaveLength(0);
    },
  );

  it('exit-only mode creating-transfer: returns true and drops to idle', () => {
    resetSelection({ kind: 'creating-transfer', anchor: null });
    const { result } = renderHook(() => usePlacementDispatch(fakeView));

    let consumed = false;
    act(() => {
      consumed = result.current.handleCanvasPlace(pointerEvent({ clientX: 5, clientY: 5 }));
    });
    expect(consumed).toBe(true);
    expect(useSelection.getState().uiMode.kind).toBe('idle');
  });
});
