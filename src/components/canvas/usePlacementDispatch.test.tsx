import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePlacementDispatch } from './usePlacementDispatch';
import { useDoc, useSelection } from '../../state/store';
import { useSnapPrefs } from '../../state/snapPrefs';
import { DEFAULT_DOC, starterPolygonVertices, TEXT_LABEL_DEFAULTS } from '../../model/transforms';
import { DEFAULT_SNAP_MODES, snapPointToGrid } from '../../geometry/snap';
import { polygonSnapAnchor } from '../../geometry/polygon';
import { measureTextLabel } from '../../geometry/textMeasure';
import { makeLine, stationWithStop } from '../../test/fixtures';
import { pointerEvent } from '../../test/interaction';
import { pairKeyOf } from '../../model/pairKey';
import type { StationId } from '../../model/types';
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
// snapPlacement reads the zoom for its screen-px tolerance scaling.
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

// The appending-to-line branch of handleCanvasPlace (and runAppendCreate's
// seed/connect arms) reached only via this hook — the splice arm is covered
// through MapCanvas's on-segment alt-pick, but the empty-canvas alt-click that
// the extraction was meant to keep in lock-step with it lives here.
describe('handleCanvasPlace — appending-to-line (Edit Stops)', () => {
  const cursorOf = () => {
    const m = useSelection.getState().uiMode;
    return m.kind === 'appending-to-line' ? m.cursor : undefined;
  };

  it('alt-click on the empty-line seed creates a station, adds it, and arms it', () => {
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1', stations: [] }) },
      lineOrder: ['L1'],
    });
    resetSelection({ kind: 'appending-to-line', lineId: 'L1', cursor: null });
    const { result } = renderHook(() => usePlacementDispatch(fakeView));

    let consumed = false;
    act(() => {
      consumed = result.current.handleCanvasPlace(
        pointerEvent({ clientX: 20, clientY: 30, altKey: true }),
      );
    });
    expect(consumed).toBe(true);

    const stations = Object.values(useDoc.getState().stations);
    expect(stations).toHaveLength(1);
    expect(stations[0]).toMatchObject({ x: 20, y: 30 });
    expect(useDoc.getState().lines.L1.stations).toEqual([stations[0].id]);
    expect(cursorOf()).toEqual({ kind: 'station', stationId: stations[0].id });
  });

  it('alt-click with a station cursor connects a new station and advances the pen', () => {
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1', stations: ['S'] }) },
      lineOrder: ['L1'],
      stations: { S: stationWithStop('S' as StationId, 'L1', { x: 0, y: 0 }) },
    });
    resetSelection({
      kind: 'appending-to-line',
      lineId: 'L1',
      cursor: { kind: 'station', stationId: 'S' as StationId },
    });
    const { result } = renderHook(() => usePlacementDispatch(fakeView));

    act(() => {
      result.current.handleCanvasPlace(pointerEvent({ clientX: 40, clientY: 0, altKey: true }));
    });

    const line = useDoc.getState().lines.L1;
    const nid = line.stations.find((id) => id !== 'S');
    expect(nid).toBeDefined();
    expect(useDoc.getState().stations[nid as string]).toMatchObject({ x: 40, y: 0 });
    expect(line.edges).toContain(pairKeyOf('S' as StationId, nid as StationId));
    expect(cursorOf()).toEqual({ kind: 'station', stationId: nid });
  });

  it('one undo removes the connected station and its edge together (grouped)', () => {
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1', stations: ['S'] }) },
      lineOrder: ['L1'],
      stations: { S: stationWithStop('S' as StationId, 'L1', { x: 0, y: 0 }) },
    });
    resetSelection({
      kind: 'appending-to-line',
      lineId: 'L1',
      cursor: { kind: 'station', stationId: 'S' as StationId },
    });
    const { result } = renderHook(() => usePlacementDispatch(fakeView));

    act(() => {
      result.current.handleCanvasPlace(pointerEvent({ clientX: 40, clientY: 0, altKey: true }));
    });
    const nid = useDoc.getState().lines.L1.stations.find((id) => id !== 'S');
    expect(useDoc.getState().stations[nid as string]).toBeDefined();

    act(() => useDoc.temporal.getState().undo());

    expect(useDoc.getState().lines.L1.stations).toEqual(['S']);
    expect(useDoc.getState().stations[nid as string]).toBeUndefined();
  });

  it('plain click with a cursor backs it out to null and mutates nothing', () => {
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1', stations: ['S'] }) },
      lineOrder: ['L1'],
      stations: { S: stationWithStop('S' as StationId, 'L1', { x: 0, y: 0 }) },
    });
    resetSelection({
      kind: 'appending-to-line',
      lineId: 'L1',
      cursor: { kind: 'station', stationId: 'S' as StationId },
    });
    const { result } = renderHook(() => usePlacementDispatch(fakeView));

    let consumed = false;
    act(() => {
      consumed = result.current.handleCanvasPlace(pointerEvent({ clientX: 40, clientY: 0 }));
    });
    expect(consumed).toBe(true);
    expect(cursorOf()).toBeNull();
    expect(useDoc.getState().lines.L1.stations).toEqual(['S']); // no new station
  });

  it('plain click with no cursor exits Edit Stops to idle', () => {
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1', stations: ['S'] }) },
      lineOrder: ['L1'],
      stations: { S: stationWithStop('S' as StationId, 'L1', { x: 0, y: 0 }) },
    });
    resetSelection({ kind: 'appending-to-line', lineId: 'L1', cursor: null });
    const { result } = renderHook(() => usePlacementDispatch(fakeView));

    act(() => {
      result.current.handleCanvasPlace(pointerEvent({ clientX: 40, clientY: 0 }));
    });
    expect(useSelection.getState().uiMode.kind).toBe('idle');
  });

  it('a deleted line under the cursor cancels the mode instead of throwing', () => {
    // No L1 in the doc: the branch must fall back to cancelAppendMode.
    resetSelection({ kind: 'appending-to-line', lineId: 'L1', cursor: null });
    const { result } = renderHook(() => usePlacementDispatch(fakeView));

    let consumed = false;
    act(() => {
      consumed = result.current.handleCanvasPlace(
        pointerEvent({ clientX: 5, clientY: 5, altKey: true }),
      );
    });
    expect(consumed).toBe(true);
    expect(useSelection.getState().uiMode.kind).toBe('idle');
    expect(Object.keys(useDoc.getState().stations)).toHaveLength(0);
  });
});

