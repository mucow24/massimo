import { describe, it, expect, beforeEach } from 'vitest';
import { useSelection, type UiMode } from './store';
import { clearedSelections, getCopyableSelection, soleSelection } from './selection';
import { DEFAULT_DOC } from '../model/transforms';
import type { LineId, MapDoc, StationId } from '../model/types';

beforeEach(() => {
  // Reset through the production full-wipe helper so this can't drift from the
  // real set of selection fields (it already missed selectedPolygonIds /
  // selectedVertex before being routed through clearedSelections).
  useSelection.setState({
    ...clearedSelections(),
    uiMode: { kind: 'idle' },
    lineTagHoverPreview: null,
  });
});

describe('selection — array model', () => {
  it('initial state: empty array', () => {
    expect(useSelection.getState().selectedStationIds).toEqual([]);
  });

  describe('selectStation', () => {
    it('replaces with [id]', () => {
      const { selectStation } = useSelection.getState();
      selectStation('A' as StationId);
      expect(useSelection.getState().selectedStationIds).toEqual(['A']);
    });

    it('null clears the array', () => {
      const { selectStation } = useSelection.getState();
      selectStation('A' as StationId);
      selectStation(null);
      expect(useSelection.getState().selectedStationIds).toEqual([]);
    });

    it('replaces multi-selection with single', () => {
      useSelection.setState({ selectedStationIds: ['A', 'B', 'C'] as StationId[] });
      useSelection.getState().selectStation('D' as StationId);
      expect(useSelection.getState().selectedStationIds).toEqual(['D']);
    });
  });

  describe('toggleStationSelection', () => {
    it('appends a new id (becomes anchor)', () => {
      const { toggleStationSelection } = useSelection.getState();
      toggleStationSelection('A' as StationId);
      toggleStationSelection('B' as StationId);
      const ids = useSelection.getState().selectedStationIds;
      expect(ids).toEqual(['A', 'B']);
      expect(ids[ids.length - 1]).toBe('B');
    });

    it('removes an existing id', () => {
      useSelection.setState({ selectedStationIds: ['A', 'B', 'C'] as StationId[] });
      useSelection.getState().toggleStationSelection('B' as StationId);
      expect(useSelection.getState().selectedStationIds).toEqual(['A', 'C']);
    });

    it('add then toggle off then re-add: anchor follows latest insertion', () => {
      const { toggleStationSelection } = useSelection.getState();
      toggleStationSelection('A' as StationId);
      toggleStationSelection('A' as StationId);
      expect(useSelection.getState().selectedStationIds).toEqual([]);
      toggleStationSelection('A' as StationId);
      expect(useSelection.getState().selectedStationIds).toEqual(['A']);
    });

    it('appending a station clears a stale line / tag / transfer / mirror selection', () => {
      // The bug SIBLING_PRIMARY_CLEAR guards: a station added to the set is
      // foreign to any previously-selected line, so those primaries must drop
      // or the line stays highlighted behind the new station selection.
      useSelection.setState({
        selectedLineId: 'L1' as LineId,
        selectedLineTagId: 'tag1',
        selectedTransferId: 't1',
        mirrorMatching: true,
      });
      useSelection.getState().toggleStationSelection('A' as StationId);
      const s = useSelection.getState();
      expect(s.selectedLineId).toBeNull();
      expect(s.selectedLineTagId).toBeNull();
      expect(s.selectedTransferId).toBeNull();
      expect(s.mirrorMatching).toBe(false);
    });
  });

  describe('setStationSelection', () => {
    it('replaces with the given ids exactly', () => {
      useSelection.setState({ selectedStationIds: ['X'] as StationId[] });
      useSelection.getState().setStationSelection(['A', 'B', 'C'] as StationId[]);
      expect(useSelection.getState().selectedStationIds).toEqual(['A', 'B', 'C']);
    });

    it('empty array clears', () => {
      useSelection.setState({ selectedStationIds: ['A', 'B'] as StationId[] });
      useSelection.getState().setStationSelection([]);
      expect(useSelection.getState().selectedStationIds).toEqual([]);
    });

    it('dedupes preserving last position', () => {
      useSelection.getState().setStationSelection(['A', 'B', 'A'] as StationId[]);
      const ids = useSelection.getState().selectedStationIds;
      expect(ids).toEqual(['B', 'A']);
    });

    it('clears a stale line / tag / transfer / mirror selection', () => {
      useSelection.setState({
        selectedLineId: 'L1' as LineId,
        selectedLineTagId: 'tag1',
        selectedTransferId: 't1',
        mirrorMatching: true,
      });
      useSelection.getState().setStationSelection(['A'] as StationId[]);
      const s = useSelection.getState();
      expect(s.selectedLineId).toBeNull();
      expect(s.selectedLineTagId).toBeNull();
      expect(s.selectedTransferId).toBeNull();
      expect(s.mirrorMatching).toBe(false);
    });
  });

  describe('addStationsToSelection', () => {
    it('unions, preserving prior order, appending novel ids', () => {
      useSelection.setState({ selectedStationIds: ['A', 'B'] as StationId[] });
      useSelection.getState().addStationsToSelection(['B', 'C', 'D'] as StationId[]);
      expect(useSelection.getState().selectedStationIds).toEqual(['A', 'B', 'C', 'D']);
    });

    it('no-op when all ids already selected', () => {
      useSelection.setState({ selectedStationIds: ['A', 'B'] as StationId[] });
      const before = useSelection.getState().selectedStationIds;
      useSelection.getState().addStationsToSelection(['B', 'A'] as StationId[]);
      expect(useSelection.getState().selectedStationIds).toEqual(before);
    });
  });

  describe('xorStationsToSelection', () => {
    it('removes intersection, appends rest', () => {
      useSelection.setState({ selectedStationIds: ['A', 'B', 'C'] as StationId[] });
      useSelection.getState().xorStationsToSelection(['B', 'D'] as StationId[]);
      expect(useSelection.getState().selectedStationIds).toEqual(['A', 'C', 'D']);
    });

    it('appended ids become the anchor', () => {
      useSelection.setState({ selectedStationIds: ['A'] as StationId[] });
      useSelection.getState().xorStationsToSelection(['B', 'C'] as StationId[]);
      const ids = useSelection.getState().selectedStationIds;
      expect(ids[ids.length - 1]).toBe('C');
    });

    it('empty arg is a no-op', () => {
      useSelection.setState({ selectedStationIds: ['A', 'B'] as StationId[] });
      useSelection.getState().xorStationsToSelection([]);
      expect(useSelection.getState().selectedStationIds).toEqual(['A', 'B']);
    });
  });
});

