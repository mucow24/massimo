import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MapVersionPill } from './MapVersionPill';
import { pickDocSnapshot, useDoc } from '../state/store';
import { clearHistory, undo } from '../state/history';
import { useLibraryPointer } from '../state/libraryPointer';
import { markAdopted, markSaved, useSaveBaseline } from '../state/saveBaseline';
import { serialize } from '../model/serialize';
import { DEFAULT_DOC } from '../model/transforms';

/** Anchor the baseline to the CURRENT doc, as every save/adopt site does. */
const anchor = (mark: typeof markSaved) => {
  const snap = pickDocSnapshot(useDoc.getState());
  mark(serialize(snap), snap);
};

const dot = () => document.querySelector('.map-save-dot');

beforeEach(() => {
  localStorage.clear();
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  clearHistory();
  useLibraryPointer.setState({ mapId: null, version: null });
  useSaveBaseline.setState({ baselineSnap: null, baselineJson: null, backed: false });
});

describe('MapVersionPill — version pill + save-status dot', () => {
  it('a clean doc shows the pill alone: version number, no dot', () => {
    useLibraryPointer.setState({ mapId: 'm1', version: 32 });
    anchor(markSaved);
    render(<MapVersionPill />);
    expect(screen.getByText('v32')).toBeInTheDocument();
    expect(dot()).toBeNull();
  });

  it('a dirty doc shows a red dot beside the pill, titled "Unsaved changes"', () => {
    useLibraryPointer.setState({ mapId: 'm1', version: 32 });
    anchor(markSaved);
    useDoc.getState().addStation(0, 0);
    render(<MapVersionPill />);
    expect(screen.getByText('v32')).toBeInTheDocument(); // still "came from v32"
    expect(dot()).toHaveAttribute('data-status', 'dirty');
    expect(screen.getByTitle('Unsaved changes')).toBeInTheDocument();
  });

  it('an unsaved doc (a loaded file) shows a blue dot and no pill', () => {
    anchor(markAdopted);
    render(<MapVersionPill />);
    expect(screen.queryByText(/^v\d+$/)).toBeNull(); // no version to claim
    expect(dot()).toHaveAttribute('data-status', 'unsaved');
    expect(screen.getByTitle('Not saved to the library yet')).toBeInTheDocument();
  });

  it('a dirty doc with no version still gets its dot — the dot outranks the pill', () => {
    // No baseline at all: errs dirty. A fresh-map-with-edits reads the same.
    render(<MapVersionPill />);
    expect(dot()).toHaveAttribute('data-status', 'dirty');
  });

  it('the dot tracks edits live, and undo takes it away again', () => {
    useLibraryPointer.setState({ mapId: 'm1', version: 32 });
    anchor(markSaved);
    render(<MapVersionPill />);
    expect(dot()).toBeNull();
    act(() => {
      useDoc.getState().addStation(0, 0);
    });
    expect(dot()).toHaveAttribute('data-status', 'dirty');
    act(() => {
      undo();
    });
    expect(dot()).toBeNull();
  });
});
