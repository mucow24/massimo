import { describe, it, expect, beforeEach } from 'vitest';
import { useSelection, type UiMode } from './store';
import type { LineId, StationId } from '../model/types';

beforeEach(() => {
  useSelection.setState({
    selectedStationIds: [],
    selectedRouteBulletIds: [],
    selectedLabelIds: [],
    selectedLineId: null,
    uiMode: { kind: 'idle' },
    mirrorMatching: false,
    selectedStopLineId: null,
    labelSelected: false,
    editingStationId: null,
    selectedLineTagId: null,
    selectedTransferId: null,
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
