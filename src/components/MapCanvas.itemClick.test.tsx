import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, fireEvent } from '@testing-library/react';
import App from '../App';
import { dragState, useDoc } from '../state/store';
import { useSelection } from '../state/selection';
import { DEFAULT_DOC } from '../model/transforms';
import { makeLine, makePolygon, makeStation, makeStop, makeTextLabel } from '../test/fixtures';

// Modifier gating for the free-item click handlers (labels, bullets,
// polygons, svg images). The contract, shared with stations: Shift-click
// toggles membership, but ONLY without Ctrl/Cmd — Ctrl+Shift is reserved
// (stations use it for path-extend), so on every item type it must fall
// through to a plain replace-select rather than toggle.

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
  useSelection.setState({
    ...useSelection.getState(),
    selectedLabelIds: [],
    selectedPolygonIds: [],
    selectedVertices: null,
    uiMode: { kind: 'idle' },
  });
  dragState.suppressClick = false;
});

const seed = () => {
  act(() => {
    useDoc.setState({
      ...useDoc.getState(),
      textLabels: {
        g1: makeTextLabel({ id: 'g1', text: 'One', x: 0, y: 0 }),
        g2: makeTextLabel({ id: 'g2', text: 'Two', x: 100, y: 0 }),
      },
      polygons: {
        p1: makePolygon({ id: 'p1' }),
        p2: makePolygon({ id: 'p2' }),
      },
      polygonOrder: ['p1', 'p2'],
    });
  });
};

const clickEl = (
  selector: string,
  opts: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean },
) => {
  const el = document.querySelector(selector);
  expect(el, selector).not.toBeNull();
  fireEvent.click(el!, opts);
};

describe('MapCanvas — item click modifier gating', () => {
  it('Shift-click toggles a label into the multi-selection', () => {
    render(<App />);
    seed();
    act(() => useSelection.getState().setLabelSelection(['g1']));

    clickEl('[data-text-label-id="g2"]', { shiftKey: true });
    expect(useSelection.getState().selectedLabelIds.sort()).toEqual(['g1', 'g2']);
  });

  it('Ctrl+Shift-click on a label replace-selects (same rule as every other item type)', () => {
    render(<App />);
    seed();
    act(() => useSelection.getState().setLabelSelection(['g1']));

    clickEl('[data-text-label-id="g2"]', { shiftKey: true, ctrlKey: true });
    expect(useSelection.getState().selectedLabelIds).toEqual(['g2']);
  });

  it('Ctrl+Shift-click on a polygon replace-selects', () => {
    render(<App />);
    seed();
    act(() => useSelection.getState().setPolygonSelection(['p1']));

    clickEl('[data-polygon-id="p2"]', { shiftKey: true, metaKey: true });
    expect(useSelection.getState().selectedPolygonIds).toEqual(['p2']);
  });
});

describe('MapCanvas — polygon vertex click multi-select', () => {
  // Vertex handles only render for a SELECTED polygon (the overlay pass), so
  // select p1 first; the default square exposes handles at indices 0..3.
  const seedSelectedPolygon = () => {
    act(() => {
      useDoc.setState({
        ...useDoc.getState(),
        polygons: { p1: makePolygon({ id: 'p1' }) },
        polygonOrder: ['p1'],
      });
      useSelection.getState().selectPolygon('p1');
    });
  };

  it('plain-click selects one vertex; shift-click toggles more in and out', () => {
    render(<App />);
    seedSelectedPolygon();

    clickEl('[data-polygon-vertex="0"]', {});
    expect(useSelection.getState().selectedVertices).toEqual({ polygonId: 'p1', indices: [0] });

    clickEl('[data-polygon-vertex="2"]', { shiftKey: true });
    expect(useSelection.getState().selectedVertices).toEqual({ polygonId: 'p1', indices: [0, 2] });

    // Shift-click an already-selected vertex removes just it.
    clickEl('[data-polygon-vertex="0"]', { shiftKey: true });
    expect(useSelection.getState().selectedVertices).toEqual({ polygonId: 'p1', indices: [2] });

    // A plain click collapses back to a single vertex; the polygon stays selected.
    clickEl('[data-polygon-vertex="1"]', {});
    expect(useSelection.getState().selectedVertices).toEqual({ polygonId: 'p1', indices: [1] });
    expect(useSelection.getState().selectedPolygonIds).toEqual(['p1']);
  });
});