describe('selection — route bullets (parallel array)', () => {
  it('initial state: empty array', () => {
    expect(useSelection.getState().selectedRouteBulletIds).toEqual([]);
  });

  describe('selectRouteBullet', () => {
    it('replaces with [id]', () => {
      useSelection.getState().selectRouteBullet('b1');
      expect(useSelection.getState().selectedRouteBulletIds).toEqual(['b1']);
    });

    it('null clears the array', () => {
      useSelection.getState().selectRouteBullet('b1');
      useSelection.getState().selectRouteBullet(null);
      expect(useSelection.getState().selectedRouteBulletIds).toEqual([]);
    });

    it('clears stations when picking a bullet (plain click semantics)', () => {
      useSelection.setState({ selectedStationIds: ['A', 'B'] as StationId[] });
      useSelection.getState().selectRouteBullet('b1');
      expect(useSelection.getState().selectedStationIds).toEqual([]);
      expect(useSelection.getState().selectedRouteBulletIds).toEqual(['b1']);
    });

    it('selectStation clears bullets too — plain click is exclusive', () => {
      useSelection.setState({ selectedRouteBulletIds: ['b1', 'b2'] });
      useSelection.getState().selectStation('S1' as StationId);
      expect(useSelection.getState().selectedStationIds).toEqual(['S1']);
      expect(useSelection.getState().selectedRouteBulletIds).toEqual([]);
    });
  });

  describe('toggleRouteBulletSelection', () => {
    it('appends a new id (becomes anchor)', () => {
      useSelection.getState().toggleRouteBulletSelection('b1');
      useSelection.getState().toggleRouteBulletSelection('b2');
      expect(useSelection.getState().selectedRouteBulletIds).toEqual(['b1', 'b2']);
    });

    it('removes an existing id', () => {
      useSelection.setState({ selectedRouteBulletIds: ['b1', 'b2', 'b3'] });
      useSelection.getState().toggleRouteBulletSelection('b2');
      expect(useSelection.getState().selectedRouteBulletIds).toEqual(['b1', 'b3']);
    });

    it('does not touch station selection — shift-click is per-type', () => {
      useSelection.setState({
        selectedStationIds: ['A'] as StationId[],
        selectedRouteBulletIds: [],
      });
      useSelection.getState().toggleRouteBulletSelection('b1');
      expect(useSelection.getState().selectedStationIds).toEqual(['A']);
      expect(useSelection.getState().selectedRouteBulletIds).toEqual(['b1']);
    });
  });

  describe('setRouteBulletSelection', () => {
    it('replaces with the given ids exactly, deduped last-wins', () => {
      useSelection.setState({ selectedRouteBulletIds: ['x'] });
      useSelection.getState().setRouteBulletSelection(['b1', 'b2', 'b1']);
      expect(useSelection.getState().selectedRouteBulletIds).toEqual(['b2', 'b1']);
    });
  });

  describe('addRouteBulletsToSelection', () => {
    it('unions, preserving prior order', () => {
      useSelection.setState({ selectedRouteBulletIds: ['b1', 'b2'] });
      useSelection.getState().addRouteBulletsToSelection(['b2', 'b3']);
      expect(useSelection.getState().selectedRouteBulletIds).toEqual(['b1', 'b2', 'b3']);
    });
  });

  describe('xorRouteBulletsToSelection', () => {
    it('removes intersection, appends rest', () => {
      useSelection.setState({ selectedRouteBulletIds: ['b1', 'b2', 'b3'] });
      useSelection.getState().xorRouteBulletsToSelection(['b2', 'b4']);
      expect(useSelection.getState().selectedRouteBulletIds).toEqual(['b1', 'b3', 'b4']);
    });
  });
});

