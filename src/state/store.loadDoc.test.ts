import { describe, it, expect, beforeEach } from 'vitest';
import { beginHistoryGroup, useDoc } from './store';
import { clearHistory, historyDepth, redoDepth, undo } from './history';
import { DEFAULT_DOC } from '../model/transforms';
import type { Station } from '../model/types';

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
});

const station = (id: string, x: number, y: number): Station => ({
  id,
  name: id.toUpperCase(),
  x,
  y,
  rotation: 0,
  stops: [],
  label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
});

describe('loadDoc', () => {
  it('replaces the document wholesale, resetting fields the loaded doc omits', () => {
    // Dirty the current doc: a station and a non-default curveRadius.
    useDoc.getState().addStation(10, 20, 'Old');
    useDoc.setState({ ...useDoc.getState(), curveRadius: 80 });
    const oldIds = Object.keys(useDoc.getState().stations);
    expect(oldIds).toHaveLength(1);

    useDoc.getState().loadDoc({
      ...DEFAULT_DOC,
      name: 'Loaded map',
      stations: { a: station('a', 0, 0) },
    });

    const s = useDoc.getState();
    expect(s.name).toBe('Loaded map');
    expect(Object.keys(s.stations)).toEqual(['a']);
    // curveRadius wasn't in the loaded doc's non-default fields — it must
    // come back as the default, not leak through from the replaced doc.
    expect(s.curveRadius).toBe(DEFAULT_DOC.curveRadius);
  });

  it('preserves the store mutators (a load is a merge, not a state swap)', () => {
    useDoc.getState().loadDoc({ ...DEFAULT_DOC, name: 'Loaded map' });
    useDoc.getState().addStation(5, 5, 'After');
    expect(Object.keys(useDoc.getState().stations)).toHaveLength(1);
  });
});

describe('clearHistory', () => {
  it('empties both the undo and redo stacks', () => {
    useDoc.getState().addStation(1, 1, 'A');
    useDoc.getState().addStation(2, 2, 'B');
    expect(historyDepth()).toBe(2);
    undo();
    expect(redoDepth()).toBe(1);

    clearHistory();
    expect(historyDepth()).toBe(0);
    expect(redoDepth()).toBe(0);
  });

  // A group open ACROSS the load (pointer order makes a focused field's blur
  // land after anything; a drag can die mid-gesture) holds a snapshot of the
  // REPLACED document. clearHistory must cancel it — otherwise its late end,
  // or the next begin's steal, pushes that pre-load snapshot and undo crosses
  // the file load.
  it("cancels an open group: a gesture's late end can't push a cross-load entry", () => {
    const group = beginHistoryGroup(); // e.g. a focused field's edit arc
    useDoc.getState().addStation(1, 1, 'Old');
    useDoc.getState().loadDoc({ ...DEFAULT_DOC, name: 'Loaded map' });
    clearHistory();
    group.commit(); // blur arrives after the load
    expect(historyDepth()).toBe(0);
    // …and recording is live again for post-load edits.
    useDoc.getState().addStation(5, 5, 'After');
    expect(historyDepth()).toBe(1);
  });

  it("forgets the open group: the next begin can't resurrect its pre-load snapshot", () => {
    beginHistoryGroup(); // leaked mid-gesture across the load
    useDoc.getState().addStation(1, 1, 'Old');
    useDoc.getState().loadDoc({ ...DEFAULT_DOC, name: 'Loaded map' });
    clearHistory();
    const next = beginHistoryGroup(); // steal must find nothing to seal
    expect(historyDepth()).toBe(0);
    next.cancel();
  });
});