// The line editor is open when a line is selected (LineInspector + the dim /
// arrow highlight). Clicking off the line to exit must ONLY deselect the line —
// the item under the cursor must NOT get selected. Two exceptions the user
// asked to keep: clicking a station exits AND selects it (stations belong to
// the line), and clicking another line stripe switches the editor to that line.
describe('MapCanvas — clicking off-line while the line editor is open', () => {
  const openEditor = () => {
    act(() => {
      useDoc.setState({
        ...useDoc.getState(),
        stations: {
          s1: makeStation({ id: 's1', x: 0, y: 0, stops: [makeStop('L1')] }),
          s2: makeStation({ id: 's2', x: 100, y: 0, stops: [makeStop('L1')] }),
          s3: makeStation({ id: 's3', x: 0, y: 80, stops: [makeStop('L2')] }),
          s4: makeStation({ id: 's4', x: 100, y: 80, stops: [makeStop('L2')] }),
        },
        lines: {
          L1: makeLine({ id: 'L1', stations: ['s1', 's2'] }),
          L2: makeLine({ id: 'L2', stations: ['s3', 's4'] }),
        },
        lineOrder: ['L1', 'L2'],
        textLabels: { g1: makeTextLabel({ id: 'g1', text: 'One', x: 200, y: 0 }) },
        polygons: { p1: makePolygon({ id: 'p1' }) },
        polygonOrder: ['p1'],
        transfers: {
          t1: {
            id: 't1',
            a: { stationId: 's1', lineId: null },
            b: { stationId: 's2', lineId: null },
          },
        },
      });
      useSelection.getState().selectLine('L1');
    });
    expect(useSelection.getState().selectedLineId).toBe('L1');
  };

  it('clicking a label deselects the line and does not select the label', () => {
    render(<App />);
    openEditor();

    clickEl('[data-text-label-id="g1"]', {});

    expect(useSelection.getState().selectedLineId).toBeNull();
    expect(useSelection.getState().selectedLabelIds).toEqual([]);
  });

  it('clicking a polygon deselects the line and does not select the polygon', () => {
    render(<App />);
    openEditor();

    clickEl('[data-polygon-id="p1"]', {});

    expect(useSelection.getState().selectedLineId).toBeNull();
    expect(useSelection.getState().selectedPolygonIds).toEqual([]);
  });

  it('clicking a transfer deselects the line and does not select the transfer', () => {
    render(<App />);
    openEditor();

    clickEl('line[data-transfer-id="t1"]', {});

    expect(useSelection.getState().selectedLineId).toBeNull();
    expect(useSelection.getState().selectedTransferId).toBeNull();
  });

  it('clicking a station exits the editor AND selects the station (stations belong to the line)', () => {
    render(<App />);
    openEditor();

    clickEl('[data-station-id="s1"] rect', {});

    expect(useSelection.getState().selectedLineId).toBeNull();
    expect(useSelection.getState().selectedStationIds).toEqual(['s1']);
  });

  it('clicking another line stripe switches the editor to that line', () => {
    render(<App />);
    openEditor();

    clickEl('[data-band-stripe][data-line-id="L2"]', {});

    expect(useSelection.getState().selectedLineId).toBe('L2');
  });

  it('with no line selected, clicking a label selects it as normal', () => {
    render(<App />);
    openEditor();
    act(() => useSelection.getState().selectLine(null));

    clickEl('[data-text-label-id="g1"]', {});

    expect(useSelection.getState().selectedLabelIds).toEqual(['g1']);
  });
});