describe('selection — text labels (parallel array)', () => {
  it('initial state: empty array', () => {
    expect(useSelection.getState().selectedLabelIds).toEqual([]);
  });

  describe('selectLabel', () => {
    it('replaces with [id]', () => {
      useSelection.getState().selectLabel('g1');
      expect(useSelection.getState().selectedLabelIds).toEqual(['g1']);
    });

    it('null clears the array', () => {
      useSelection.getState().selectLabel('g1');
      useSelection.getState().selectLabel(null);
      expect(useSelection.getState().selectedLabelIds).toEqual([]);
    });

    it('clears stations and bullets when picking a label', () => {
      useSelection.setState({
        selectedStationIds: ['A'] as StationId[],
        selectedRouteBulletIds: ['b1'],
      });
      useSelection.getState().selectLabel('g1');
      expect(useSelection.getState().selectedStationIds).toEqual([]);
      expect(useSelection.getState().selectedRouteBulletIds).toEqual([]);
      expect(useSelection.getState().selectedLabelIds).toEqual(['g1']);
    });

    it('selectStation clears labels too — plain click is exclusive', () => {
      useSelection.setState({ selectedLabelIds: ['g1', 'g2'] });
      useSelection.getState().selectStation('S1' as StationId);
      expect(useSelection.getState().selectedLabelIds).toEqual([]);
    });

    it('selectRouteBullet clears labels too', () => {
      useSelection.setState({ selectedLabelIds: ['g1'] });
      useSelection.getState().selectRouteBullet('b1');
      expect(useSelection.getState().selectedLabelIds).toEqual([]);
    });
  });

  describe('toggleLabelSelection', () => {
    it('appends a new id', () => {
      useSelection.getState().toggleLabelSelection('g1');
      useSelection.getState().toggleLabelSelection('g2');
      expect(useSelection.getState().selectedLabelIds).toEqual(['g1', 'g2']);
    });

    it('removes an existing id', () => {
      useSelection.setState({ selectedLabelIds: ['g1', 'g2', 'g3'] });
      useSelection.getState().toggleLabelSelection('g2');
      expect(useSelection.getState().selectedLabelIds).toEqual(['g1', 'g3']);
    });
  });

  describe('setLabelSelection', () => {
    it('replaces with the given ids exactly, deduped last-wins', () => {
      useSelection.setState({ selectedLabelIds: ['x'] });
      useSelection.getState().setLabelSelection(['g1', 'g2', 'g1']);
      expect(useSelection.getState().selectedLabelIds).toEqual(['g2', 'g1']);
    });
  });

  describe('addLabelsToSelection', () => {
    it('unions, preserving prior order', () => {
      useSelection.setState({ selectedLabelIds: ['g1', 'g2'] });
      useSelection.getState().addLabelsToSelection(['g2', 'g3']);
      expect(useSelection.getState().selectedLabelIds).toEqual(['g1', 'g2', 'g3']);
    });
  });

  describe('xorLabelsToSelection', () => {
    it('removes intersection, appends rest', () => {
      useSelection.setState({ selectedLabelIds: ['g1', 'g2', 'g3'] });
      useSelection.getState().xorLabelsToSelection(['g2', 'g4']);
      expect(useSelection.getState().selectedLabelIds).toEqual(['g1', 'g3', 'g4']);
    });
  });
});

// =====================================================================
// uiMode discriminated union — exclusive-mode matrix
// =====================================================================

const NON_IDLE_MODES: UiMode[] = [
  { kind: 'placing-station' },
  { kind: 'creating-line-tag' },
  { kind: 'creating-route-bullet' },
  { kind: 'creating-transfer', anchor: null },
  { kind: 'placing-label' },
  { kind: 'appending-to-line', lineId: 'L1' as LineId, insertAfterIndex: null },
  { kind: 'layering' },
];

describe('uiMode transitions', () => {
  it.each(NON_IDLE_MODES)('setUiMode enters $kind from idle', (mode) => {
    useSelection.getState().setUiMode(mode);
    expect(useSelection.getState().uiMode).toEqual(mode);
  });

  it.each(NON_IDLE_MODES)('entering $kind replaces any prior non-idle mode', (mode) => {
    const other = NON_IDLE_MODES.find((m) => m.kind !== mode.kind)!;
    useSelection.getState().setUiMode(other);
    useSelection.getState().setUiMode(mode);
    expect(useSelection.getState().uiMode.kind).toBe(mode.kind);
  });

  it.each(NON_IDLE_MODES)('setUiMode({kind:idle}) exits $kind', (mode) => {
    useSelection.getState().setUiMode(mode);
    useSelection.getState().setUiMode({ kind: 'idle' });
    expect(useSelection.getState().uiMode.kind).toBe('idle');
  });

  it.each(NON_IDLE_MODES)('entering $kind preserves hover / tab / tool state', (mode) => {
    useSelection.setState({
      hoveredStationId: 'S1' as StationId,
      activeTab: 'lines',
      toolMode: 'hand',
      spaceHeld: true,
    });
    useSelection.getState().setUiMode(mode);
    const s = useSelection.getState();
    expect(s.hoveredStationId).toBe('S1');
    expect(s.activeTab).toBe('lines');
    expect(s.toolMode).toBe('hand');
    expect(s.spaceHeld).toBe(true);
  });

  it.each(NON_IDLE_MODES)('entering $kind resets within-station inspector micro-state', (mode) => {
    useSelection.setState({
      mirrorMatching: true,
      selectedStopLineId: 'L1' as LineId,
      labelSelected: true,
      editingStationId: 'S1' as StationId,
    });
    useSelection.getState().setUiMode(mode);
    const s = useSelection.getState();
    expect(s.mirrorMatching).toBe(false);
    expect(s.selectedStopLineId).toBeNull();
    expect(s.labelSelected).toBe(false);
    expect(s.editingStationId).toBeNull();
  });

  it('exiting any mode clears lineTagHoverPreview', () => {
    useSelection.getState().setUiMode({ kind: 'creating-line-tag' });
    useSelection.setState({
      lineTagHoverPreview: {
        lineId: 'L1' as LineId,
        service: 'A',
        fromStationId: 'S1' as StationId,
        toStationId: 'S2' as StationId,
        t: 0.5,
        p: { x: 0, y: 0 },
        tangent: { x: 1, y: 0 },
        lineForwardMatchesCanon: true,
      },
    });
    useSelection.getState().setUiMode({ kind: 'idle' });
    expect(useSelection.getState().lineTagHoverPreview).toBeNull();
  });
});

