import { describe, it, expect, beforeEach } from 'vitest';
import { useSelection } from './store';

beforeEach(() => {
  useSelection.setState({
    selectedStationIds: [],
    selectedRouteBulletIds: [],
    selectedLineId: null,
    appendingToLineId: null,
    insertAfterIndex: null,
    placingStation: false,
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
