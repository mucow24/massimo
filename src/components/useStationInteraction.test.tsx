import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useStationInteraction } from './useStationInteraction';
import { useDoc, useSelection, dragState } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { makeLine, stationWithStop } from '../test/fixtures';
import { pointerEvent } from '../test/interaction';
import type { LineId, Line, Station, StationId } from '../model/types';

// Doc mutators are replaced with spies — the interaction logic is what's under
// test, not the transforms (covered elsewhere). closestStopLineId queries the
// DOM for '.canvas-host svg'; with none present it returns the first stop's
// lineId, which is deterministic for these fixtures.
let rotateStation: ReturnType<typeof vi.fn>;
let rotateItemsAround: ReturnType<typeof vi.fn>;
let redistributeBetween: ReturnType<typeof vi.fn>;
let addTransfer: ReturnType<typeof vi.fn>;
let toggleStationOnLine: ReturnType<typeof vi.fn>;

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  rotateStation = vi.fn();
  rotateItemsAround = vi.fn();
  redistributeBetween = vi.fn();
  addTransfer = vi.fn();
  toggleStationOnLine = vi.fn();
  useDoc.setState({
    rotateStation,
    rotateItemsAround,
    redistributeBetween,
    addTransfer,
    toggleStationOnLine,
  } as unknown as Partial<ReturnType<typeof useDoc.getState>>);
  useSelection.setState({
    ...useSelection.getState(),
    toolMode: 'arrow',
    spaceHeld: false,
    uiMode: { kind: 'idle' },
    selectedStationIds: [],
    selectedRouteBulletIds: [],
    selectedLabelIds: [],
    hoveredLineStop: null,
  });
  dragState.suppressClick = false;
});

const stationS = () => stationWithStop('S' as StationId, 'L1' as LineId, { x: 0, y: 0 });

function setup(
  station: Station = stationS(),
  lines: Record<string, Line> = {
    L1: makeLine({ id: 'L1' as LineId, stations: ['S'] as StationId[] }),
  },
) {
  const onStartDrag = vi.fn();
  const { result } = renderHook(() => useStationInteraction(station, onStartDrag, lines));
  return { result, onStartDrag, station };
}

type Handlers = ReturnType<typeof useStationInteraction>['handlers'];
const click = (h: Handlers, e: React.MouseEvent) => act(() => h.onClick?.(e));

describe('useStationInteraction — click selection', () => {
  it('plain click replaces the selection with this station', () => {
    useSelection.setState({ ...useSelection.getState(), selectedStationIds: ['X' as StationId] });
    const { result } = setup();
    click(result.current.handlers, pointerEvent({}) as unknown as React.MouseEvent);
    expect(useSelection.getState().selectedStationIds).toEqual(['S']);
  });

  it('shift-click toggles this station into the multi-selection', () => {
    useSelection.setState({ ...useSelection.getState(), selectedStationIds: ['X' as StationId] });
    const { result } = setup();
    click(result.current.handlers, pointerEvent({ shiftKey: true }) as unknown as React.MouseEvent);
    expect(useSelection.getState().selectedStationIds).toEqual(['X', 'S']);
  });

  it('ctrl+shift-click extends the selection along the shared line', () => {
    useSelection.setState({ ...useSelection.getState(), selectedStationIds: ['A' as StationId] });
    const lines = { L1: makeLine({ id: 'L1' as LineId, stations: ['A', 'S'] as StationId[] }) };
    const { result } = setup(stationS(), lines);
    click(
      result.current.handlers,
      pointerEvent({ ctrlKey: true, shiftKey: true }) as unknown as React.MouseEvent,
    );
    expect(useSelection.getState().selectedStationIds).toContain('S');
    expect(useSelection.getState().selectedStationIds).toContain('A');
  });

  it('ctrl-click while one station is selected redistributes between them', () => {
    useSelection.setState({ ...useSelection.getState(), selectedStationIds: ['A' as StationId] });
    const { result } = setup();
    click(result.current.handlers, pointerEvent({ ctrlKey: true }) as unknown as React.MouseEvent);
    expect(redistributeBetween).toHaveBeenCalledWith('A', 'S', 'arc-bends', expect.anything());
  });

  it('ignores the click while drag-suppression is active', () => {
    dragState.suppressClick = true;
    const { result } = setup();
    click(result.current.handlers, pointerEvent({}) as unknown as React.MouseEvent);
    expect(useSelection.getState().selectedStationIds).toEqual([]);
  });
});

describe('useStationInteraction — pointer down drag routing', () => {
  it('plain pointerdown starts a drag with no redistribute anchor', () => {
    const { result, onStartDrag } = setup();
    const e = pointerEvent({});
    act(() => result.current.handlers.onPointerDown?.(e));
    expect(onStartDrag).toHaveBeenCalledWith('S', e, undefined);
  });

  it('ctrl+drag while one station is selected captures it as the redistribute anchor', () => {
    useSelection.setState({ ...useSelection.getState(), selectedStationIds: ['A' as StationId] });
    const { result, onStartDrag } = setup();
    const e = pointerEvent({ ctrlKey: true });
    act(() => result.current.handlers.onPointerDown?.(e));
    expect(onStartDrag).toHaveBeenCalledWith('S', e, 'A');
  });
});