describe('uiMode variant payloads', () => {
  it('creating-transfer carries null anchor on entry', () => {
    useSelection.getState().setUiMode({ kind: 'creating-transfer', anchor: null });
    const cur = useSelection.getState().uiMode;
    expect(cur).toEqual({ kind: 'creating-transfer', anchor: null });
  });

  it('setTransferAnchor updates the creating-transfer variant in place', () => {
    useSelection.getState().setUiMode({ kind: 'creating-transfer', anchor: null });
    useSelection
      .getState()
      .setTransferAnchor({ stationId: 'S1' as StationId, lineId: 'L1' as LineId });
    const cur = useSelection.getState().uiMode;
    expect(cur.kind).toBe('creating-transfer');
    if (cur.kind === 'creating-transfer') {
      expect(cur.anchor).toEqual({ stationId: 'S1', lineId: 'L1' });
    }
  });

  it('setTransferAnchor is a no-op when not in creating-transfer', () => {
    useSelection.getState().setUiMode({ kind: 'placing-station' });
    useSelection.getState().setTransferAnchor({ stationId: 'S1' as StationId, lineId: null });
    expect(useSelection.getState().uiMode.kind).toBe('placing-station');
  });

  it('exiting creating-transfer drops the anchor', () => {
    useSelection.getState().setUiMode({
      kind: 'creating-transfer',
      anchor: { stationId: 'S1' as StationId, lineId: null },
    });
    useSelection.getState().setUiMode({ kind: 'idle' });
    expect(useSelection.getState().uiMode).toEqual({ kind: 'idle' });
  });

  it('appending-to-line carries lineId + insertAfterIndex', () => {
    useSelection
      .getState()
      .setUiMode({ kind: 'appending-to-line', lineId: 'L1' as LineId, insertAfterIndex: 3 });
    const cur = useSelection.getState().uiMode;
    expect(cur.kind).toBe('appending-to-line');
    if (cur.kind === 'appending-to-line') {
      expect(cur.lineId).toBe('L1');
      expect(cur.insertAfterIndex).toBe(3);
    }
  });

  it('setInsertAfterIndex updates the appending-to-line variant in place', () => {
    useSelection
      .getState()
      .setUiMode({ kind: 'appending-to-line', lineId: 'L1' as LineId, insertAfterIndex: null });
    useSelection.getState().setInsertAfterIndex(5);
    const cur = useSelection.getState().uiMode;
    if (cur.kind === 'appending-to-line') {
      expect(cur.insertAfterIndex).toBe(5);
    }
  });

  it('setInsertAfterIndex is a no-op when not appending', () => {
    useSelection.getState().setUiMode({ kind: 'idle' });
    useSelection.getState().setInsertAfterIndex(5);
    expect(useSelection.getState().uiMode.kind).toBe('idle');
  });
});

describe('select* rationalized exclusivity (non-station)', () => {
  type SelectName =
    | 'selectLine'
    | 'selectLineTag'
    | 'selectRouteBullet'
    | 'selectTransfer'
    | 'selectLabel';
  const setters: { name: SelectName; id: string }[] = [
    { name: 'selectLine', id: 'L1' },
    { name: 'selectLineTag', id: 'tag1' },
    { name: 'selectRouteBullet', id: 'b1' },
    { name: 'selectTransfer', id: 't1' },
    { name: 'selectLabel', id: 'g1' },
  ];

  for (const { name, id } of setters) {
    describe(name, () => {
      it.each(NON_IDLE_MODES)(`with non-null id sends uiMode to idle from $kind`, (mode) => {
        useSelection.getState().setUiMode(mode);
        (useSelection.getState()[name] as (id: string) => void)(id);
        expect(useSelection.getState().uiMode.kind).toBe('idle');
      });

      it.each(NON_IDLE_MODES)(`with null does NOT change $kind`, (mode) => {
        useSelection.getState().setUiMode(mode);
        (useSelection.getState()[name] as (id: string | null) => void)(null);
        expect(useSelection.getState().uiMode.kind).toBe(mode.kind);
      });
    });
  }
});

describe('selectStation sticky-mode exception', () => {
  it.each(NON_IDLE_MODES)('selectStation(id) preserves $kind', (mode) => {
    useSelection.getState().setUiMode(mode);
    useSelection.getState().selectStation('S1' as StationId);
    expect(useSelection.getState().uiMode.kind).toBe(mode.kind);
  });

  it.each(NON_IDLE_MODES)('selectStation(null) preserves $kind', (mode) => {
    useSelection.getState().setUiMode(mode);
    useSelection.getState().selectStation(null);
    expect(useSelection.getState().uiMode.kind).toBe(mode.kind);
  });
});

