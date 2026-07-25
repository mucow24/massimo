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
    // Control: the sibling transform DOES guard (pinned at transforms.test.ts:150).
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

  it('a slider gesture that never leaves the ±2 detent consumes no undo', () => {
    // LabelOffsetControl.tsx:31 maps any |n| <= 2 to onChange(0), so dragging
    // inside the detent streams setLabelOffset(id, 0) against a stored 0.
    // useFieldHistory opens a group on focus and commits on blur.
    const id = useDoc.getState().addStation(0, 0, 'Origin');
    useDoc.getState().renameStation(id, 'Renamed'); // one real entry to undo
    const depthAfterRealEdit = historyDepth();

    const group = beginHistoryGroup(); // thumb focus
    for (const n of [1, 2, 1, 0, -1, -2]) {
      useDoc.getState().setLabelOffset(id, Math.abs(n) <= 2 ? 0 : n);
    }
    group.commit(); // thumb blur

    expect(historyDepth()).toBe(depthAfterRealEdit);
  });

  it('one Ctrl+Z after a detent-only slider gesture undoes the previous real edit', () => {
    const id = useDoc.getState().addStation(0, 0, 'Origin');
    useDoc.getState().renameStation(id, 'Renamed'); // the last REAL edit

    const group = beginHistoryGroup(); // thumb focus
    for (const n of [1, 2, -1]) {
      useDoc.getState().setLabelOffset(id, Math.abs(n) <= 2 ? 0 : n);
    }
    group.commit(); // thumb blur

    undo(); // the user's single Ctrl+Z
    expect(useDoc.getState().stations[id].name).toBe('Origin');
  });

  it('a value-identical write does not destroy the redo stack', () => {
    // pushHistory (history.ts:13) clears futureStates, so the dead entry also
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
