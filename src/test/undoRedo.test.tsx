import { describe, it, expect, beforeEach } from 'vitest';
import { beginHistoryGroup, useDoc, HISTORY_LIMIT } from '../state/store';
import { undo, redo, historyDepth, isHistoryGrouping } from '../state/history';
import { useViewportStore } from '../state/viewportStore';
import { useSelection } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import type { RegionAssignment } from '../model/types';

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

  it('undo restores the station VALUE, not just the count', () => {
    // Create a station, then mutate it (move + rename) inside one history group.
    // Undo must roll the whole station back to its pre-group field values —
    // asserting the count alone would pass even if undo restored a coord-blank
    // shell.
    const id = useDoc.getState().addStation(0, 0, 'Origin');
    const group = beginHistoryGroup();
    useDoc.getState().moveStation(id, 120, 90);
    useDoc.getState().renameStation(id, 'Moved');
    group.commit();
    // Pre-undo: the post-group values are live.
    expect(useDoc.getState().stations[id]).toMatchObject({ x: 120, y: 90, name: 'Moved' });
    undo();
    const st = useDoc.getState().stations[id];
    expect(st.x).toBe(0);
    expect(st.y).toBe(0);
    expect(st.name).toBe('Origin');
    expect(st.stops).toEqual([]);
  });

  it('redoes after undo', () => {
    const { addStation } = useDoc.getState();
    addStation(0, 0);
    undo();
    redo();
    expect(Object.keys(useDoc.getState().stations)).toHaveLength(1);
  });

  it('redo restores the post-edit station VALUE, not just the count', () => {
    const id = useDoc.getState().addStation(0, 0, 'Origin');
    const group = beginHistoryGroup();
    useDoc.getState().moveStation(id, 120, 90);
    useDoc.getState().renameStation(id, 'Moved');
    group.commit();
    undo();
    redo();
    const st = useDoc.getState().stations[id];
    expect(st.x).toBe(120);
    expect(st.y).toBe(90);
    expect(st.name).toBe('Moved');
    expect(st.stops).toEqual([]);
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

  it('reconciles selection against the doc after REDO (drops dangling ids)', () => {
    // Symmetric to the undo-side reconcile above, guarding history.ts:35.
    // Select a station, delete it (history push), then undo the delete so the
    // station — and its still-live selection — come back. Redoing the delete
    // must prune the now-missing station from the selection, not leave it as a
    // dangling id.
    const id = useDoc.getState().addStation(0, 0);
    useSelection.getState().selectStation(id);
    useDoc.getState().deleteStation(id);
    undo();
    // After undo the station is back and is still selected.
    expect(useDoc.getState().stations[id]).toBeDefined();
    expect(useSelection.getState().selectedStationIds).toEqual([id]);
    redo();
    // Redo removes the station again; the selection is reconciled against the
    // post-redo doc, so the dangling id is dropped.
    expect(useDoc.getState().stations[id]).toBeUndefined();
    expect(useSelection.getState().selectedStationIds).toEqual([]);
  });

  it('undoes a whole region flood as ONE entry', () => {
    // A shift-click in layering mode writes the seed face plus every face the
    // flood carried the winner to. However many that is, it's one user action,
    // so it must cost exactly one undo — hence the list-taking writer.
    const asg = (lineId: string): RegionAssignment => ({
      id: '',
      lineId,
      lines: ['l1', lineId],
      anchors: [],
    });
    useDoc.getState().assignRegions([
      { id: null, assignment: asg('l2') },
      { id: null, assignment: asg('l3') },
      { id: null, assignment: asg('l4') },
    ]);
    // Three survivors ⇒ each null id minted its own (a collision would merge).
    expect(Object.keys(useDoc.getState().regionAssignments)).toHaveLength(3);
    expect(historyDepth()).toBe(1);
    undo();
    expect(useDoc.getState().regionAssignments).toEqual({});
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

  it('grouped commits respect the history limit (oldest entries drop off)', () => {
    // zundo enforces the same `limit` in its own set-handler, but nearly every
    // user gesture (drags, field-edit arcs) records through beginHistoryGroup
    // → pushHistory instead. If that path doesn't apply the same cap, a long
    // session grows the undo stack without bound.
    const OVERFLOW = 5;
    const id = useDoc.getState().addStation(0, 0);
    for (let i = 1; i <= HISTORY_LIMIT + OVERFLOW; i++) {
      const group = beginHistoryGroup();
      useDoc.getState().moveStation(id, i, 0);
      group.commit();
    }
    expect(historyDepth()).toBe(HISTORY_LIMIT);
    // The kept entries are the NEWEST HISTORY_LIMIT snapshots. addStation pushed
    // one snapshot before the loop, so the stack overflowed by OVERFLOW + 1 and
    // the oldest survivor is the move to x = OVERFLOW. Undoing the whole stack
    // lands there, not on the original station add.
    for (let i = 0; i < HISTORY_LIMIT; i++) undo();
    expect(useDoc.getState().stations[id].x).toBe(OVERFLOW);
  });

  // Regression: the commit() equality check used to enumerate doc fields by
  // hand and missed some (e.g. the since-retired label settings, activePalettes).
  // Slider drags wrapped in useFieldHistory pause zundo and then the manual push
  // thinks nothing changed, so the entire edit is silently lost from the undo
  // stack. Now driven by DOC_FIELDS, so every tracked field is covered.
  // Overlapping (NOT nested) group lifetimes: two independent gestures can
  // interleave because pointer order is pointerdown → blur. Pressing a canvas
  // handle opens the drag's group BEFORE the focused field's blur-commit
  // lands, and that late commit used to resume recording inside the still-open
  // drag — every fan-out write then recorded its own entry plus the drag's
  // snapshot on top (non-monotonic undo). The contract: the NEWER gesture
  // steals — begin seals any still-open group as one entry, and the elder's
  // late commit/cancel/rollback is a no-op.
  describe('overlapping groups (newest gesture steals)', () => {
    beforeEach(() => {
      // A failing case above may strand recording paused; start each clean.
      useDoc.temporal.getState().resume();
    });

    it('a drag group opened before a field group ends stays one entry (pointerdown-before-blur)', () => {
      // The reported repro: dot-size spinbutton focused (field group open),
      // press a layout-editor stop handle (drag group opens), blur lands late,
      // then the mirror fan-out writes one station per captured target.
      const a = useDoc.getState().addStation(0, 0);
      const b = useDoc.getState().addStation(100, 0);
      const c = useDoc.getState().addStation(200, 0);
      const base = historyDepth();

      const field = beginHistoryGroup(); // spinbutton focus
      useDoc.getState().setDocName('Renamed'); // field edit
      const drag = beginHistoryGroup(); // handle pointerdown — blur not yet fired
      field.commit(); // blur arrives late
      useDoc.getState().moveStation(a, 0, 50); // fan-out: one write per target
      useDoc.getState().moveStation(b, 100, 50);
      useDoc.getState().moveStation(c, 200, 50);
      drag.commit(); // pointerup

      // Two gestures → exactly two entries, not N+2.
      expect(historyDepth() - base).toBe(2);
      // Undo #1 unwinds the whole drag, leaving the committed field edit…
      undo();
      expect(useDoc.getState().stations[a].y).toBe(0);
      expect(useDoc.getState().stations[b].y).toBe(0);
      expect(useDoc.getState().stations[c].y).toBe(0);
      expect(useDoc.getState().name).toBe('Renamed');
      // …and undo #2 the field edit. Monotonic — never forward.
      undo();
      expect(useDoc.getState().name).toBe(DEFAULT_DOC.name);
    });

    it('begin while a group is open seals the elder immediately; its late end is a no-op', () => {
      const base = historyDepth();
      const elder = beginHistoryGroup();
      useDoc.getState().setDocName('Renamed');
      const newer = beginHistoryGroup();
      // The steal itself sealed the elder's edit as one entry…
      expect(historyDepth() - base).toBe(1);
      expect(isHistoryGrouping()).toBe(true);
      // …so the elder's own commit must neither push nor resume recording
      // inside the newer group.
      elder.commit();
      expect(historyDepth() - base).toBe(1);
      expect(isHistoryGrouping()).toBe(true);
      newer.cancel();
    });

    it("a stolen group's rollback is a no-op (cannot clobber the newer gesture)", () => {
      const id = useDoc.getState().addStation(0, 0);
      const elder = beginHistoryGroup();
      useDoc.getState().moveStation(id, 10, 10);
      const newer = beginHistoryGroup();
      useDoc.getState().moveStation(id, 99, 99);
      // A late abort (browser pointercancel racing a new gesture) of the
      // already-sealed elder must not restore ITS snapshot over the newer
      // gesture's writes, nor resume recording under it.
      elder.rollback();
      expect(useDoc.getState().stations[id].x).toBe(99);
      expect(isHistoryGrouping()).toBe(true);
      // The newer gesture's own rollback unwinds to its OWN start.
      newer.rollback();
      expect(useDoc.getState().stations[id].x).toBe(10);
      expect(isHistoryGrouping()).toBe(false);
    });

    it('a leaked-open group is healed by the next begin, its edits recovered as an entry', () => {
      const base = historyDepth();
      beginHistoryGroup(); // gesture died without commit/cancel/rollback
      useDoc.getState().setDocName('First');
      const next = beginHistoryGroup(); // heals: seals the stranded edit
      useDoc.getState().setDocName('Second');
      next.commit();
      // Both edits are separately undoable — the leaked one isn't baked in.
      expect(historyDepth() - base).toBe(2);
      undo();
      expect(useDoc.getState().name).toBe('First');
      undo();
      expect(useDoc.getState().name).toBe(DEFAULT_DOC.name);
      expect(isHistoryGrouping()).toBe(false);
    });
  });

  describe('commits a history entry for every tracked doc field', () => {
    it('updateStationLabelStyle (per-station typography)', () => {
      const sid = useDoc.getState().addStation(0, 0, 'S');
      const before = historyDepth();
      const group = beginHistoryGroup();
      useDoc.getState().updateStationLabelStyle(sid, { fontSize: 20 });
      group.commit();
      expect(historyDepth() - before).toBe(1);
    });

    it('palettes', () => {
      const before = historyDepth();
      const group = beginHistoryGroup();
      useDoc
        .getState()
        .addPaletteToMap({ name: 'frrf', swatches: [{ name: '1', color: '#c1272d' }] });
      group.commit();
      expect(historyDepth() - before).toBe(1);
    });
  });
});