describe('multi-select setters never change uiMode', () => {
  const cases: Array<[string, () => void]> = [
    [
      'toggleStationSelection',
      () => useSelection.getState().toggleStationSelection('A' as StationId),
    ],
    ['setStationSelection', () => useSelection.getState().setStationSelection(['A' as StationId])],
    [
      'addStationsToSelection',
      () => useSelection.getState().addStationsToSelection(['A' as StationId]),
    ],
    [
      'xorStationsToSelection',
      () => useSelection.getState().xorStationsToSelection(['A' as StationId]),
    ],
    ['toggleRouteBulletSelection', () => useSelection.getState().toggleRouteBulletSelection('b1')],
    ['toggleLabelSelection', () => useSelection.getState().toggleLabelSelection('g1')],
    ['addLabelsToSelection', () => useSelection.getState().addLabelsToSelection(['g1'])],
  ];

  for (const [label, gesture] of cases) {
    it(`${label} preserves placing-station`, () => {
      useSelection.getState().setUiMode({ kind: 'placing-station' });
      gesture();
      expect(useSelection.getState().uiMode.kind).toBe('placing-station');
    });
  }
});

describe('uiMode entry clears all selections (no leftover cross-type selection)', () => {
  it.each(NON_IDLE_MODES)('entering $kind via setUiMode clears all selection fields', (mode) => {
    useSelection.setState({
      selectedStationIds: ['A'] as StationId[],
      selectedRouteBulletIds: ['b1'],
      selectedLabelIds: ['g1'],
      selectedLineId: 'L1' as LineId,
      selectedLineTagId: 'tag1',
      selectedTransferId: 't1',
    });
    useSelection.getState().setUiMode(mode);
    const s = useSelection.getState();
    expect(s.selectedStationIds).toEqual([]);
    expect(s.selectedRouteBulletIds).toEqual([]);
    expect(s.selectedLabelIds).toEqual([]);
    expect(s.selectedLineId).toBeNull();
    expect(s.selectedLineTagId).toBeNull();
    expect(s.selectedTransferId).toBeNull();
  });

  it('startAppendAt keeps selectedLineId pinned to the line being appended', () => {
    useSelection.getState().startAppendAt('L1' as LineId, 2);
    const s = useSelection.getState();
    expect(s.uiMode).toEqual({
      kind: 'appending-to-line',
      lineId: 'L1',
      insertAfterIndex: 2,
    });
    expect(s.selectedLineId).toBe('L1');
    expect(s.activeTab).toBe('lines');
  });
});

describe('multi-item selection clears a stale selected line (regression)', () => {
  // Before the shared SIBLING_PRIMARY_CLEAR, add*/xor* for bullets/labels/
  // polygons cleared nothing, so a shift-rubber-band over non-station items
  // left selectedLineId set — the line stayed highlighted and the wrong
  // inspector opened. Every list-mutating verb on a non-station kind must drop
  // it now.
  it('addRouteBulletsToSelection clears a previously-selected line', () => {
    useSelection.getState().selectLine('L1' as LineId);
    expect(useSelection.getState().selectedLineId).toBe('L1');
    useSelection.getState().addRouteBulletsToSelection(['b1']);
    expect(useSelection.getState().selectedLineId).toBeNull();
    expect(useSelection.getState().selectedRouteBulletIds).toEqual(['b1']);
  });

  it('xorLabelsToSelection clears a previously-selected line', () => {
    useSelection.getState().selectLine('L1' as LineId);
    useSelection.getState().xorLabelsToSelection(['g1']);
    expect(useSelection.getState().selectedLineId).toBeNull();
    expect(useSelection.getState().selectedLabelIds).toEqual(['g1']);
  });

  it('toggle (append branch) clears the line, remove branch leaves it', () => {
    useSelection.getState().selectLine('L1' as LineId);
    useSelection.getState().togglePolygonSelection('p1'); // append → clears line
    expect(useSelection.getState().selectedLineId).toBeNull();
    // Re-pin a line, then remove the polygon: removal must NOT wipe the line.
    useSelection.setState({ selectedLineId: 'L1' as LineId });
    useSelection.getState().togglePolygonSelection('p1'); // remove
    expect(useSelection.getState().selectedPolygonIds).toEqual([]);
    expect(useSelection.getState().selectedLineId).toBe('L1');
  });

  it('a no-op add (no novel ids) leaves the line untouched', () => {
    useSelection.setState({ selectedRouteBulletIds: ['b1'], selectedLineId: 'L1' as LineId });
    useSelection.getState().addRouteBulletsToSelection(['b1']); // already present → no-op
    expect(useSelection.getState().selectedLineId).toBe('L1');
  });
});

describe('toggleTab — collapsible sidebar list', () => {
  const toggle = (tab: 'stations' | 'lines') => useSelection.getState().toggleTab(tab);
  const view = () => {
    const s = useSelection.getState();
    return { activeTab: s.activeTab, sidebarOpen: s.sidebarOpen };
  };

  it('clicking a collapsed tab opens its list', () => {
    useSelection.setState({ activeTab: 'stations', sidebarOpen: false });
    toggle('stations');
    expect(view()).toEqual({ activeTab: 'stations', sidebarOpen: true });
  });

  it('clicking the shown tab collapses the list, preserving activeTab', () => {
    useSelection.setState({ activeTab: 'stations', sidebarOpen: true });
    toggle('stations');
    expect(view()).toEqual({ activeTab: 'stations', sidebarOpen: false });
  });

  it('clicking the other tab while open swaps the list (stays open)', () => {
    useSelection.setState({ activeTab: 'stations', sidebarOpen: true });
    toggle('lines');
    expect(view()).toEqual({ activeTab: 'lines', sidebarOpen: true });
  });

  it('clicking the other tab while collapsed opens that tab', () => {
    useSelection.setState({ activeTab: 'stations', sidebarOpen: false });
    toggle('lines');
    expect(view()).toEqual({ activeTab: 'lines', sidebarOpen: true });
  });

  // The full walkthrough from the feature request, step by step.
  it('follows the specified click sequence', () => {
    useSelection.setState({ activeTab: 'stations', sidebarOpen: false }); // (Closed)

    toggle('stations'); // Stations list opens
    expect(view()).toEqual({ activeTab: 'stations', sidebarOpen: true });

    toggle('stations'); // Stations list closes
    expect(view()).toEqual({ activeTab: 'stations', sidebarOpen: false });

    toggle('lines'); // Lines list opens
    expect(view()).toEqual({ activeTab: 'lines', sidebarOpen: true });

    toggle('stations'); // Lines swaps with Stations
    expect(view()).toEqual({ activeTab: 'stations', sidebarOpen: true });

    toggle('lines'); // Stations swaps with Lines
    expect(view()).toEqual({ activeTab: 'lines', sidebarOpen: true });

    toggle('lines'); // Lines list closes
    expect(view()).toEqual({ activeTab: 'lines', sidebarOpen: false });
  });

  it('toggleSidebar flips open/closed without changing the active tab', () => {
    useSelection.setState({ activeTab: 'lines', sidebarOpen: true });
    useSelection.getState().toggleSidebar();
    expect(view()).toEqual({ activeTab: 'lines', sidebarOpen: false });
    useSelection.getState().toggleSidebar();
    expect(view()).toEqual({ activeTab: 'lines', sidebarOpen: true });
  });
});