describe('handleCanvasPlace — placement snaps exactly like the first drag would', () => {
  const gridBoth = () => useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES, grid: 'both' } });

  it('placing-station: Shift-click bypasses the grid', () => {
    gridBoth();
    resetSelection({ kind: 'placing-station' });
    const { result } = renderHook(() => usePlacementDispatch(fakeView));
    act(() => {
      result.current.handleCanvasPlace(pointerEvent({ clientX: 33, clientY: 47, shiftKey: true }));
    });
    const st = Object.values(useDoc.getState().stations)[0];
    expect(st.x).toBe(33);
    expect(st.y).toBe(47);
  });

  it("placing-station: 'Snap to all' aligns the drop to an existing stop", () => {
    useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES, all: 'all', grid: 'off' } });
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1', stations: ['S'] }) },
      lineOrder: ['L1'],
      stations: { S: stationWithStop('S' as StationId, 'L1', { x: 100, y: 0 }) },
    });
    resetSelection({ kind: 'placing-station' });
    const { result } = renderHook(() => usePlacementDispatch(fakeView));
    // (103, 50) is 3 from the stop's vertical axis x=100 → aligns.
    act(() => {
      result.current.handleCanvasPlace(pointerEvent({ clientX: 103, clientY: 50 }));
    });
    const placed = Object.values(useDoc.getState().stations).find((s) => s.id !== 'S');
    expect(placed?.x).toBeCloseTo(100, 5);
    expect(placed?.y).toBeCloseTo(50, 5);
  });

  it('creating-route-bullet (no lines → unbound): grid-snaps the drop', () => {
    gridBoth();
    resetSelection({ kind: 'creating-route-bullet' });
    const { result } = renderHook(() => usePlacementDispatch(fakeView));
    act(() => {
      result.current.handleCanvasPlace(pointerEvent({ clientX: 12, clientY: 34 }));
    });
    const b = Object.values(useDoc.getState().routeBullets)[0];
    expect(b.x).toBe(10);
    expect(b.y).toBe(30);
  });

  it('creating-route-bullet (bound to the default line): aligns to a stop on it', () => {
    useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES, line: true, grid: 'off' } });
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1', stations: ['S'] }) },
      lineOrder: ['L1'],
      stations: { S: stationWithStop('S' as StationId, 'L1', { x: 100, y: 0 }) },
    });
    resetSelection({ kind: 'creating-route-bullet' });
    const { result } = renderHook(() => usePlacementDispatch(fakeView));
    act(() => {
      result.current.handleCanvasPlace(pointerEvent({ clientX: 103, clientY: 50 }));
    });
    const b = Object.values(useDoc.getState().routeBullets)[0];
    expect(b.x).toBeCloseTo(100, 5);
    expect(b.y).toBeCloseTo(50, 5);
  });

  it('placing-label: grid-snaps the visible upper-left corner of the default label', () => {
    gridBoth();
    resetSelection({ kind: 'placing-label' });
    const m = measureTextLabel(TEXT_LABEL_DEFAULTS);
    const ul = snapPointToGrid(37 - m.width / 2, 23 - m.height / 2, 'both');
    const { result } = renderHook(() => usePlacementDispatch(fakeView));
    act(() => {
      result.current.handleCanvasPlace(pointerEvent({ clientX: 37, clientY: 23 }));
    });
    const label = Object.values(useDoc.getState().textLabels)[0];
    expect(label.x).toBeCloseTo(ul.x + m.width / 2, 5);
    expect(label.y).toBeCloseTo(ul.y + m.height / 2, 5);
  });

  it('creating-polygon: grid-snaps the starter square by its top-left vertex', () => {
    gridBoth();
    resetSelection({ kind: 'creating-polygon' });
    const anchorOff = polygonSnapAnchor(starterPolygonVertices(0, 0));
    const snapped = snapPointToGrid(37 + anchorOff.x, 23 + anchorOff.y, 'both');
    const { result } = renderHook(() => usePlacementDispatch(fakeView));
    act(() => {
      result.current.handleCanvasPlace(pointerEvent({ clientX: 37, clientY: 23 }));
    });
    const poly = Object.values(useDoc.getState().polygons)[0];
    expect(polygonSnapAnchor(poly.vertices).x).toBeCloseTo(snapped.x, 5);
    expect(polygonSnapAnchor(poly.vertices).y).toBeCloseTo(snapped.y, 5);
  });

  it('placing-svg: grid-snaps the image by its top-left corner', () => {
    gridBoth();
    resetSelection({
      kind: 'placing-svg',
      image: { href: 'data:image/svg+xml;base64,AAA', width: 80, height: 40 },
    });
    const { result } = renderHook(() => usePlacementDispatch(fakeView));
    // Click (12, 34): TL corner proposes (-28, 14) → grid (-30, 10) → center (10, 30).
    act(() => {
      result.current.handleCanvasPlace(pointerEvent({ clientX: 12, clientY: 34 }));
    });
    const img = Object.values(useDoc.getState().svgImages)[0];
    expect(img.x).toBeCloseTo(10, 5);
    expect(img.y).toBeCloseTo(30, 5);
  });
});

describe('handleCanvasPlace — editing-station-layout', () => {
  it('a background click exits the mode but KEEPS the station selected', () => {
    resetSelection({ kind: 'idle' });
    useSelection.getState().startEditingStationLayout('A');
    expect(useSelection.getState().selectedStationIds).toEqual(['A']);

    const { result } = renderHook(() => usePlacementDispatch(fakeView));
    let handled = false;
    act(() => {
      handled = result.current.handleCanvasPlace(pointerEvent({ clientX: 500, clientY: 500 }));
    });

    expect(handled).toBe(true);
    expect(useSelection.getState().uiMode.kind).toBe('idle');
    // Unlike the other modes' cancel paths, the inspector stays open.
    expect(useSelection.getState().selectedStationIds).toEqual(['A']);
  });
});