describe('useStationInteraction — context menu rotation', () => {
  it('right-click on a lone station rotates just it', () => {
    const { result } = setup();
    act(() =>
      result.current.handlers.onContextMenu?.(pointerEvent({}) as unknown as React.MouseEvent),
    );
    expect(rotateStation).toHaveBeenCalledWith('S');
    expect(rotateItemsAround).not.toHaveBeenCalled();
  });

  it('right-click within a multi-selection rotates the group around this station', () => {
    useSelection.setState({
      ...useSelection.getState(),
      selectedStationIds: ['S' as StationId, 'B' as StationId],
    });
    const { result } = setup();
    act(() =>
      result.current.handlers.onContextMenu?.(pointerEvent({}) as unknown as React.MouseEvent),
    );
    expect(rotateItemsAround).toHaveBeenCalledWith({ type: 'station', id: 'S' }, [
      { type: 'station', id: 'S' },
      { type: 'station', id: 'B' },
    ]);
    expect(rotateStation).not.toHaveBeenCalled();
  });
});

describe('useStationInteraction — double click', () => {
  it('enters station-name edit mode', () => {
    const { result } = setup();
    act(() =>
      result.current.handlers.onDoubleClick?.(pointerEvent({}) as unknown as React.MouseEvent),
    );
    const sel = useSelection.getState();
    expect(sel.selectedStationIds).toEqual(['S']);
    expect(sel.editingStationId).toBe('S');
  });
});

describe('useStationInteraction — transfer creation', () => {
  it('first pick sets the anchor, second pick commits the transfer', () => {
    useSelection.getState().setUiMode({ kind: 'creating-transfer', anchor: null });

    const linesAB = {
      L1: makeLine({ id: 'L1' as LineId, stations: ['S', 'B'] as StationId[] }),
    };
    const { result: resS } = setup(stationS(), linesAB);
    const { result: resB } = setup(
      stationWithStop('B' as StationId, 'L1' as LineId, { x: 50, y: 0 }),
      linesAB,
    );

    // First pick on S.
    click(resS.current.handlers, pointerEvent({}) as unknown as React.MouseEvent);
    let uiMode = useSelection.getState().uiMode;
    expect(uiMode.kind).toBe('creating-transfer');
    if (uiMode.kind === 'creating-transfer') {
      expect(uiMode.anchor).toEqual({ stationId: 'S', lineId: 'L1' });
    }

    // Second pick on B commits and exits.
    click(resB.current.handlers, pointerEvent({}) as unknown as React.MouseEvent);
    expect(addTransfer).toHaveBeenCalledWith(
      { stationId: 'S', lineId: 'L1' },
      { stationId: 'B', lineId: 'L1' },
    );
    expect(useSelection.getState().uiMode.kind).toBe('idle');
  });

  it('highlights the hovered dot during a transfer pick', () => {
    useSelection.getState().setUiMode({ kind: 'creating-transfer', anchor: null });
    const { result } = setup();
    act(() => result.current.handlers.onPointerMove?.(pointerEvent({ clientX: 0, clientY: 0 })));
    expect(useSelection.getState().hoveredLineStop).toEqual({ stationId: 'S', lineId: 'L1' });
  });

  it('clears the hover highlight on pointer leave', () => {
    useSelection.getState().setUiMode({ kind: 'creating-transfer', anchor: null });
    useSelection.setState({
      ...useSelection.getState(),
      hoveredLineStop: { stationId: 'S' as StationId, lineId: 'L1' as LineId },
    });
    const { result } = setup();
    act(() => result.current.handlers.onPointerLeave?.());
    expect(useSelection.getState().hoveredLineStop).toBeNull();
  });
});

describe('useStationInteraction — append-to-line', () => {
  it('toggles the clicked station onto the line being appended', () => {
    useSelection.getState().startAppendAt('L1' as LineId, -1);
    const lines = { L1: makeLine({ id: 'L1' as LineId, stations: [] as StationId[] }) };
    const { result } = setup(stationS(), lines);
    click(result.current.handlers, pointerEvent({}) as unknown as React.MouseEvent);
    expect(toggleStationOnLine).toHaveBeenCalledWith('L1', 'S', -1);
  });
});

describe('useStationInteraction — mode gates', () => {
  it('passes through (hitless) in line-tag mode', () => {
    useSelection.getState().setUiMode({ kind: 'creating-line-tag' });
    const { result } = setup();
    expect(result.current.inHitlessMode).toBe(true);
    expect(result.current.handlers.onClick).toBeUndefined();
    expect(result.current.handlers.onPointerDown).toBeUndefined();
    expect(result.current.handlers.onContextMenu).toBeUndefined();
  });

  it('passes through (hitless) in layering mode', () => {
    useSelection.getState().setUiMode({ kind: 'layering' });
    const { result } = setup();
    expect(result.current.inHitlessMode).toBe(true);
  });

  it('disables click/dblclick in hand mode and never starts a drag', () => {
    useSelection.setState({ ...useSelection.getState(), toolMode: 'hand' });
    const { result, onStartDrag } = setup();
    expect(result.current.handlers.onClick).toBeUndefined();
    expect(result.current.handlers.onDoubleClick).toBeUndefined();
    // onPointerDown is wired but bails out so the SVG can pan.
    act(() => result.current.handlers.onPointerDown?.(pointerEvent({})));
    expect(onStartDrag).not.toHaveBeenCalled();
    expect(result.current.cursor).toBe('grab');
  });
});

describe('useStationInteraction — cursor', () => {
  it('shows the four-arrow move cursor over an unlocked station in arrow mode', () => {
    const { result } = setup();
    expect(result.current.cursor).toBe('move');
  });

  it('shows the pointing-hand cursor over a locked station', () => {
    const { result } = setup({ ...stationS(), locked: true });
    expect(result.current.cursor).toBe('pointer');
  });

  it('shows the open hand over a locked station in hand mode (pan wins)', () => {
    useSelection.setState({ ...useSelection.getState(), toolMode: 'hand' });
    const { result } = setup({ ...stationS(), locked: true });
    expect(result.current.cursor).toBe('grab');
  });
});
