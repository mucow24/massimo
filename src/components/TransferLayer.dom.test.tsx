import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import App from '../App';
import { useDoc } from '../state/store';
import { useSelection } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import type { Line, Station, Transfer } from '../model/types';

beforeEach(() => {
  localStorage.clear();
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
  useSelection.setState({
    ...useSelection.getState(),
    selectedTransferId: null,
    selectedStationIds: [],
  });
  // jsdom doesn't implement scrollIntoView; Sidebar calls it when a station
  // becomes the active row. Stub it for these tests.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

function seedTwoStationsWithTransfer() {
  const s1: Station = {
    id: 's1',
    name: 'S1',
    x: 0,
    y: 0,
    rotation: 0,
    stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }],
    label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
  };
  const s2: Station = {
    id: 's2',
    name: 'S2',
    x: 200,
    y: 0,
    rotation: 0,
    stops: [{ lineId: 'L2', row: 0, col: 0, orientation: 'auto-vertical' }],
    label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
  };
  const l1: Line = {
    id: 'L1',
    service: 'L1',
    name: 'L1 line',
    color: '#0039A6',
    stations: ['s1'],
  };
  const l2: Line = {
    id: 'L2',
    service: 'L2',
    name: 'L2 line',
    color: '#EE352E',
    stations: ['s2'],
  };
  const transfer: Transfer = {
    id: 'x1',
    a: { stationId: 's1', lineId: 'L1' },
    b: { stationId: 's2', lineId: 'L2' },
  };
  act(() => {
    useDoc.setState({
      ...useDoc.getState(),
      stations: { s1, s2 },
      lines: { L1: l1, L2: l2 },
      lineOrder: ['L1', 'L2'],
      transfers: { x1: transfer },
    });
  });
}

// Each transfer renders 1-3 stacked <line>s inside `[data-transfer-id]`.
// The body is the narrowest (innermost); the user stroke (when > 0) is in
// the middle; the selection ring (when selected) is the widest. Tests pick
// by relative width to stay robust against color collisions.
function transferLines(id: string): Element[] {
  return Array.from(document.querySelectorAll(`[data-transfer-id="${id}"] line`));
}

function transferBody(id: string): Element {
  const lines = transferLines(id);
  if (lines.length === 0) throw new Error(`No <line>s found for transfer ${id}`);
  return lines.reduce((narrowest, el) =>
    Number(el.getAttribute('stroke-width')) < Number(narrowest.getAttribute('stroke-width'))
      ? el
      : narrowest,
  );
}