describe('selectLine — reveals a hidden sidebar', () => {
  const view = () => {
    const s = useSelection.getState();
    return {
      sidebarOpen: s.sidebarOpen,
      activeTab: s.activeTab,
      autoRevealed: s.sidebarAutoRevealed,
    };
  };

  it('selecting a line while hidden reveals it on the Lines tab and marks it auto-revealed', () => {
    useSelection.setState({
      sidebarOpen: false,
      activeTab: 'stations',
      sidebarAutoRevealed: false,
    });
    useSelection.getState().selectLine('L1' as LineId);
    expect(view()).toEqual({ sidebarOpen: true, activeTab: 'lines', autoRevealed: true });
  });

  it('selecting a line while the sidebar is already open does NOT mark it auto-revealed', () => {
    useSelection.setState({ sidebarOpen: true, activeTab: 'stations', sidebarAutoRevealed: false });
    useSelection.getState().selectLine('L1' as LineId);
    expect(view()).toEqual({ sidebarOpen: true, activeTab: 'lines', autoRevealed: false });
  });

  it('switching lines within an auto-revealed session keeps the flag set', () => {
    useSelection.setState({
      sidebarOpen: false,
      activeTab: 'stations',
      sidebarAutoRevealed: false,
    });
    useSelection.getState().selectLine('L1' as LineId); // reveals; flag → true
    useSelection.getState().selectLine('L2' as LineId); // sidebar already open now
    expect(view()).toEqual({ sidebarOpen: true, activeTab: 'lines', autoRevealed: true });
  });

  it('a manual tab toggle cedes control: clears the auto-reveal flag', () => {
    useSelection.setState({ sidebarOpen: true, activeTab: 'lines', sidebarAutoRevealed: true });
    useSelection.getState().toggleTab('stations');
    expect(useSelection.getState().sidebarAutoRevealed).toBe(false);
  });

  it('a manual sidebar toggle cedes control: clears the auto-reveal flag', () => {
    useSelection.setState({ sidebarOpen: true, activeTab: 'lines', sidebarAutoRevealed: true });
    useSelection.getState().toggleSidebar();
    expect(useSelection.getState().sidebarAutoRevealed).toBe(false);
  });

  // The gentle null-clear leaves sidebar state alone; the Sidebar component's
  // effect is what collapses an auto-revealed panel on exit (covered there).
  it('clearing the line selection does not itself touch sidebar state', () => {
    useSelection.setState({ sidebarOpen: true, activeTab: 'lines', sidebarAutoRevealed: true });
    useSelection.getState().selectLine(null);
    expect(view()).toEqual({ sidebarOpen: true, activeTab: 'lines', autoRevealed: true });
  });
});

describe('soleSelection', () => {
  it('returns the single selected item across any one list', () => {
    useSelection.getState().selectStation('s1' as StationId);
    expect(soleSelection(useSelection.getState())).toEqual({ type: 'station', id: 's1' });
    useSelection.getState().selectRouteBullet('b1');
    expect(soleSelection(useSelection.getState())).toEqual({ type: 'bullet', id: 'b1' });
    useSelection.getState().selectPolygon('p1');
    expect(soleSelection(useSelection.getState())).toEqual({ type: 'polygon', id: 'p1' });
  });

  it('returns null for an empty or multi-item selection (across types too)', () => {
    expect(soleSelection(useSelection.getState())).toBeNull();
    useSelection.setState({ selectedStationIds: ['s1', 's2'] as StationId[] });
    expect(soleSelection(useSelection.getState())).toBeNull();
    // One station + one bullet across two lists is still "multi".
    useSelection.setState({ selectedStationIds: ['s1'] as StationId[], selectedLabelIds: ['g1'] });
    expect(soleSelection(useSelection.getState())).toBeNull();
  });
});

