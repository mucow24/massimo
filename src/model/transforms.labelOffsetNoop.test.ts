import { describe, it, expect, beforeEach } from 'vitest';
import * as T from '../model/transforms';
import { DEFAULT_DOC } from '../model/transforms';
import { beginHistoryGroup, useDoc } from '../state/store';
import { historyDepth, redo, undo } from '../state/history';
import { makeDoc, makeStation } from '../test/fixtures';

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
});

describe('setLabelOffset no-op identity (ARCHITECTURE: transforms return the same reference on no-op)', () => {
  it('is reference-equal to input when the value is unchanged (like setLabelOffsetPerp)', () => {
    const doc = makeDoc({ stations: [makeStation({ id: 's1' })] });
    // Control: the sibling transform DOES guard (pinned by transforms.test.ts's
    // 'is reference-equal to input when the value is unchanged').
    expect(T.setLabelOffsetPerp(doc, 's1', 0)).toBe(doc);
    // The claim: the along-reading-direction twin does not.
    expect(T.setLabelOffset(doc, 's1', 0)).toBe(doc);
  });

  it('an ungrouped value-identical write does not push a history entry', () => {
    const id = useDoc.getState().addStation(0, 0);
    expect(useDoc.getState().stations[id].label.offset).toBe(0);
    const before = historyDepth();
    useDoc.getState().setLabelOffset(id, 0); // same value as already stored
    expect(historyDepth()).toBe(before);
  });

  it('a grouped run of value-identical writes consumes no undo', () => {
    // The live streamers of a same-value write are the mirror fan-out (a match
    // already sitting at the broadcast value) and the Alt+arrow nudge, whose
    // dPerp is 0 on a non-diagonal reading axis — so every move writes the
    // perpendicular offset back unchanged. useFieldHistory opens a group on
    // focus and commits on blur; the guard is what keeps that group empty.
    const id = useDoc.getState().addStation(0, 0, 'Origin');
    useDoc.getState().renameStation(id, 'Renamed'); // one real entry to undo
    const depthAfterRealEdit = historyDepth();

    const group = beginHistoryGroup(); // thumb focus
    for (let i = 0; i < 6; i++) useDoc.getState().setLabelOffset(id, 0);
    group.commit(); // thumb blur

    expect(historyDepth()).toBe(depthAfterRealEdit);
  });

  it('one Ctrl+Z after a no-op-only gesture undoes the previous real edit', () => {
    const id = useDoc.getState().addStation(0, 0, 'Origin');
    useDoc.getState().renameStation(id, 'Renamed'); // the last REAL edit

    const group = beginHistoryGroup(); // thumb focus
    for (let i = 0; i < 3; i++) useDoc.getState().setLabelOffset(id, 0);
    group.commit(); // thumb blur

    undo(); // the user's single Ctrl+Z
    expect(useDoc.getState().stations[id].name).toBe('Origin');
  });

  it('a value-identical write does not destroy the redo stack', () => {
    // `pushHistory` (history.ts) clears futureStates, so the dead entry also
    // strands a pending redo.
    const id = useDoc.getState().addStation(0, 0, 'Origin');
    useDoc.getState().renameStation(id, 'Renamed');
    undo();
    expect(useDoc.getState().stations[id].name).toBe('Origin');

    const group = beginHistoryGroup();
    useDoc.getState().setLabelOffset(id, 0); // no-op write
    group.commit();

    redo(); // Ctrl+Shift+Z
    expect(useDoc.getState().stations[id].name).toBe('Renamed');
  });
});
