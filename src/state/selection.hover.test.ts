import { describe, it, expect, beforeEach } from 'vitest';
import { useSelection } from './store';
import { clearedSelections, hoveredChrome, type HoveredCanvasItem } from './selection';
import type { LineId, StationId } from '../model/types';

beforeEach(() => {
  useSelection.setState({
    ...clearedSelections(),
    uiMode: { kind: 'idle' },
    hoveredCanvasItem: null,
    appendHover: null,
    toolMode: 'arrow',
    spaceHeld: false,
    lineTagHoverPreview: null,
  });
});

describe('hoveredCanvasItem store', () => {
  it('setHoveredCanvasItem sets, then clears, the field', () => {
    useSelection.getState().setHoveredCanvasItem({ kind: 'polygon', id: 'p1' });
    expect(useSelection.getState().hoveredCanvasItem).toEqual({ kind: 'polygon', id: 'p1' });
    useSelection.getState().setHoveredCanvasItem(null);
    expect(useSelection.getState().hoveredCanvasItem).toBeNull();
  });

  it('entering a non-idle mode drops the hover (a deliberate mode switch)', () => {
    useSelection.getState().setHoveredCanvasItem({ kind: 'transfer', id: 't1' });
    useSelection.getState().setUiMode({ kind: 'placing-station' });
    expect(useSelection.getState().hoveredCanvasItem).toBeNull();
  });

  it('a transition back to idle also drops the hover (re-syncs on next pointer move)', () => {
    useSelection.getState().setHoveredCanvasItem({ kind: 'station', id: 'A' });
    useSelection.getState().setUiMode({ kind: 'idle' });
    expect(useSelection.getState().hoveredCanvasItem).toBeNull();
  });
});

describe('hoveredLineStop store (transfer-mode dot ring)', () => {
  // Exiting transfer mode with the cursor still over a station used to leave
  // the white hover ring painted on that dot: back in idle, the station's
  // pointerleave swaps to the idle handler (which clears only
  // hoveredCanvasItem), so pointer motion could never clear the stale value.
  it('setUiMode clears hoveredLineStop like the other ephemeral hover channels', () => {
    useSelection.getState().setUiMode({ kind: 'creating-transfer', firstEnd: null });
    useSelection
      .getState()
      .setHoveredLineStop({ stationId: 'A' as StationId, lineId: 'L1' as LineId });
    useSelection.getState().setUiMode({ kind: 'idle' });
    expect(useSelection.getState().hoveredLineStop).toBeNull();
  });
});

describe('appendHover store (Edit Stops mouseover target)', () => {
  it('sets a station / segment target, then clears it', () => {
    useSelection.getState().setAppendHover({ kind: 'station', stationId: 'A' });
    expect(useSelection.getState().appendHover).toEqual({ kind: 'station', stationId: 'A' });
    useSelection.getState().setAppendHover({ kind: 'segment', pairKey: 'A|B' });
    expect(useSelection.getState().appendHover).toEqual({ kind: 'segment', pairKey: 'A|B' });
    useSelection.getState().setAppendHover(null);
    expect(useSelection.getState().appendHover).toBeNull();
  });

  it('is a no-op when the target is unchanged (no re-render churn)', () => {
    useSelection.getState().setAppendHover({ kind: 'segment', pairKey: 'A|B' });
    const before = useSelection.getState();
    // An equal-but-fresh object must NOT replace the state (deduped).
    useSelection.getState().setAppendHover({ kind: 'segment', pairKey: 'A|B' });
    expect(useSelection.getState()).toBe(before);
    // A genuinely different target does replace it.
    useSelection.getState().setAppendHover({ kind: 'segment', pairKey: 'B|C' });
    expect(useSelection.getState()).not.toBe(before);
  });

  it('entering a non-idle mode drops the hover', () => {
    useSelection.getState().setAppendHover({ kind: 'station', stationId: 'A' });
    useSelection.getState().setUiMode({ kind: 'placing-station' });
    expect(useSelection.getState().appendHover).toBeNull();
  });

  it('a transition back to idle also drops the hover', () => {
    useSelection.getState().setAppendHover({ kind: 'segment', pairKey: 'A|B' });
    useSelection.getState().setUiMode({ kind: 'idle' });
    expect(useSelection.getState().appendHover).toBeNull();
  });

  it('exiting Edit Stops via setAppending(null) drops the hover', () => {
    useSelection.setState({ uiMode: { kind: 'appending-to-line', lineId: 'L1', cursor: null } });
    useSelection.getState().setAppendHover({ kind: 'segment', pairKey: 'A|B' });
    useSelection.getState().setAppending(null);
    expect(useSelection.getState().appendHover).toBeNull();
    expect(useSelection.getState().uiMode).toEqual({ kind: 'idle' });
  });
});