describe('replace/set selection drops a stale sibling primary (transfer + line)', () => {
  // The generic `replace` action (setLabelSelection / setRouteBulletSelection /
  // setPolygonSelection) used to pass {} for the cross-clear, so a previously-
  // selected line OR transfer survived a rect-select of a different item kind.
  // SIBLING_PRIMARY_CLEAR now covers the transfer too, and replace folds it in.
  it('setLabelSelection clears a previously-selected transfer', () => {
    useSelection.setState({ selectedTransferId: 't1' });
    useSelection.getState().setLabelSelection(['g1']);
    expect(useSelection.getState().selectedTransferId).toBeNull();
    expect(useSelection.getState().selectedLabelIds).toEqual(['g1']);
  });

  it('setRouteBulletSelection clears a stale line AND transfer', () => {
    useSelection.setState({ selectedLineId: 'L1' as LineId, selectedTransferId: 't1' });
    useSelection.getState().setRouteBulletSelection(['b1']);
    const s = useSelection.getState();
    expect(s.selectedLineId).toBeNull();
    expect(s.selectedTransferId).toBeNull();
    expect(s.selectedRouteBulletIds).toEqual(['b1']);
  });

  it('setStationSelection clears a stale transfer', () => {
    useSelection.setState({ selectedTransferId: 't1' });
    useSelection.getState().setStationSelection(['A'] as StationId[]);
    expect(useSelection.getState().selectedTransferId).toBeNull();
  });

  it('addStationsToSelection clears a stale transfer (shared SIBLING_PRIMARY_CLEAR)', () => {
    useSelection.setState({ selectedTransferId: 't1' });
    useSelection.getState().addStationsToSelection(['A'] as StationId[]);
    expect(useSelection.getState().selectedTransferId).toBeNull();
  });

  it('toggleStationSelection (append branch) clears a stale transfer', () => {
    useSelection.setState({ selectedTransferId: 't1' });
    useSelection.getState().toggleStationSelection('A' as StationId);
    expect(useSelection.getState().selectedStationIds).toEqual(['A']);
    expect(useSelection.getState().selectedTransferId).toBeNull();
  });
});

describe('reconcileWithDoc', () => {
  // Build a doc whose entity maps contain exactly the given ids. Values are
  // presence-only — reconcileWithDoc just checks existence (and a polygon's
  // vertex count).
  const docWith = (present: {
    stations?: string[];
    lines?: string[];
    lineTags?: string[];
    transfers?: string[];
    routeBullets?: string[];
    textLabels?: string[];
    svgImages?: string[];
    polygons?: Record<string, { vertices: unknown[] }>;
  }): MapDoc => {
    const fill = (ids?: string[]) => Object.fromEntries((ids ?? []).map((id) => [id, {} as never]));
    return {
      ...DEFAULT_DOC,
      stations: fill(present.stations),
      lines: fill(present.lines),
      lineTags: fill(present.lineTags),
      transfers: fill(present.transfers),
      routeBullets: fill(present.routeBullets),
      textLabels: fill(present.textLabels),
      svgImages: fill(present.svgImages),
      polygons: (present.polygons ?? {}) as never,
    } as MapDoc;
  };

  it('prunes ids missing from the doc and keeps present ones', () => {
    useSelection.setState({
      selectedStationIds: ['s1', 's2'] as StationId[],
      selectedLabelIds: ['g1', 'g2'],
      selectedTransferId: 't1',
      selectedLineId: 'L1' as LineId,
    });
    useSelection
      .getState()
      .reconcileWithDoc(
        docWith({ stations: ['s1'], textLabels: ['g2'], transfers: [], lines: [] }),
      );
    const s = useSelection.getState();
    expect(s.selectedStationIds).toEqual(['s1']);
    expect(s.selectedLabelIds).toEqual(['g2']);
    expect(s.selectedTransferId).toBeNull();
    expect(s.selectedLineId).toBeNull();
  });

  it('keeps the same array reference when nothing dangles (no spurious update)', () => {
    const stationIds = ['s1', 's2'] as StationId[];
    useSelection.setState({ selectedStationIds: stationIds });
    useSelection.getState().reconcileWithDoc(docWith({ stations: ['s1', 's2'] }));
    expect(useSelection.getState().selectedStationIds).toBe(stationIds);
  });

  it('drops a selected vertex whose polygon shrank past its index', () => {
    useSelection.setState({ selectedVertex: { polygonId: 'p1', index: 4 } });
    useSelection
      .getState()
      .reconcileWithDoc(docWith({ polygons: { p1: { vertices: [0, 0, 0] } } }));
    expect(useSelection.getState().selectedVertex).toBeNull();
  });

  it('prunes bullets, polygons, and svg images missing from the doc', () => {
    useSelection.setState({
      selectedRouteBulletIds: ['b1', 'b2'],
      selectedPolygonIds: ['p1', 'p2'],
      selectedSvgImageIds: ['i1', 'i2'],
    });
    useSelection.getState().reconcileWithDoc(
      docWith({
        routeBullets: ['b1'],
        polygons: { p2: { vertices: [] } },
        svgImages: ['i2'],
      }),
    );
    const s = useSelection.getState();
    expect(s.selectedRouteBulletIds).toEqual(['b1']);
    expect(s.selectedPolygonIds).toEqual(['p2']);
    expect(s.selectedSvgImageIds).toEqual(['i2']);
  });

  it('clears dangling line-tag / hover / stop-editing state', () => {
    useSelection.setState({
      selectedLineTagId: 'lt1',
      editingStationId: 'st1' as StationId,
      selectedStopLineId: 'L1' as LineId,
      hoveredStationId: 'st2' as StationId,
    });
    useSelection.getState().reconcileWithDoc(docWith({}));
    const s = useSelection.getState();
    expect(s.selectedLineTagId).toBeNull();
    expect(s.editingStationId).toBeNull();
    expect(s.selectedStopLineId).toBeNull();
    expect(s.hoveredStationId).toBeNull();
  });

  it('keeps line-tag / hover / stop-editing state that still resolves', () => {
    useSelection.setState({
      selectedLineTagId: 'lt1',
      editingStationId: 'st1' as StationId,
      selectedStopLineId: 'L1' as LineId,
      hoveredStationId: 'st2' as StationId,
    });
    useSelection.getState().reconcileWithDoc(
      docWith({
        lineTags: ['lt1'],
        stations: ['st1', 'st2'],
        lines: ['L1'],
      }),
    );
    const s = useSelection.getState();
    expect(s.selectedLineTagId).toBe('lt1');
    expect(s.editingStationId).toBe('st1');
    expect(s.selectedStopLineId).toBe('L1');
    expect(s.hoveredStationId).toBe('st2');
  });

  it('drops a selected vertex whose polygon was deleted entirely', () => {
    useSelection.setState({ selectedVertex: { polygonId: 'p1', index: 0 } });
    useSelection.getState().reconcileWithDoc(docWith({}));
    expect(useSelection.getState().selectedVertex).toBeNull();
  });
});

