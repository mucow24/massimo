import { describe, it, expect, beforeEach } from 'vitest';
import { beginHistoryGroup, useDoc } from '../state/store';
import { useViewportStore } from '../state/viewportStore';
import { useSelection } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
});

describe('undo/redo', () => {
  it('undoes addStation', () => {
    const { addStation } = useDoc.getState();
    addStation(0, 0);
    expect(Object.keys(useDoc.getState().stations)).toHaveLength(1);
    useDoc.temporal.getState().undo();
    expect(Object.keys(useDoc.getState().stations)).toHaveLength(0);
  });

  it('redoes after undo', () => {
    const { addStation } = useDoc.getState();
    addStation(0, 0);
    useDoc.temporal.getState().undo();
    useDoc.temporal.getState().redo();
    expect(Object.keys(useDoc.getState().stations)).toHaveLength(1);
  });

  it('does NOT capture viewport in history', () => {
    useViewportStore.setState({ x: 0, y: 0, zoom: 1 });
    const { addStation } = useDoc.getState();
    addStation(0, 0);
    useViewportStore.getState().setViewport({ x: 50, y: 50, zoom: 2 });
    useDoc.temporal.getState().undo();
    // Viewport unchanged by undoing the station add.
    expect(useViewportStore.getState().zoom).toBe(2);
    expect(useViewportStore.getState().x).toBe(50);
  });

  it('does NOT capture selection in history', () => {
    const { addStation } = useDoc.getState();
    const id = addStation(0, 0);
    useSelection.getState().selectStation(id);
    expect(useSelection.getState().selectedStationIds).toEqual([id]);
    useDoc.temporal.getState().undo();
    // Station gone, but selection store is independent.
    expect(useSelection.getState().selectedStationIds).toEqual([id]);
  });
});

describe('beginHistoryGroup', () => {
  it('coalesces a burst of mutations into one history entry', () => {
    // Simulate a station drag: many moveStation calls between begin and commit.
    const id = useDoc.getState().addStation(0, 0);
    const beforeUndoStack = useDoc.temporal.getState().pastStates.length;
    const group = beginHistoryGroup();
    for (let i = 0; i < 30; i++) {
      useDoc.getState().moveStation(id, i, i);
    }
    group.commit();
    const afterUndoStack = useDoc.temporal.getState().pastStates.length;
    // Exactly one new entry, regardless of the 30 moveStation calls.
    expect(afterUndoStack - beforeUndoStack).toBe(1);
  });

  it('a single undo after the group reverts the entire burst', () => {
    const id = useDoc.getState().addStation(0, 0);
    const group = beginHistoryGroup();
    useDoc.getState().moveStation(id, 50, 50);
    useDoc.getState().moveStation(id, 100, 100);
    useDoc.getState().moveStation(id, 200, 200);
    group.commit();
    useDoc.temporal.getState().undo();
    // Back to the position from before the group started (post-addStation).
    expect(useDoc.getState().stations[id].x).toBe(0);
    expect(useDoc.getState().stations[id].y).toBe(0);
  });

  it('cancel() discards the snapshot without adding to history', () => {
    useDoc.getState().addStation(0, 0);
    const beforeUndoStack = useDoc.temporal.getState().pastStates.length;
    const group = beginHistoryGroup();
    // No edits.
    group.cancel();
    expect(useDoc.temporal.getState().pastStates.length).toBe(beforeUndoStack);
  });

  it('commit() with no changes is a no-op (does not litter history)', () => {
    useDoc.getState().addStation(0, 0);
    const beforeUndoStack = useDoc.temporal.getState().pastStates.length;
    const group = beginHistoryGroup();
    // No edits between begin and commit (e.g. focus → blur with no typing).
    group.commit();
    expect(useDoc.temporal.getState().pastStates.length).toBe(beforeUndoStack);
  });

  // Regression: the commit() equality check used to enumerate doc fields
  // by hand and missed labelFontSize / labelWeight / labelItalic /
  // activePalettes. Slider drags wrapped in useFieldHistory pause zundo
  // and then the manual push thinks nothing changed, so the entire edit
  // is silently lost from the undo stack.
  describe('commits a history entry for every tracked doc field', () => {
    it('labelFontSize', () => {
      const before = useDoc.temporal.getState().pastStates.length;
      const group = beginHistoryGroup();
      useDoc.getState().setLabelFontSize(useDoc.getState().labelFontSize + 4);
      group.commit();
      expect(useDoc.temporal.getState().pastStates.length - before).toBe(1);
    });

    it('labelWeight', () => {
      const before = useDoc.temporal.getState().pastStates.length;
      const group = beginHistoryGroup();
      useDoc.getState().setLabelWeight(700);
      group.commit();
      expect(useDoc.temporal.getState().pastStates.length - before).toBe(1);
    });

    it('labelItalic', () => {
      const before = useDoc.temporal.getState().pastStates.length;
      const group = beginHistoryGroup();
      useDoc.getState().setLabelItalic(!useDoc.getState().labelItalic);
      group.commit();
      expect(useDoc.temporal.getState().pastStates.length - before).toBe(1);
    });

    it('activePalettes', () => {
      const before = useDoc.temporal.getState().pastStates.length;
      const group = beginHistoryGroup();
      useDoc.getState().setActivePalettes(['mta', 'tokyo-subway']);
      group.commit();
      expect(useDoc.temporal.getState().pastStates.length - before).toBe(1);
    });
  });
});