describe('hoveredChrome — passes the hovered item through when idle and unselected', () => {
  const cases: HoveredCanvasItem[] = [
    { kind: 'station', id: 'A' },
    { kind: 'transfer', id: 't1' },
    { kind: 'bullet', id: 'b1' },
    { kind: 'label', id: 'l1' },
    { kind: 'polygon', id: 'p1' },
    { kind: 'svgImage', id: 'i1' },
    { kind: 'lineTag', id: 'g1' },
  ];
  for (const item of cases) {
    it(`kind=${item.kind}`, () => {
      useSelection.setState({ hoveredCanvasItem: item });
      expect(hoveredChrome(useSelection.getState())).toEqual(item);
    });
  }

  it('is null when nothing is hovered', () => {
    expect(hoveredChrome(useSelection.getState())).toBeNull();
  });
});

describe('hoveredChrome — suppression', () => {
  it('is null in a non-idle mode', () => {
    useSelection.setState({
      uiMode: { kind: 'creating-transfer', firstEnd: null },
      hoveredCanvasItem: { kind: 'station', id: 'A' },
    });
    expect(hoveredChrome(useSelection.getState())).toBeNull();
  });

  it('is null while panning (hand tool or space held)', () => {
    useSelection.setState({ hoveredCanvasItem: { kind: 'polygon', id: 'p1' }, toolMode: 'hand' });
    expect(hoveredChrome(useSelection.getState())).toBeNull();
    useSelection.setState({ toolMode: 'arrow', spaceHeld: true });
    expect(hoveredChrome(useSelection.getState())).toBeNull();
  });

  it('is null when the hovered item is already selected (each kind checks its own list)', () => {
    // station (multi-list), transfer (single id), and lineTag (single id) cover
    // both selection shapes; the remaining list kinds mirror the station case.
    useSelection.setState({
      selectedStationIds: ['A'] as StationId[],
      hoveredCanvasItem: { kind: 'station', id: 'A' },
    });
    expect(hoveredChrome(useSelection.getState())).toBeNull();

    useSelection.setState({
      selectedStationIds: [] as StationId[],
      selectedTransferId: 't1',
      hoveredCanvasItem: { kind: 'transfer', id: 't1' },
    });
    expect(hoveredChrome(useSelection.getState())).toBeNull();

    useSelection.setState({
      selectedTransferId: null,
      selectedPolygonIds: ['p1'],
      hoveredCanvasItem: { kind: 'polygon', id: 'p1' },
    });
    expect(hoveredChrome(useSelection.getState())).toBeNull();

    useSelection.setState({
      selectedPolygonIds: [],
      selectedLineTagId: 'g1',
      hoveredCanvasItem: { kind: 'lineTag', id: 'g1' },
    });
    expect(hoveredChrome(useSelection.getState())).toBeNull();
  });

  it('still passes through when a DIFFERENT item of the same kind is selected', () => {
    useSelection.setState({
      selectedPolygonIds: ['other'],
      hoveredCanvasItem: { kind: 'polygon', id: 'p1' },
    });
    expect(hoveredChrome(useSelection.getState())).toEqual({ kind: 'polygon', id: 'p1' });
  });
});
