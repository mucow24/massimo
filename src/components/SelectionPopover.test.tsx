import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SelectionPopover } from './SelectionPopover';
import { useDoc, useSelection } from '../state/store';
import { historyDepth } from '../state/history';
import { DEFAULT_DOC } from '../model/transforms';
import {
  makeDoc,
  makePolygon,
  makeRouteBullet,
  makeStation,
  makeSvgImage,
  makeTextLabel,
} from '../test/fixtures';
import type { SelectionItemIds } from '../state/selectionOps';

const identityView = { vbX: 0, vbY: 0, vbW: 800, vbH: 600, size: { w: 800, h: 600 } };
const rect = { x0: 0, y0: 0, x1: 40, y1: 40 };

const ALL_IDS: SelectionItemIds = {
  stations: ['s1'],
  bullets: ['b1'],
  labels: ['t1'],
  polygons: ['p1'],
  svgImages: ['i1'],
  anchors: [],
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
}) {
  const doc = makeDoc({
    stations: [makeStation({ id: 's1', ...(locked.station ? { locked: true } : {}) })],
    routeBullets: [makeRouteBullet({ id: 'b1', ...(locked.bullet ? { locked: true } : {}) })],
    textLabels: [makeTextLabel({ id: 't1', ...(locked.label ? { locked: true } : {}) })],
    polygons: [makePolygon({ id: 'p1', ...(locked.polygon ? { locked: true } : {}) })],
    svgImages: [makeSvgImage({ id: 'i1', ...(locked.svgImage ? { locked: true } : {}) })],
  });
  useDoc.setState({ ...useDoc.getState(), ...doc });
  useSelection.setState({
    selectedStationIds: ['s1'],
    selectedRouteBulletIds: ['b1'],
    selectedLabelIds: ['t1'],
    selectedPolygonIds: ['p1'],
    selectedSvgImageIds: ['i1'],
    uiMode: { kind: 'idle' },
  });
}

function renderPopover(ids: SelectionItemIds = ALL_IDS) {
  return render(<SelectionPopover ids={ids} worldRect={rect} view={identityView} />);
}

describe('<SelectionPopover />', () => {
  beforeEach(() => {
    localStorage.clear();
    useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
    useDoc.temporal.getState().clear();
  });

  it('shows the member count and how many are locked', () => {
    seed({ bullet: true, polygon: true });
    renderPopover();
    expect(screen.getByText('5 items · 2 locked')).toBeInTheDocument();
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
    expect(historyDepth() - before).toBe(1);
  });

  it('Unlock all resolves a MIXED selection in one click', () => {
    seed({ station: true, label: true, svgImage: true });
    renderPopover();
    fireEvent.click(screen.getByRole('button', { name: 'Unlock all' }));
    const doc = useDoc.getState();
    expect(doc.stations['s1'].locked).toBeUndefined();
    expect(doc.textLabels['t1'].locked).toBeUndefined();
    expect(doc.svgImages['i1'].locked).toBeUndefined();
  });

  it('each lock button disables at its no-op end of the range', () => {
    seed({ station: true, bullet: true, label: true, polygon: true, svgImage: true });
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
    seed({ station: true, polygon: true });
    renderPopover();
    const before = historyDepth();
    fireEvent.click(screen.getByRole('button', { name: 'Delete all' }));
    const doc = useDoc.getState();
    // Locked members survive; unlocked ones are gone — one history entry.
    expect(doc.stations['s1']).toBeDefined();
    expect(doc.polygons['p1']).toBeDefined();
    expect(doc.routeBullets['b1']).toBeUndefined();
    expect(doc.textLabels['t1']).toBeUndefined();
    expect(doc.svgImages['i1']).toBeUndefined();
    expect(historyDepth() - before).toBe(1);
    const sel = useSelection.getState();
    expect(sel.selectedStationIds).toEqual([]);
    expect(sel.selectedRouteBulletIds).toEqual([]);
    expect(sel.selectedLabelIds).toEqual([]);
    expect(sel.selectedPolygonIds).toEqual([]);
    expect(sel.selectedSvgImageIds).toEqual([]);
  });

  it('Delete all is disabled when every member is locked', () => {
    seed({ station: true, bullet: true, label: true, polygon: true, svgImage: true });
    renderPopover();
    expect(screen.getByRole('button', { name: 'Delete all' })).toBeDisabled();
  });
});