describe('getCopyableSelection', () => {
  it('returns bullets/labels/polygons/svgImages but never stations', () => {
    useSelection.setState({
      selectedStationIds: ['s1'] as StationId[],
      selectedRouteBulletIds: ['b1'],
      selectedLabelIds: ['g1'],
      selectedPolygonIds: ['p1'],
      selectedSvgImageIds: ['i1'],
    });
    expect(getCopyableSelection(useSelection.getState())).toEqual({
      bullets: ['b1'],
      labels: ['g1'],
      polygons: ['p1'],
      svgImages: ['i1'],
    });
  });
});

describe('editing-station-layout mode', () => {
  it('startEditingStationLayout enters the mode with the station selected and mirror preserved', () => {
    useSelection.setState({
      mirrorMatching: true,
      selectedRouteBulletIds: ['b1'],
      selectedStopLineId: 'L9' as LineId,
    });
    useSelection.getState().startEditingStationLayout('A' as StationId);
    const s = useSelection.getState();
    expect(s.uiMode).toEqual({ kind: 'editing-station-layout', stationId: 'A' });
    expect(s.selectedStationIds).toEqual(['A']);
    expect(s.selectedRouteBulletIds).toEqual([]);
    expect(s.selectedStopLineId).toBeNull();
    // The whole point of the mode is layout editing — mirror survives entry
    // (a vanilla setUiMode would wipe it via clearedSelections).
    expect(s.mirrorMatching).toBe(true);
  });

  it('selecting a DIFFERENT station retargets the editor to it; re-selecting the same keeps it', () => {
    useSelection.getState().startEditingStationLayout('A' as StationId);
    useSelection.getState().selectStation('A' as StationId);
    expect(useSelection.getState().uiMode).toEqual({
      kind: 'editing-station-layout',
      stationId: 'A',
    });
    useSelection.getState().selectStation('B' as StationId);
    expect(useSelection.getState().uiMode).toEqual({
      kind: 'editing-station-layout',
      stationId: 'B',
    });
    expect(useSelection.getState().selectedStationIds).toEqual(['B']);
  });

  it('deselecting (selectStation null) exits the mode', () => {
    useSelection.getState().startEditingStationLayout('A' as StationId);
    useSelection.getState().selectStation(null);
    expect(useSelection.getState().uiMode.kind).toBe('idle');
    expect(useSelection.getState().selectedStationIds).toEqual([]);
  });

  it('right-click is a gesture in this mode (no mode cancel)', async () => {
    const { RIGHT_CLICK_PASSTHROUGH_MODES } = await import('./selection');
    expect(RIGHT_CLICK_PASSTHROUGH_MODES.has('editing-station-layout')).toBe(true);
  });
});

describe('editing-station-layout mode — selection reconciliation', () => {
  it('shift-click toggle onto ANOTHER station exits the mode', () => {
    useSelection.getState().startEditingStationLayout('A' as StationId);
    useSelection.getState().toggleStationSelection('B' as StationId);
    expect(useSelection.getState().uiMode.kind).toBe('idle');
  });

  it('toggling the edited station itself OFF exits the mode', () => {
    useSelection.getState().startEditingStationLayout('A' as StationId);
    useSelection.getState().toggleStationSelection('A' as StationId);
    expect(useSelection.getState().uiMode.kind).toBe('idle');
  });

  it('setStationSelection to a sole different station retargets; to a multi-selection exits', () => {
    useSelection.getState().startEditingStationLayout('A' as StationId);
    useSelection.getState().setStationSelection(['A'] as StationId[]);
    expect(useSelection.getState().uiMode.kind).toBe('editing-station-layout');
    useSelection.getState().setStationSelection(['B'] as StationId[]);
    expect(useSelection.getState().uiMode).toEqual({
      kind: 'editing-station-layout',
      stationId: 'B',
    });
    useSelection.getState().setStationSelection(['B', 'C'] as StationId[]);
    expect(useSelection.getState().uiMode.kind).toBe('idle');
  });

  it('add / xor extensions exit the mode too', () => {
    useSelection.getState().startEditingStationLayout('A' as StationId);
    useSelection.getState().addStationsToSelection(['B'] as StationId[]);
    expect(useSelection.getState().uiMode.kind).toBe('idle');

    useSelection.getState().startEditingStationLayout('A' as StationId);
    useSelection.getState().xorStationsToSelection(['B'] as StationId[]);
    expect(useSelection.getState().uiMode.kind).toBe('idle');
  });
});
