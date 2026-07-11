import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import App from '../App';
import { useDoc } from '../state/store';
import { useSelection } from '../state/store';
import { useViewportStore } from '../state/viewportStore';
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

// Each transfer renders 1-3 <line>s tagged `data-transfer-id`, spread across
// three flat passes (selection rings, then halos, then bodies). The body is
// the narrowest; the user stroke (when > 0) is in the middle; the selection
// ring (when selected) is the widest. Tests pick by relative width to stay
// robust against color collisions.
function transferLines(id: string): Element[] {
  return Array.from(document.querySelectorAll(`line[data-transfer-id="${id}"]`));
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

    it('paints in flat passes: every halo precedes every body across all transfers', () => {
      seedTwoStationsWithTransfer();
      act(() => {
        useDoc.setState({
          ...useDoc.getState(),
          transferStrokeWidth: 3,
          transfers: {
            ...useDoc.getState().transfers,
            x2: {
              id: 'x2',
              a: { stationId: 's1', lineId: 'L1' },
              b: { stationId: 's2', lineId: 'L2' },
            },
          },
        });
      });
      render(<App />);

      const all = Array.from(document.querySelectorAll('line[data-transfer-id]'));
      // visibleExtent = 2 + 2*3 = 8 (halo); body = 2.
      const halos = all.filter((el) => el.getAttribute('stroke-width') === '8');
      const bodies = all.filter((el) => el.getAttribute('stroke-width') === '2');
      expect(halos.length).toBe(2);
      expect(bodies.length).toBe(2);

      // Were halos and bodies grouped per transfer, x2's halo would follow
      // x1's body. Flat passes guarantee every halo precedes every body.
      const PRECEDING = Node.DOCUMENT_POSITION_PRECEDING;
      for (const halo of halos) {
        for (const body of bodies) {
          expect(body.compareDocumentPosition(halo) & PRECEDING).toBeTruthy();
        }
      }

      // Each pass iterates transfers in the same (document) order.
      const haloIds = halos.map((el) => el.getAttribute('data-transfer-id'));
      const bodyIds = bodies.map((el) => el.getAttribute('data-transfer-id'));
      expect(haloIds).toEqual(bodyIds);
    });
  });

  // The selected-transfer outline speaks the same language as every other
  // item: a dashed themeColors.selectionStroke ring. The old legibleTextOn
  // halo contrasted the TRANSFER's own color — a black transfer got a white
  // halo that vanished on the light canvas, so selected and unselected looked
  // identical. The dashes keep the ring legible even where the body color
  // matches the stroke.
  describe('selection outline', () => {
    const widestLine = (id: string) =>
      transferLines(id).reduce((widest, el) =>
        Number(el.getAttribute('stroke-width')) > Number(widest.getAttribute('stroke-width'))
          ? el
          : widest,
      );

    it('uses the dashed theme selection stroke regardless of body color', () => {
      seedTwoStationsWithTransfer();
      // Default body color is black — under the old legibleTextOn rule this
      // ring would have been white (invisible on the light canvas).
      render(<App />);
      act(() => {
        useSelection.getState().selectTransfer('x1');
      });
      const lines = transferLines('x1');
      // 2 lines: selection ring (outer) + body. No user stroke.
      expect(lines.length).toBe(2);
      const ring = widestLine('x1');
      expect(ring.getAttribute('stroke')).toBe('#000000');
      expect(ring.getAttribute('stroke-dasharray')).toBe('6 4');
      // Butt caps, NOT the round caps spread in from lineEnds: SVG caps every
      // dash end, and round caps on a stroke this wide overlap the 4-unit
      // gaps — the dashes would render as a solid band.
      expect(ring.getAttribute('stroke-linecap')).toBe('butt');
      // visibleExtent = 2 (thickness) + 2 * 0 (stroke) = 2. Ring = 2 + 2*2.5 = 7.
      expect(Number(ring.getAttribute('stroke-width'))).toBe(7);
    });

    it('flips white in dark mode (contrast against the canvas, not the body)', () => {
      seedTwoStationsWithTransfer();
      act(() => {
        useViewportStore.setState({ darkMode: true });
      });
      try {
        render(<App />);
        act(() => {
          useSelection.getState().selectTransfer('x1');
        });
        expect(widestLine('x1').getAttribute('stroke')).toBe('#ffffff');
      } finally {
        act(() => {
          useViewportStore.setState({ darkMode: false });
        });
      }
    });

    it('is editor chrome: tagged data-export-exclude so it never bakes into exports', () => {
      // Same contract as the route-bullet ring — exports clone the live SVG
      // and strip [data-export-exclude], so an untagged ring would serialize
      // into SVG/PNG/PDF over the transfer.
      seedTwoStationsWithTransfer();
      render(<App />);
      act(() => {
        useSelection.getState().selectTransfer('x1');
      });
      expect(widestLine('x1').getAttribute('data-export-exclude')).toBe('1');
    });

    it('pads around the user stroke when present', () => {
      seedTwoStationsWithTransfer();
      act(() => {
        useDoc.setState({
          ...useDoc.getState(),
          transferColor: '#000000',
          transferStrokeColor: '#ffffff',
          transferStrokeWidth: 3,
        });
      });
      render(<App />);
      act(() => {
        useSelection.getState().selectTransfer('x1');
      });
      // 3 lines: selection ring + user stroke + body.
      expect(transferLines('x1').length).toBe(3);
      // Width = visibleExtent (2 + 2*3 = 8) + 2 * pad (2.5) = 13.
      expect(Number(widestLine('x1').getAttribute('stroke-width'))).toBe(13);
    });
  });

  // Per-transfer overrides: an absent field tracks the doc setting, a present
  // field wins over it (see Transfer in model/types.ts).
  describe('per-transfer style overrides', () => {
    const seedSecondTransfer = (overrides: Partial<Transfer>) => {
      act(() => {
        useDoc.setState({
          ...useDoc.getState(),
          transfers: {
            ...useDoc.getState().transfers,
            x2: {
              id: 'x2',
              a: { stationId: 's1', lineId: 'L1' },
              b: { stationId: 's2', lineId: 'L2' },
              ...overrides,
            },
          },
        });
      });
    };

    it('an overridden transfer renders its own body style; a sibling keeps tracking', () => {
      seedTwoStationsWithTransfer();
      seedSecondTransfer({ thickness: 6, color: '#ff8800' });
      render(<App />);

      const overridden = transferBody('x2');
      expect(overridden.getAttribute('stroke')).toBe('#ff8800');
      expect(overridden.getAttribute('stroke-width')).toBe('6');
      const tracking = transferBody('x1');
      expect(tracking.getAttribute('stroke')).toBe('#000000');
      expect(tracking.getAttribute('stroke-width')).toBe('2');

      // Later doc-setting changes reach ONLY the tracking transfer.
      act(() => {
        useDoc.setState({
          ...useDoc.getState(),
          transferColor: '#00aa66',
          transferThickness: 4,
        });
      });
      expect(transferBody('x1').getAttribute('stroke')).toBe('#00aa66');
      expect(transferBody('x1').getAttribute('stroke-width')).toBe('4');
      expect(transferBody('x2').getAttribute('stroke')).toBe('#ff8800');
      expect(transferBody('x2').getAttribute('stroke-width')).toBe('6');
    });

    it('a strokeWidth override renders a halo for that transfer only', () => {
      seedTwoStationsWithTransfer();
      seedSecondTransfer({ strokeWidth: 3, strokeColor: '#abcdef' });
      render(<App />);

      // x1 tracks the doc's strokeWidth 0 → body only.
      expect(transferLines('x1').length).toBe(1);
      const lines = transferLines('x2');
      expect(lines.length).toBe(2);
      const body = transferBody('x2');
      const halo = lines.find((el) => el !== body)!;
      expect(halo.getAttribute('stroke')).toBe('#abcdef');
      // visibleExtent = default thickness 2 + 2 * override 3 = 8.
      expect(Number(halo.getAttribute('stroke-width'))).toBe(8);
    });

    it('a strokeWidth 0 override turns the halo OFF while the doc default has one', () => {
      seedTwoStationsWithTransfer();
      act(() => {
        useDoc.setState({
          ...useDoc.getState(),
          transferStrokeWidth: 3,
          transferStrokeColor: '#abcdef',
        });
      });
      seedSecondTransfer({ strokeWidth: 0 });
      render(<App />);

      // x1 tracks the doc's strokeWidth 3 → halo + body; x2's 0 override
      // suppresses its halo entirely (0 is a real override, not "unset").
      expect(transferLines('x1').length).toBe(2);
      expect(transferLines('x2').length).toBe(1);
    });

    it("the selection ring sizes to the transfer's own effective extent", () => {
      seedTwoStationsWithTransfer();
      seedSecondTransfer({ thickness: 6, strokeWidth: 3 });
      render(<App />);
      act(() => {
        useSelection.getState().selectTransfer('x2');
      });
      const ring = transferLines('x2').reduce((widest, el) =>
        Number(el.getAttribute('stroke-width')) > Number(widest.getAttribute('stroke-width'))
          ? el
          : widest,
      );
      // visibleExtent = 6 + 2*3 = 12; ring = 12 + 2 * 2.5 pad = 17.
      expect(Number(ring.getAttribute('stroke-width'))).toBe(17);
    });
  });

  // The creation rubber band must read as PROVISIONAL — dashed + translucent —
  // not like an already-placed transfer at full color and weight.
  describe('creating-transfer rubber band', () => {
    it('renders the preview dashed and translucent', () => {
      seedTwoStationsWithTransfer();
      render(<App />);
      act(() => {
        useSelection.getState().setUiMode({
          kind: 'creating-transfer',
          anchor: { stationId: 's1', lineId: 'L1' },
        });
      });
      // Cursor tracking populates cursorWorld; jsdom geometry is degenerate
      // but the branch only needs a truthy cursor point to render.
      fireEvent.pointerMove(document.querySelector('.canvas-host > svg')!, {
        clientX: 120,
        clientY: 80,
      });
      try {
        const preview = document.querySelector('line[data-transfer-preview]');
        expect(preview).not.toBeNull();
        expect(preview!.getAttribute('stroke-dasharray')).toBe('6 4');
        expect(Number(preview!.getAttribute('opacity'))).toBe(0.6);
      } finally {
        act(() => {
          useSelection.getState().setUiMode({ kind: 'idle' });
        });
      }
    });
  });
});
