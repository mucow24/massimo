import { describe, it, expect, beforeEach } from 'vitest';
import { beginHistoryGroup, pickDocSnapshot, useDoc } from './store';
import { clearHistory, redo, undo } from './history';
import { serialize } from '../model/serialize';
import { DEFAULT_DOC } from '../model/transforms';
import {
  bootBaselineState,
  markAdopted,
  markSaved,
  markUnbacked,
  saveStatusOf,
  useSaveBaseline,
} from './saveBaseline';

const statusNow = () => saveStatusOf(useDoc.getState(), useSaveBaseline.getState());

/** Anchor the baseline to the CURRENT doc, the way every save/adopt site does:
 *  json and snap captured together from one state. */
const anchor = (mark: typeof markSaved) => {
  const snap = pickDocSnapshot(useDoc.getState());
  mark(serialize(snap), snap);
};

beforeEach(() => {
  localStorage.clear();
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  clearHistory();
  useSaveBaseline.setState({ baselineSnap: null, baselineJson: null, backed: false });
});

describe('saveStatusOf — the tri-state signal', () => {
  it('reads dirty when no baseline exists (errs toward "save me")', () => {
    expect(statusNow()).toBe('dirty');
  });

  it('reads clean after a save, dirty after an edit', () => {
    anchor(markSaved);
    expect(statusNow()).toBe('clean');
    useDoc.getState().addStation(0, 0);
    expect(statusNow()).toBe('dirty');
  });

  it('three edits and three undos return to clean', () => {
    anchor(markSaved);
    const id = useDoc.getState().addStation(0, 0);
    useDoc.getState().renameStation(id, 'Renamed');
    useDoc.getState().addStation(100, 0);
    expect(statusNow()).toBe('dirty');
    undo();
    undo();
    expect(statusNow()).toBe('dirty');
    undo();
    expect(statusNow()).toBe('clean');
  });

  it('redo past the save point flips back to dirty', () => {
    anchor(markSaved);
    useDoc.getState().addStation(0, 0);
    undo();
    expect(statusNow()).toBe('clean');
    redo();
    expect(statusNow()).toBe('dirty');
  });

  it('a grouped gesture (drag) undone in one step returns to clean', () => {
    const id = useDoc.getState().addStation(0, 0);
    anchor(markSaved);
    const group = beginHistoryGroup();
    useDoc.getState().moveStation(id, 40, 0);
    useDoc.getState().moveStation(id, 80, 0);
    useDoc.getState().moveStation(id, 120, 0);
    group.commit();
    expect(statusNow()).toBe('dirty');
    undo();
    expect(statusNow()).toBe('clean');
  });

  it('a primitive-field round-trip reads clean without any undo', () => {
    // darkMode is a primitive DOC_FIELD, so the reference comparison is a
    // value comparison: toggling it on and off lands on the exact baseline.
    anchor(markSaved);
    useDoc.getState().setDarkMode(true);
    expect(statusNow()).toBe('dirty');
    useDoc.getState().setDarkMode(false);
    expect(statusNow()).toBe('clean');
  });

  it('an adopted doc reads unsaved: clean, but the library has no copy', () => {
    anchor(markAdopted);
    expect(statusNow()).toBe('unsaved');
  });

  it('edits on an adopted doc read dirty; undoing them returns to unsaved, not clean', () => {
    anchor(markAdopted);
    useDoc.getState().addStation(0, 0);
    expect(statusNow()).toBe('dirty');
    undo();
    expect(statusNow()).toBe('unsaved');
  });

  it('saving an adopted doc flips unsaved to clean', () => {
    anchor(markAdopted);
    expect(statusNow()).toBe('unsaved');
    anchor(markSaved);
    expect(statusNow()).toBe('clean');
  });

  it('markUnbacked reads dirty — the bytes exist nowhere but the canvas', () => {
    anchor(markSaved);
    expect(statusNow()).toBe('clean');
    markUnbacked();
    expect(statusNow()).toBe('dirty');
  });
});

describe('bootBaselineState — the baseline across a refresh', () => {
  it('restores clean when the persisted hash matches the rehydrated doc', () => {
    useDoc.getState().addStation(0, 0);
    anchor(markSaved); // persists the hash, as a real save does
    const booted = bootBaselineState();
    expect(saveStatusOf(useDoc.getState(), booted)).toBe('clean');
  });

  it('preserves the unbacked bit: a loaded file is still unsaved after a refresh', () => {
    useDoc.getState().addStation(0, 0);
    anchor(markAdopted);
    const booted = bootBaselineState();
    expect(saveStatusOf(useDoc.getState(), booted)).toBe('unsaved');
  });

  it('reads dirty when the doc changed after the hash was recorded', () => {
    useDoc.getState().addStation(0, 0);
    anchor(markSaved);
    useDoc.getState().addStation(100, 0); // an edit the "refresh" never saved
    const booted = bootBaselineState();
    expect(saveStatusOf(useDoc.getState(), booted)).toBe('dirty');
  });

  it('with no recorded baseline, an empty doc adopts itself as unsaved', () => {
    // First-ever boot: the doc is the factory-empty one and nothing has been
    // recorded. Blue ("not in the library yet"), not red — same face a virgin
    // New shows.
    const booted = bootBaselineState();
    expect(saveStatusOf(useDoc.getState(), booted)).toBe('unsaved');
  });

  it('with no recorded baseline, a non-empty doc errs dirty', () => {
    useDoc.getState().addStation(0, 0);
    const booted = bootBaselineState();
    expect(saveStatusOf(useDoc.getState(), booted)).toBe('dirty');
  });

  it('a mismatched hash does NOT fall through to the empty-doc adoption', () => {
    // Save a real map, then "clear + refresh": the doc is empty but the
    // recorded baseline says otherwise. That difference is unsaved work
    // (the clear), so it must read dirty, not blue.
    useDoc.getState().addStation(0, 0);
    anchor(markSaved);
    useDoc.getState().clearAll();
    const booted = bootBaselineState();
    expect(saveStatusOf(useDoc.getState(), booted)).toBe('dirty');
  });
});