describe('TransferLayer — DOM rendering', () => {
  it('visible body <line> reflects transferColor and transferThickness from the store', () => {
    seedTwoStationsWithTransfer();
    render(<App />);

    let body = transferBody('x1');
    expect(body.getAttribute('stroke')).toBe('#000000');
    expect(body.getAttribute('stroke-width')).toBe('2');

    act(() => {
      useDoc.setState({
        ...useDoc.getState(),
        transferColor: '#ff8800',
        transferThickness: 6,
      });
    });

    body = transferBody('x1');
    expect(body.getAttribute('stroke')).toBe('#ff8800');
    expect(body.getAttribute('stroke-width')).toBe('6');
  });

  it('renders the transfer BEFORE the connected stop dots in document order', () => {
    seedTwoStationsWithTransfer();
    render(<App />);

    const body = transferBody('x1');
    const dotS1 = document.querySelector('[data-stop-station="s1"]');
    const dotS2 = document.querySelector('[data-stop-station="s2"]');
    expect(dotS1).not.toBeNull();
    expect(dotS2).not.toBeNull();

    const PRECEDING = Node.DOCUMENT_POSITION_PRECEDING;
    expect(dotS1!.compareDocumentPosition(body) & PRECEDING).toBeTruthy();
    expect(dotS2!.compareDocumentPosition(body) & PRECEDING).toBeTruthy();
  });

  it('does not render the legacy teal selected-transfer halo', () => {
    seedTwoStationsWithTransfer();
    render(<App />);
    act(() => {
      useSelection.getState().selectTransfer('x1');
    });
    expect(document.querySelectorAll('svg line[stroke="#1488a0"]').length).toBe(0);
  });

  it('uses per-pixel hit-testing: the body stroke is the click target (no transparent overlay)', () => {
    seedTwoStationsWithTransfer();
    render(<App />);

    const body = transferBody('x1');
    expect(body.getAttribute('pointer-events')).toBe('stroke');
    expect(document.querySelectorAll('svg line[stroke="transparent"]').length).toBe(0);
  });

  it('clicking the body selects the transfer', () => {
    seedTwoStationsWithTransfer();
    render(<App />);

    expect(useSelection.getState().selectedTransferId).toBeNull();
    fireEvent.click(transferBody('x1'));
    expect(useSelection.getState().selectedTransferId).toBe('x1');
  });

  it('clicking a station dot routes to station selection (not the transfer)', () => {
    seedTwoStationsWithTransfer();
    render(<App />);

    expect(useSelection.getState().selectedTransferId).toBeNull();
    const dotS1 = document.querySelector('[data-stop-station="s1"][data-stop-line="L1"]');
    expect(dotS1).not.toBeNull();
    fireEvent.click(dotS1!);
    expect(useSelection.getState().selectedStationIds).toEqual(['s1']);
    expect(useSelection.getState().selectedTransferId).toBeNull();
  });

  describe('user stroke', () => {
    it('does not render a stroke line when transferStrokeWidth = 0 (default)', () => {
      seedTwoStationsWithTransfer();
      render(<App />);
      // Unselected with no stroke → exactly one line (the body).
      expect(transferLines('x1').length).toBe(1);
    });

    it('renders a stroke line wider than the body when transferStrokeWidth > 0', () => {
      seedTwoStationsWithTransfer();
      act(() => {
        useDoc.setState({
          ...useDoc.getState(),
          transferStrokeWidth: 3,
          transferStrokeColor: '#abcdef',
        });
      });
      render(<App />);
      const lines = transferLines('x1');
      // Unselected → 2 lines: stroke (outer) then body (inner).
      expect(lines.length).toBe(2);
      const body = transferBody('x1');
      const stroke = lines.find((el) => el !== body)!;
      expect(stroke.getAttribute('stroke')).toBe('#abcdef');
      // visibleExtent = thickness + 2 * strokeWidth = 2 + 6 = 8.
      expect(Number(stroke.getAttribute('stroke-width'))).toBe(8);
      // Stroke must precede body in document order (body paints on top).
      const PRECEDING = Node.DOCUMENT_POSITION_PRECEDING;
      expect(body.compareDocumentPosition(stroke) & PRECEDING).toBeTruthy();
    });
  });

  describe('selection outline', () => {
    it('picks white when the body color is dark (no user stroke)', () => {
      seedTwoStationsWithTransfer();
      // Default body color is black.
      render(<App />);
      act(() => {
        useSelection.getState().selectTransfer('x1');
      });
      const lines = transferLines('x1');
      // 2 lines: selection ring (outer) + body. No user stroke.
      expect(lines.length).toBe(2);
      const body = transferBody('x1');
      const ring = lines.find((el) => el !== body)!;
      expect(ring.getAttribute('stroke')).toBe('#fff');
      // visibleExtent = 2 (thickness) + 2 * 0 (stroke) = 2. Ring = 2 + 2*1 = 4.
      expect(Number(ring.getAttribute('stroke-width'))).toBe(4);
    });

    it('picks black when the body color is light (no user stroke)', () => {
      seedTwoStationsWithTransfer();
      act(() => {
        useDoc.setState({ ...useDoc.getState(), transferColor: '#ffffff' });
      });
      render(<App />);
      act(() => {
        useSelection.getState().selectTransfer('x1');
      });
      const lines = transferLines('x1');
      const body = transferBody('x1');
      const ring = lines.find((el) => el !== body)!;
      expect(ring.getAttribute('stroke')).toBe('#000');
    });

    it('legibility is based on the user stroke color when stroke > 0, not the body', () => {
      seedTwoStationsWithTransfer();
      act(() => {
        useDoc.setState({
          ...useDoc.getState(),
          // Body is dark; user stroke is light. Ring should contrast with
          // the stroke (legible against light → black).
          transferColor: '#000000',
          transferStrokeColor: '#ffffff',
          transferStrokeWidth: 3,
        });
      });
      render(<App />);
      act(() => {
        useSelection.getState().selectTransfer('x1');
      });
      const lines = transferLines('x1');
      // 3 lines: selection ring + user stroke + body.
      expect(lines.length).toBe(3);
      // Ring is the widest.
      const ring = lines.reduce((widest, el) =>
        Number(el.getAttribute('stroke-width')) > Number(widest.getAttribute('stroke-width'))
          ? el
          : widest,
      );
      expect(ring.getAttribute('stroke')).toBe('#000');
      // Width = visibleExtent (8) + 2 * pad (2) = 10.
      expect(Number(ring.getAttribute('stroke-width'))).toBe(10);
    });
  });
});
