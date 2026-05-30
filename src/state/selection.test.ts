import { describe, it, expect, beforeEach } from 'vitest';
import { useSelection } from './store';

beforeEach(() => {
  useSelection.setState({
    selectedStationIds: [],
    selectedRouteBulletIds: [],
    selectedLabelIds: [],
    selectedLineId: null,
    appendingToLineId: null,
    insertAfterIndex: null,
    placingStation: false,
    placingLabel: false,
    selectedLineTagId: null,
    selectedTransferId: null,
    creatingLineTag: false,
    creatingRouteBullet: false,
    creatingTransfer: false,
    transferAnchor: null,
    mirrorMatching: false,
    selectedStopLineId: null,
    labelSelected: false,
    editingStationId: null,
  });
});

describe('selection — array model', () => {
  it('initial state: empty array', () => {
    expect(useSelection.getState().selectedStationIds).toEqual([]);
  });

  describe('selectStation', () => {
    it('replaces with [id]', () => {
      const { selectStation } = useSelection.getState();
      selectStation('A');
      expect(useSelection.getState().selectedStationIds).toEqual(['A']);
    });

    it('null clears the array', () => {
      const { selectStation } = useSelection.getState();
      selectStation('A');
      selectStation(null);
      expect(useSelection.getState().selectedStationIds).toEqual([]);
    });

    it('replaces multi-selection with single', () => {
      useSelection.setState({ selectedStationIds: ['A', 'B', 'C'] });
      useSelection.getState().selectStation('D');
      expect(useSelection.getState().selectedStationIds).toEqual(['D']);
    });
  });

  describe('toggleStationSelection', () => {
    it('appends a new id (becomes anchor)', () => {
      const { toggleStationSelection } = useSelection.getState();
      toggleStationSelection('A');
      toggleStationSelection('B');
      const ids = useSelection.getState().selectedStationIds;
      expect(ids).toEqual(['A', 'B']);
      expect(ids[ids.length - 1]).toBe('B');
    });

    it('removes an existing id', () => {
      useSelection.setState({ selectedStationIds: ['A', 'B', 'C'] });
      useSelection.getState().toggleStationSelection('B');
      expect(useSelection.getState().selectedStationIds).toEqual(['A', 'C']);
    });

    it('add then toggle off then re-add: anchor follows latest insertion', () => {
      const { toggleStationSelection } = useSelection.getState();
      toggleStationSelection('A');
      toggleStationSelection('A');
      expect(useSelection.getState().selectedStationIds).toEqual([]);
      toggleStationSelection('A');
      expect(useSelection.getState().selectedStationIds).toEqual(['A']);
    });
  });

  describe('setStationSelection', () => {
    it('replaces with the given ids exactly', () => {
      useSelection.setState({ selectedStationIds: ['X'] });
      useSelection.getState().setStationSelection(['A', 'B', 'C']);
      expect(useSelection.getState().selectedStationIds).toEqual(['A', 'B', 'C']);
    });

    it('empty array clears', () => {
      useSelection.setState({ selectedStationIds: ['A', 'B'] });
      useSelection.getState().setStationSelection([]);
      expect(useSelection.getState().selectedStationIds).toEqual([]);
    });

    it('dedupes preserving last position', () => {
      useSelection.getState().setStationSelection(['A', 'B', 'A']);
      const ids = useSelection.getState().selectedStationIds;
      expect(ids).toEqual(['B', 'A']);
    });
  });

  describe('addStationsToSelection', () => {
    it('unions, preserving prior order, appending novel ids', () => {
      useSelection.setState({ selectedStationIds: ['A', 'B'] });
      useSelection.getState().addStationsToSelection(['B', 'C', 'D']);
      expect(useSelection.getState().selectedStationIds).toEqual(['A', 'B', 'C', 'D']);
    });

    it('no-op when all ids already selected', () => {
      useSelection.setState({ selectedStationIds: ['A', 'B'] });
      const before = useSelection.getState().selectedStationIds;
      useSelection.getState().addStationsToSelection(['B', 'A']);
      expect(useSelection.getState().selectedStationIds).toEqual(before);
    });
  });

  describe('xorStationsToSelection', () => {
    it('removes intersection, appends rest', () => {
      useSelection.setState({ selectedStationIds: ['A', 'B', 'C'] });
      useSelection.getState().xorStationsToSelection(['B', 'D']);
      expect(useSelection.getState().selectedStationIds).toEqual(['A', 'C', 'D']);
    });

    it('appended ids become the anchor', () => {
      useSelection.setState({ selectedStationIds: ['A'] });
      useSelection.getState().xorStationsToSelection(['B', 'C']);
      const ids = useSelection.getState().selectedStationIds;
      expect(ids[ids.length - 1]).toBe('C');
    });

    it('empty arg is a no-op', () => {
      useSelection.setState({ selectedStationIds: ['A', 'B'] });
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
      useSelection.setState({ selectedStationIds: ['A', 'B'] });
      useSelection.getState().selectRouteBullet('b1');
      expect(useSelection.getState().selectedStationIds).toEqual([]);
      expect(useSelection.getState().selectedRouteBulletIds).toEqual(['b1']);
    });

    it('selectStation clears bullets too — plain click is exclusive', () => {
      useSelection.setState({ selectedRouteBulletIds: ['b1', 'b2'] });
      useSelection.getState().selectStation('S1');
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
      useSelection.setState({ selectedStationIds: ['A'], selectedRouteBulletIds: [] });
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
        selectedStationIds: ['A'],
        selectedRouteBulletIds: ['b1'],
      });
      useSelection.getState().selectLabel('g1');
      expect(useSelection.getState().selectedStationIds).toEqual([]);
      expect(useSelection.getState().selectedRouteBulletIds).toEqual([]);
      expect(useSelection.getState().selectedLabelIds).toEqual(['g1']);
    });

    it('selectStation clears labels too — plain click is exclusive', () => {
      useSelection.setState({ selectedLabelIds: ['g1', 'g2'] });
      useSelection.getState().selectStation('S1');
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

  describe('setPlacingLabel', () => {
    it('entering label-placement clears other modes and selections', () => {
      useSelection.setState({
        placingStation: true,
        creatingLineTag: true,
        creatingRouteBullet: true,
        creatingTransfer: true,
        appendingToLineId: 'L1',
        insertAfterIndex: 0,
        selectedStationIds: ['A'],
        selectedRouteBulletIds: ['b1'],
        selectedLineId: 'L1',
      });
      useSelection.getState().setPlacingLabel(true);
      const s = useSelection.getState();
      expect(s.placingLabel).toBe(true);
      expect(s.placingStation).toBe(false);
      expect(s.creatingLineTag).toBe(false);
      expect(s.creatingRouteBullet).toBe(false);
      expect(s.creatingTransfer).toBe(false);
      expect(s.appendingToLineId).toBeNull();
      expect(s.selectedStationIds).toEqual([]);
      expect(s.selectedRouteBulletIds).toEqual([]);
      expect(s.selectedLineId).toBeNull();
    });

    it('setPlacingStation(true) cancels placingLabel', () => {
      useSelection.setState({ placingLabel: true });
      useSelection.getState().setPlacingStation(true);
      expect(useSelection.getState().placingLabel).toBe(false);
    });

    it('setCreatingRouteBullet(true) cancels placingLabel', () => {
      useSelection.setState({ placingLabel: true });
      useSelection.getState().setCreatingRouteBullet(true);
      expect(useSelection.getState().placingLabel).toBe(false);
    });
  });

  describe('setLayeringMode', () => {
    it('entering layering mode clears every other mode + selection', () => {
      useSelection.setState({
        placingStation: true,
        placingLabel: true,
        creatingLineTag: true,
        creatingRouteBullet: true,
        creatingTransfer: true,
        transferAnchor: { stationId: 'A', lineId: 'L1' },
        appendingToLineId: 'L1',
        insertAfterIndex: 0,
        selectedStationIds: ['A'],
        selectedRouteBulletIds: ['b1'],
        selectedLabelIds: ['g1'],
        selectedLineId: 'L1',
        selectedLineTagId: 't1',
        selectedTransferId: 'x1',
      });
      useSelection.getState().setLayeringMode(true);
      const s = useSelection.getState();
      expect(s.layeringMode).toBe(true);
      expect(s.placingStation).toBe(false);
      expect(s.placingLabel).toBe(false);
      expect(s.creatingLineTag).toBe(false);
      expect(s.creatingRouteBullet).toBe(false);
      expect(s.creatingTransfer).toBe(false);
      expect(s.transferAnchor).toBeNull();
      expect(s.appendingToLineId).toBeNull();
      expect(s.insertAfterIndex).toBeNull();
      expect(s.selectedStationIds).toEqual([]);
      expect(s.selectedRouteBulletIds).toEqual([]);
      expect(s.selectedLabelIds).toEqual([]);
      expect(s.selectedLineId).toBeNull();
      expect(s.selectedLineTagId).toBeNull();
      expect(s.selectedTransferId).toBeNull();
    });

    it('setPlacingStation(true) cancels layeringMode', () => {
      useSelection.setState({ layeringMode: true });
      useSelection.getState().setPlacingStation(true);
      expect(useSelection.getState().layeringMode).toBe(false);
    });

    it('setPlacingLabel(true) cancels layeringMode', () => {
      useSelection.setState({ layeringMode: true });
      useSelection.getState().setPlacingLabel(true);
      expect(useSelection.getState().layeringMode).toBe(false);
    });

    it('setCreatingLineTag(true) cancels layeringMode', () => {
      useSelection.setState({ layeringMode: true });
      useSelection.getState().setCreatingLineTag(true);
      expect(useSelection.getState().layeringMode).toBe(false);
    });

    it('setCreatingRouteBullet(true) cancels layeringMode', () => {
      useSelection.setState({ layeringMode: true });
      useSelection.getState().setCreatingRouteBullet(true);
      expect(useSelection.getState().layeringMode).toBe(false);
    });

    it('setCreatingTransfer(true) cancels layeringMode', () => {
      useSelection.setState({ layeringMode: true });
      useSelection.getState().setCreatingTransfer(true);
      expect(useSelection.getState().layeringMode).toBe(false);
    });

    it('setAppending(non-null) cancels layeringMode', () => {
      useSelection.setState({ layeringMode: true });
      useSelection.getState().setAppending('L1');
      expect(useSelection.getState().layeringMode).toBe(false);
    });

    it('setLayeringMode(false) leaves other modes alone', () => {
      // Cross-check: turning OFF layering mode is purely additive — it
      // must not nuke unrelated state. Some other mode being active here
      // shouldn't happen in practice (they're mutually exclusive), but the
      // exit path should be a clean no-op against everything else.
      useSelection.setState({
        layeringMode: true,
        selectedStationIds: ['A'],
        selectedLineId: 'L1',
      });
      useSelection.getState().setLayeringMode(false);
      const s = useSelection.getState();
      expect(s.layeringMode).toBe(false);
      expect(s.selectedStationIds).toEqual(['A']);
      expect(s.selectedLineId).toBe('L1');
    });
  });
});
