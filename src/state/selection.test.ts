import { describe, it, expect, beforeEach } from 'vitest';
import { useSelection } from './store';

beforeEach(() => {
  useSelection.setState({
    selectedStationIds: [],
    selectedLineId: null,
    appendingToLineId: null,
    insertAfterIndex: null,
    placingStation: false,
    selectedLineTagId: null,
    selectedRouteBulletId: null,
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
