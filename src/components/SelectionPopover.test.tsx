import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SelectionPopover } from './SelectionPopover';
import { useDoc, useSelection } from '../state/store';
import { historyDepth } from '../state/history';
import { DEFAULT_DOC } from '../model/transforms';
import {
  makeDoc,
  makeGuide,
  makeLineCircle,
  makePolygon,
  makeRouteBullet,
  makeStation,
  makeSvgImage,
  makeTextLabel,
} from '../test/fixtures';
import type { SelectionItemIds } from '../state/selectionOps';

// One id of EVERY lockable kind — the seven `setItemsLocked` covers. The panel
// counts and gates per kind, so a selection short one kind cannot tell a
// counted kind from a forgotten one.
const ALL_IDS: SelectionItemIds = {
  stations: ['s1'],
  bullets: ['b1'],
  labels: ['t1'],
  polygons: ['p1'],
  svgImages: ['i1'],
  anchors: [],
  lineCircles: ['c1'],
  guides: ['gd1'],
};

// Seed the doc with one item of every lockable kind (locked per the flags) AND
// select them all — Delete all acts on the LIVE selection (selectionOps), so
// the ids prop and the selection store must agree, as they do in the real app.
function seed(locked: {
  station?: boolean;
  bullet?: boolean;
  label?: boolean;
  polygon?: boolean;
  svgImage?: boolean;
  lineCircle?: boolean;
  guide?: boolean;
}) {
  const doc = makeDoc({
    stations: [makeStation({ id: 's1', ...(locked.station ? { locked: true } : {}) })],
    routeBullets: [makeRouteBullet({ id: 'b1', ...(locked.bullet ? { locked: true } : {}) })],
    textLabels: [makeTextLabel({ id: 't1', ...(locked.label ? { locked: true } : {}) })],
    polygons: [makePolygon({ id: 'p1', ...(locked.polygon ? { locked: true } : {}) })],
    svgImages: [makeSvgImage({ id: 'i1', ...(locked.svgImage ? { locked: true } : {}) })],
    lineCircles: [makeLineCircle({ id: 'c1', ...(locked.lineCircle ? { locked: true } : {}) })],
    guides: [makeGuide({ id: 'gd1', ...(locked.guide ? { locked: true } : {}) })],
  });
  useDoc.setState({ ...useDoc.getState(), ...doc });
  useSelection.setState({
    selectedStationIds: ['s1'],
    selectedRouteBulletIds: ['b1'],
    selectedLabelIds: ['t1'],
    selectedPolygonIds: ['p1'],
    selectedSvgImageIds: ['i1'],
    selectedLineCircleIds: ['c1'],
    selectedGuideIds: ['gd1'],
    uiMode: { kind: 'idle' },
  });
}

function renderPopover(ids: SelectionItemIds = ALL_IDS) {
  return render(<SelectionPopover ids={ids} hostW={800} />);
}

describe('<SelectionPopover />', () => {
  beforeEach(() => {
    localStorage.clear();
    useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
    useDoc.temporal.getState().clear();
  });

  it('shows the member count and how many are locked', () => {
    seed({ bullet: true, polygon: true, guide: true });
    renderPopover();
    expect(screen.getByText('7 items · 3 locked')).toBeInTheDocument();
  });

  it('Lock all locks every kind in ONE undo entry', () => {
    seed({});
    renderPopover();
    const before = historyDepth();
    fireEvent.click(screen.getByRole('button', { name: 'Lock all' }));
    const doc = useDoc.getState();
    expect(doc.stations['s1'].locked).toBe(true);
    expect(doc.routeBullets['b1'].locked).toBe(true);
    expect(doc.textLabels['t1'].locked).toBe(true);
    expect(doc.polygons['p1'].locked).toBe(true);
    expect(doc.svgImages['i1'].locked).toBe(true);
    expect(doc.lineCircles['c1'].locked).toBe(true);
    expect(doc.guides['gd1'].locked).toBe(true);
    expect(historyDepth() - before).toBe(1);
  });

  it('Unlock all resolves a MIXED selection in one click', () => {
    seed({ station: true, label: true, svgImage: true, lineCircle: true, guide: true });
    renderPopover();
    fireEvent.click(screen.getByRole('button', { name: 'Unlock all' }));
    const doc = useDoc.getState();
    expect(doc.stations['s1'].locked).toBeUndefined();
    expect(doc.textLabels['t1'].locked).toBeUndefined();
    expect(doc.svgImages['i1'].locked).toBeUndefined();
    expect(doc.lineCircles['c1'].locked).toBeUndefined();
    expect(doc.guides['gd1'].locked).toBeUndefined();
  });

  it('each lock button disables at its no-op end of the range', () => {
    seed({
      station: true,
      bullet: true,
      label: true,
      polygon: true,
      svgImage: true,
      lineCircle: true,
      guide: true,
    });
    const { unmount } = renderPopover();
    expect(screen.getByRole('button', { name: 'Lock all' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Unlock all' })).toBeEnabled();
    unmount();

    seed({});
    renderPopover();
    expect(screen.getByRole('button', { name: 'Lock all' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Unlock all' })).toBeDisabled();
  });

  it('Delete all removes only the unlocked members and clears the selection', () => {
    seed({ station: true, polygon: true, lineCircle: true });
    renderPopover();
    const before = historyDepth();
    fireEvent.click(screen.getByRole('button', { name: 'Delete all' }));
    const doc = useDoc.getState();
    // Locked members survive; unlocked ones are gone — one history entry.
    expect(doc.stations['s1']).toBeDefined();
    expect(doc.polygons['p1']).toBeDefined();
    expect(doc.lineCircles['c1']).toBeDefined();
    expect(doc.routeBullets['b1']).toBeUndefined();
    expect(doc.textLabels['t1']).toBeUndefined();
    expect(doc.svgImages['i1']).toBeUndefined();
    expect(doc.guides['gd1']).toBeUndefined();
    expect(historyDepth() - before).toBe(1);
    const sel = useSelection.getState();
    expect(sel.selectedStationIds).toEqual([]);
    expect(sel.selectedRouteBulletIds).toEqual([]);
    expect(sel.selectedLabelIds).toEqual([]);
    expect(sel.selectedPolygonIds).toEqual([]);
    expect(sel.selectedSvgImageIds).toEqual([]);
    expect(sel.selectedLineCircleIds).toEqual([]);
    expect(sel.selectedGuideIds).toEqual([]);
  });

  it('Delete all is disabled when every member is locked', () => {
    seed({
      station: true,
      bullet: true,
      label: true,
      polygon: true,
      svgImage: true,
      lineCircle: true,
      guide: true,
    });
    renderPopover();
    expect(screen.getByRole('button', { name: 'Delete all' })).toBeDisabled();
  });
});
