import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, fireEvent } from '@testing-library/react';
import App from '../App';
import { dragState, useDoc } from '../state/store';
import { useSelection } from '../state/selection';
import { DEFAULT_DOC } from '../model/transforms';
import { makeLine, makePolygon, makeStation, makeTextLabel } from '../test/fixtures';

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

// While the line editor is open (appending-to-line mode), clicking off the
// line to exit must ONLY dismiss the editor — the item under the cursor must
// NOT get selected. Stations are exempt (a click there toggles line
// membership, the editor's own gesture) and are covered elsewhere.
describe('MapCanvas — clicking off-line to exit the line editor', () => {
  const enterAppendMode = () => {
    act(() => {
      useDoc.setState({
        ...useDoc.getState(),
        stations: { s1: makeStation({ id: 's1' }), s2: makeStation({ id: 's2', x: 100 }) },
        lines: { L1: makeLine({ id: 'L1', stations: ['s1', 's2'] }) },
        lineOrder: ['L1'],
        transfers: {
          t1: {
            id: 't1',
            a: { stationId: 's1', lineId: null },
            b: { stationId: 's2', lineId: null },
          },
        },
      });
      useSelection.getState().setUiMode({
        kind: 'appending-to-line',
        lineId: 'L1',
        insertAfterIndex: null,
      });
    });
  };

  it('clicking a label exits append mode without selecting the label', () => {
    render(<App />);
    seed();
    enterAppendMode();

    clickEl('[data-text-label-id="g1"]', {});

    expect(useSelection.getState().uiMode.kind).toBe('idle');
    expect(useSelection.getState().selectedLabelIds).toEqual([]);
  });

  it('clicking a polygon exits append mode without selecting the polygon', () => {
    render(<App />);
    seed();
    enterAppendMode();

    clickEl('[data-polygon-id="p1"]', {});

    expect(useSelection.getState().uiMode.kind).toBe('idle');
    expect(useSelection.getState().selectedPolygonIds).toEqual([]);
  });

  it('clicking a transfer exits append mode without selecting the transfer', () => {
    render(<App />);
    seed();
    enterAppendMode();

    clickEl('line[data-transfer-id="t1"]', {});

    expect(useSelection.getState().uiMode.kind).toBe('idle');
    expect(useSelection.getState().selectedTransferId).toBeNull();
  });
});
