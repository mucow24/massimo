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
const pill = () => document.querySelector('.map-version-pill');

beforeEach(() => {
  localStorage.clear();
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  clearHistory();
  useLibraryPointer.setState({ mapId: 'tab-map', version: null });
  useSaveBaseline.setState({ baselineSnap: null, baselineJson: null, backed: false });
});

describe('MapVersionPill — version pill + save-status dot', () => {
  it('a clean doc shows the pill and keeps the dot as a hidden placeholder', () => {
    useLibraryPointer.setState({ mapId: 'm1', version: 32 });
    anchor(markSaved);
    render(<MapVersionPill />);
    expect(screen.getByText('v32')).toBeInTheDocument();
    // Shown, not a placeholder: no data-empty, and the title claims the version.
    expect(pill()).not.toHaveAttribute('data-empty');
    expect(pill()).toHaveAttribute('title', 'This map came from version 32');
    // The box stays (CSS hides the paint): unmounting it changes the
    // toolbar's width, which re-clamps scrollX in a narrow window — the
    // whole page visibly jumped ~18px on every save.
    expect(dot()).toHaveAttribute('data-status', 'clean');
    expect(dot()).not.toHaveAttribute('title');
  });

  it('a dirty doc shows a red dot beside the pill, titled with the unsaved-changes hint', () => {
    useLibraryPointer.setState({ mapId: 'm1', version: 32 });
    anchor(markSaved);
    useDoc.getState().addStation(0, 0);
    render(<MapVersionPill />);
    expect(screen.getByText('v32')).toBeInTheDocument(); // still "came from v32"
    expect(dot()).toHaveAttribute('data-status', 'dirty');
    expect(screen.getByTitle('Unsaved changes — Ctrl+S saves a version')).toBeInTheDocument();
  });

  it('an unsaved doc (a loaded file) shows a blue dot and the pill claims no version', () => {
    anchor(markAdopted);
    render(<MapVersionPill />);
    expect(screen.queryByText(/^v\d+$/)).toBeNull(); // no version to claim
    // The pill is still mounted, but as an empty hidden placeholder — see the
    // reserves-its-box test below for why it must not unmount.
    expect(pill()).toBeEmptyDOMElement();
    expect(pill()).toHaveAttribute('data-empty', '');
    expect(pill()).not.toHaveAttribute('title');
    expect(dot()).toHaveAttribute('data-status', 'unsaved');
    expect(screen.getByTitle('Not in the library yet — Ctrl+S saves it')).toBeInTheDocument();
  });

  it('with no version, the pill stays mounted as an empty hidden placeholder (reserves its box)', () => {
    // version stays null (beforeEach). The pill must NOT unmount: unmounting it
    // (and its flex gap) shrinks the toolbar's min-content width, which
    // re-clamps scrollX in a narrow window — the toolbar jumped ~28px on a
    // fresh map's first save. It reserves its box but claims nothing: empty
    // content, no title, hidden by CSS off data-empty.
    render(<MapVersionPill />);
    expect(pill()).toBeInTheDocument();
    expect(pill()).toBeEmptyDOMElement();
    expect(pill()).toHaveAttribute('data-empty', '');
    expect(pill()).not.toHaveAttribute('title');
  });

  it('a dirty doc with no version still gets its dot — the dot outranks the pill', () => {
    // No baseline at all: errs dirty. A fresh-map-with-edits reads the same.
    render(<MapVersionPill />);
    expect(dot()).toHaveAttribute('data-status', 'dirty');
  });

  it('the dot tracks edits live, and undo hides it again', () => {
    useLibraryPointer.setState({ mapId: 'm1', version: 32 });
    anchor(markSaved);
    render(<MapVersionPill />);
    expect(dot()).toHaveAttribute('data-status', 'clean');
    act(() => {
      useDoc.getState().addStation(0, 0);
    });
    expect(dot()).toHaveAttribute('data-status', 'dirty');
    act(() => {
      undo();
    });
    expect(dot()).toHaveAttribute('data-status', 'clean');
  });
});
