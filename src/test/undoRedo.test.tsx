import { describe, it, expect, beforeEach } from 'vitest';
import { beginHistoryGroup, useDoc } from '../state/store';
import { undo, redo, historyDepth } from '../state/history';
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
    undo();
    expect(Object.keys(useDoc.getState().stations)).toHaveLength(0);
  });

  it('redoes after undo', () => {
    const { addStation } = useDoc.getState();
    addStation(0, 0);
    undo();
    redo();
    expect(Object.keys(useDoc.getState().stations)).toHaveLength(1);
  });

  it('does NOT capture viewport in history', () => {
    useViewportStore.setState({ x: 0, y: 0, zoom: 1 });
    const { addStation } = useDoc.getState();
    addStation(0, 0);
    useViewportStore.getState().setViewport({ x: 50, y: 50, zoom: 2 });
    undo();
    // Viewport unchanged by undoing the station add.
    expect(useViewportStore.getState().zoom).toBe(2);
    expect(useViewportStore.getState().x).toBe(50);
  });

  it('an ungrouped no-op mutation does not push a redundant history entry', () => {
    // moveLabel by (0,0) short-circuits and returns the doc unchanged. zundo
    // has no diff/equality by default and pickDocSnapshot allocates fresh, so
    // without the `equality: docSnapshotsEqual` guard this would still record a
    // past entry — making the next Ctrl+Z appear to do nothing.
    const id = useDoc.getState().addStation(0, 0);
    const before = historyDepth();
    useDoc.getState().moveLabel(id, 0, 0);
    expect(historyDepth()).toBe(before);
  });

  it('reconciles selection against the doc after undo (drops dangling ids)', () => {
    const { addStation } = useDoc.getState();
    const id = addStation(0, 0);
    useSelection.getState().selectStation(id);
    expect(useSelection.getState().selectedStationIds).toEqual([id]);
    undo();
    // The selection store is separate from the undo snapshot, so undo never
    // *restores* a prior selection — but it DOES reconcile the live selection
    // against the restored doc. The station the undo removed is pruned rather
    // than left as a dangling id that consumers would index into a missing
    // station.
    expect(useDoc.getState().stations[id]).toBeUndefined();
    expect(useSelection.getState().selectedStationIds).toEqual([]);
  });
});

describe('beginHistoryGroup', () => {
  it('coalesces a burst of mutations into one history entry', () => {
    // Simulate a station drag: many moveStation calls between begin and commit.
    const id = useDoc.getState().addStation(0, 0);
    const beforeUndoStack = historyDepth();
    const group = beginHistoryGroup();
    for (let i = 0; i < 30; i++) {
      useDoc.getState().moveStation(id, i, i);
    }
    group.commit();
    const afterUndoStack = historyDepth();
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
    undo();
    // Back to the position from before the group started (post-addStation).
    expect(useDoc.getState().stations[id].x).toBe(0);
    expect(useDoc.getState().stations[id].y).toBe(0);
  });

  it('cancel() discards the snapshot without adding to history', () => {
    useDoc.getState().addStation(0, 0);
    const beforeUndoStack = historyDepth();
    const group = beginHistoryGroup();
    // No edits.
    group.cancel();
    expect(historyDepth()).toBe(beforeUndoStack);
  });

  it('commit() with no changes is a no-op (does not litter history)', () => {
    useDoc.getState().addStation(0, 0);
    const beforeUndoStack = historyDepth();
    const group = beginHistoryGroup();
    // No edits between begin and commit (e.g. focus → blur with no typing).
    group.commit();
    expect(historyDepth()).toBe(beforeUndoStack);
  });

  // Regression: the commit() equality check used to enumerate doc fields
  // by hand and missed labelFontSize / labelWeight / labelItalic /
  // activePalettes. Slider drags wrapped in useFieldHistory pause zundo
  // and then the manual push thinks nothing changed, so the entire edit
  // is silently lost from the undo stack.
  describe('commits a history entry for every tracked doc field', () => {
    it('labelFontSize', () => {
      const before = historyDepth();
      const group = beginHistoryGroup();
      useDoc.getState().setLabelFontSize(useDoc.getState().labelFontSize + 4);
      group.commit();
      expect(historyDepth() - before).toBe(1);
    });

    it('labelWeight', () => {
      const before = historyDepth();
      const group = beginHistoryGroup();
      useDoc.getState().setLabelWeight(700);
      group.commit();
      expect(historyDepth() - before).toBe(1);
    });

    it('labelItalic', () => {
      const before = historyDepth();
      const group = beginHistoryGroup();
      useDoc.getState().setLabelItalic(!useDoc.getState().labelItalic);
      group.commit();
      expect(historyDepth() - before).toBe(1);
    });

    it('activePalettes', () => {
      const before = historyDepth();
      const group = beginHistoryGroup();
      useDoc.getState().setActivePalettes(['mta', 'tokyo-subway']);
      group.commit();
      expect(historyDepth() - before).toBe(1);
    });
  });
});
