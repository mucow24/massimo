import { describe, it, expect, beforeEach } from 'vitest';
import { useDoc } from './store';
import { undo } from './history';
import { DEFAULT_DOC } from '../model/transforms';

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
});

describe('setDocName', () => {
  it('updates the document name', () => {
    useDoc.getState().setDocName('Regional Rail');
    expect(useDoc.getState().name).toBe('Regional Rail');
  });

  it('is undoable as a single history entry', () => {
    // The rename is one store write (the field commits on blur, not per
    // keystroke), so a single Ctrl+Z must restore the prior name.
    expect(useDoc.getState().name).toBe('Untitled map');
    useDoc.getState().setDocName('Regional Rail');
    expect(useDoc.getState().name).toBe('Regional Rail');
    undo();
    expect(useDoc.getState().name).toBe('Untitled map');
  });

  it('setting the same name records no history entry', () => {
    // The transform returns the doc unchanged when the name is identical, and
    // the store's `equality: docSnapshotsEqual` guard drops the redundant
    // write — so undo has nothing to revert.
    useDoc.getState().setDocName('Untitled map');
    expect(useDoc.temporal.getState().pastStates.length).toBe(0);
  });
});
