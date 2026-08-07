import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import App from '../App';
import { useDoc } from '../state/store';
import { useSelection } from '../state/store';
import { useViewportStore } from '../state/viewportStore';
import { DEFAULT_DOC } from '../model/transforms';
import type { Line, Station, Transfer } from '../model/types';
import { makeLine } from '../test/fixtures';
import { resolveHitStack } from './canvas/hitStack';

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
  const l1: Line = makeLine({
    id: 'L1',
    service: 'L1',
    name: 'L1 line',
    color: '#0039A6',
    stations: ['s1'],
  });
  const l2: Line = makeLine({
    id: 'L2',
    service: 'L2',
    name: 'L2 line',
    color: '#EE352E',
    stations: ['s2'],
  });
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

// Each transfer renders 1-2 <line>s tagged `data-transfer-id` (halo pass,
// then body pass; the body is the narrower), plus — when selected — one
// <path> ring tracing its capsule outline. Tests pick lines by relative
// width to stay robust against color collisions.
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
  it('visible body <line> resolves the day/night color for the active theme, plus overrides', () => {
    seedTwoStationsWithTransfer();
    render(<App />);

    let body = transferBody('x1');
    // Default is black in both themes.
    expect(body.getAttribute('stroke')).toBe('#000000');
    expect(body.getAttribute('stroke-width')).toBe('2');

    act(() => {
      useDoc.getState().updateTransferStyle('x1', {
        color: { day: '#ff8800', night: '#4400aa' },
        thickness: 6,
      });
    });

    body = transferBody('x1');
    // Light canvas → the day half paints.
    expect(body.getAttribute('stroke')).toBe('#ff8800');
    expect(body.getAttribute('stroke-width')).toBe('6');

    // Dark canvas → the night half paints (same transfer, no doc change).
    act(() => {
      useDoc.setState({ darkMode: true });
    });
    try {
      expect(transferBody('x1').getAttribute('stroke')).toBe('#4400aa');
    } finally {
      act(() => {
        useDoc.setState({ darkMode: false });
      });
    }
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
    it('does not render a stroke line when the stroke width is 0 (default)', () => {
      seedTwoStationsWithTransfer();
      render(<App />);
      // Unselected with no stroke → exactly one line (the body).
      expect(transferLines('x1').length).toBe(1);
    });

    it('renders a stroke line wider than the body when the stroke width override > 0', () => {
      seedTwoStationsWithTransfer();
      act(() => {
        useDoc.getState().updateTransferStyle('x1', {
          strokeWidth: 3,
          strokeColor: { day: '#abcdef', night: '#102030' },
        });
      });
      render(<App />);
      const lines = transferLines('x1');
      // Unselected → 2 lines: stroke (outer) then body (inner).
      expect(lines.length).toBe(2);
      const body = transferBody('x1');
      const stroke = lines.find((el) => el !== body)!;
      // Light canvas → the day half of the outline color.
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
          transfers: {
            ...useDoc.getState().transfers,
            x2: {
              id: 'x2',
              a: { stationId: 's1', lineId: 'L1' },
              b: { stationId: 's2', lineId: 'L2' },
            },
          },
        });
        useDoc.getState().updateTransferStyle('x1', { strokeWidth: 3 });
        useDoc.getState().updateTransferStyle('x2', { strokeWidth: 3 });
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

  // The selected-transfer outline is a two-tone capsule ring: a 2px ink core
  // over a 4px underlay (1px of underlay showing on each edge), both <path>s
  // tracing the capsule perimeter offset a fixed world pad out from the visible
  // edge (the bodies and halos stay <line>s). It flips with the theme —
  // white-black-white on the light canvas, black-white-black on the dark one —
  // so it stays legible against any body color (including the black/white
  // transfers commonly are). The geometry is pure world units — no zoom in the
  // math — and both strokes hold their screen weight via
  // vector-effect="non-scaling-stroke", so the ring tracks in-flight pan/zoom
  // gestures natively instead of snapping on commit.
  describe('selection outline', () => {
    const rings = (id: string) =>
      Array.from(document.querySelectorAll(`path[data-transfer-id="${id}"]`));

    it('renders a black ink core over a white underlay tracing the capsule perimeter (light)', () => {
      seedTwoStationsWithTransfer();
      render(<App />);
      act(() => {
        useSelection.getState().selectTransfer('x1');
      });
      const els = rings('x1');
      expect(els.length).toBe(2);
      const [edge, core] = els;
      // Light canvas → WBW: white underlay first (4px), black core on top (2px)
      // → 1px white rim on each side of the black.
      expect(edge.getAttribute('stroke')).toBe('#ffffff');
      expect(edge.getAttribute('stroke-width')).toBe('4');
      expect(core.getAttribute('stroke')).toBe('#000000');
      expect(core.getAttribute('stroke-width')).toBe('2');
      for (const el of els) {
        expect(el.getAttribute('fill')).toBe('none');
        // Screen-constant weight WITHOUT zoom math.
        expect(el.getAttribute('vector-effect')).toBe('non-scaling-stroke');
        expect(el.getAttribute('stroke-dasharray')).toBeNull();
        expect(el.getAttribute('pointer-events')).toBe('none');
        // Capsule radius = visibleExtent/2 (thickness 2 / 2 = 1) + world pad
        // 2.5 = 3.5, traced between the stop dots at (0,0) and (200,0).
        expect(el.getAttribute('d')).toBe(
          'M 0 3.5 L 200 3.5 A 3.5 3.5 0 0 0 200 -3.5 L 0 -3.5 A 3.5 3.5 0 0 0 0 3.5 Z',
        );
      }
    });

    it('renders no ring while unselected', () => {
      seedTwoStationsWithTransfer();
      render(<App />);
      expect(rings('x1').length).toBe(0);
    });

    it('is zoom-independent: identical markup at any committed zoom (no snap on commit)', () => {
      seedTwoStationsWithTransfer();
      act(() => {
        useViewportStore.setState({ zoom: 2 });
      });
      try {
        render(<App />);
        act(() => {
          useSelection.getState().selectTransfer('x1');
        });
        // Same geometry and widths as at zoom 1 — the browser compensates
        // the strokes via vector-effect, so committed zoom never re-renders.
        const [edge, core] = rings('x1');
        expect(edge.getAttribute('stroke-width')).toBe('4');
        expect(core.getAttribute('stroke-width')).toBe('2');
        for (const el of [edge, core]) {
          expect(el.getAttribute('d')).toBe(
            'M 0 3.5 L 200 3.5 A 3.5 3.5 0 0 0 200 -3.5 L 0 -3.5 A 3.5 3.5 0 0 0 0 3.5 Z',
          );
        }
      } finally {
        act(() => {
          useViewportStore.setState({ zoom: 1 });
        });
      }
    });

    it('paints ABOVE transfer bodies AND station dots — nothing on the map covers it', () => {
      seedTwoStationsWithTransfer();
      render(<App />);
      act(() => {
        useSelection.getState().selectTransfer('x1');
      });
      const body = transferBody('x1');
      // The dots layer paints after TransferLayer (dots cover transfer ends),
      // so the ring must live OUTSIDE TransferLayer, above the dots.
      const dot = document.querySelector('[data-stop-station="s1"]')!;
      const PRECEDING = Node.DOCUMENT_POSITION_PRECEDING;
      for (const el of rings('x1')) {
        expect(el.compareDocumentPosition(body) & PRECEDING).toBeTruthy();
        expect(el.compareDocumentPosition(dot) & PRECEDING).toBeTruthy();
      }
    });

    it('flips to a black underlay under a white ink core in dark mode (BWB)', () => {
      seedTwoStationsWithTransfer();
      act(() => {
        useDoc.setState({ darkMode: true });
      });
      try {
        render(<App />);
        act(() => {
          useSelection.getState().selectTransfer('x1');
        });
        // Dark canvas → BWB: black underlay (4px), white ink core (2px).
        const [edge, core] = rings('x1');
        expect(edge.getAttribute('stroke')).toBe('#000000');
        expect(core.getAttribute('stroke')).toBe('#ffffff');
      } finally {
        act(() => {
          useDoc.setState({ darkMode: false });
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
      for (const el of rings('x1')) {
        expect(el.getAttribute('data-export-exclude')).toBe('1');
      }
    });

    it('pads around the user stroke when present', () => {
      seedTwoStationsWithTransfer();
      act(() => {
        useDoc.getState().updateTransferStyle('x1', { strokeWidth: 3 });
      });
      render(<App />);
      act(() => {
        useSelection.getState().selectTransfer('x1');
      });
      // 2 lines (user stroke + body) plus the two ring paths.
      expect(transferLines('x1').length).toBe(2);
      // Radius = visibleExtent/2 ((2 + 2*3)/2 = 4) + pad 2.5 = 6.5.
      for (const el of rings('x1')) {
        expect(el.getAttribute('d')).toContain('A 6.5 6.5');
      }
    });
  });

  // Per-transfer overrides: an absent field falls back to the constant
  // default, a present field wins over it (see Transfer in model/types.ts).
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

    it('an overridden transfer renders its own body style; a sibling keeps the defaults', () => {
      seedTwoStationsWithTransfer();
      seedSecondTransfer({ thickness: 6, color: { day: '#ff8800', night: '#ff8800' } });
      render(<App />);

      const overridden = transferBody('x2');
      expect(overridden.getAttribute('stroke')).toBe('#ff8800');
      expect(overridden.getAttribute('stroke-width')).toBe('6');
      const plain = transferBody('x1');
      expect(plain.getAttribute('stroke')).toBe('#000000');
      expect(plain.getAttribute('stroke-width')).toBe('2');

      // Choosing the defaults again clears the overrides — back to constants.
      act(() => {
        useDoc
          .getState()
          .updateTransferStyle('x2', { thickness: 2, color: { day: '#000000', night: '#000000' } });
      });
      expect(transferBody('x2').getAttribute('stroke')).toBe('#000000');
      expect(transferBody('x2').getAttribute('stroke-width')).toBe('2');
    });

    it('a strokeWidth override renders a halo for that transfer only', () => {
      seedTwoStationsWithTransfer();
      seedSecondTransfer({ strokeWidth: 3, strokeColor: { day: '#abcdef', night: '#abcdef' } });
      render(<App />);

      // x1 keeps the constant strokeWidth 0 → body only.
      expect(transferLines('x1').length).toBe(1);
      const lines = transferLines('x2');
      expect(lines.length).toBe(2);
      const body = transferBody('x2');
      const halo = lines.find((el) => el !== body)!;
      expect(halo.getAttribute('stroke')).toBe('#abcdef');
      // visibleExtent = default thickness 2 + 2 * override 3 = 8.
      expect(Number(halo.getAttribute('stroke-width'))).toBe(8);
    });

    it("the selection ring sizes to the transfer's own effective extent", () => {
      seedTwoStationsWithTransfer();
      seedSecondTransfer({ thickness: 6, strokeWidth: 3 });
      render(<App />);
      act(() => {
        useSelection.getState().selectTransfer('x2');
      });
      const ring = document.querySelector('path[data-transfer-id="x2"]')!;
      // Radius = visibleExtent/2 ((6 + 2*3)/2 = 6) + pad 2.5 = 8.5.
      expect(ring.getAttribute('d')).toContain('A 8.5 8.5');
    });
  });

  // A SELF-transfer (both ends on one stop dot) is a zero-length capsule — a
  // disc, painted as an explicit <circle> with a fill to hit-test.
  describe('self-transfer disc', () => {
    const seedSelfTransfer = (overrides: Partial<Transfer> = {}) => {
      seedTwoStationsWithTransfer();
      act(() => {
        useDoc.setState({
          ...useDoc.getState(),
          transfers: {
            self: {
              id: 'self',
              a: { stationId: 's1', lineId: 'L1' },
              b: { stationId: 's1', lineId: 'L1' },
              ...overrides,
            },
          },
        });
      });
    };
    const discs = (id: string) =>
      Array.from(document.querySelectorAll(`circle[data-transfer-id="${id}"]`));

    it('paints a filled <circle> at the stop, sized to the body thickness', () => {
      seedSelfTransfer({ thickness: 12, color: { day: '#ff8800', night: '#ff8800' } });
      render(<App />);
      expect(transferLines('self')).toHaveLength(0);
      const els = discs('self');
      expect(els).toHaveLength(1);
      expect(els[0].getAttribute('cx')).toBe('0');
      expect(els[0].getAttribute('cy')).toBe('0');
      expect(Number(els[0].getAttribute('r'))).toBe(6);
      expect(els[0].getAttribute('fill')).toBe('#ff8800');
      // No stroke on the disc — the halo is its own, wider circle below.
      expect(els[0].getAttribute('stroke')).toBeNull();
    });

    it('is hit-testable by its FILL, so an alt-click can reach it under the dot', () => {
      seedSelfTransfer({ thickness: 12 });
      render(<App />);
      expect(discs('self')[0].getAttribute('pointer-events')).toBe('fill');
      fireEvent.click(discs('self')[0]);
      expect(useSelection.getState().selectedTransferId).toBe('self');
    });

    it('renders the halo as a wider disc, still in the halo pass (before the body)', () => {
      seedSelfTransfer({ thickness: 12, strokeWidth: 3 });
      render(<App />);
      const els = discs('self');
      expect(els).toHaveLength(2);
      const [halo, body] = els;
      // visibleExtent = 12 + 2*3 = 18 → r 9; body r 6.
      expect(Number(halo.getAttribute('r'))).toBe(9);
      expect(Number(body.getAttribute('r'))).toBe(6);
      const PRECEDING = Node.DOCUMENT_POSITION_PRECEDING;
      expect(body.compareDocumentPosition(halo) & PRECEDING).toBeTruthy();
    });

    it('selects with a circular ring (the capsule degenerates)', () => {
      seedSelfTransfer({ thickness: 12 });
      render(<App />);
      act(() => {
        useSelection.getState().selectTransfer('self');
      });
      const ring = document.querySelector('path[data-transfer-id="self"]')!;
      // Radius = visibleExtent/2 (6) + pad 2.5 = 8.5, as a two-arc circle.
      expect(ring.getAttribute('d')).toContain('A 8.5 8.5');
    });
  });

  // The `draw` axis slots a transfer at one of four rungs in the stop-dot
  // stack. The dots pass is three sub-passes deep — every dot's stroke
  // silhouette, then every body, then every service code — so each rung is a
  // gap between two of them (see TransferDrawOrder).
  describe('draw order', () => {
    // A stroked, code-bearing dot on s1: the only shape that puts all three
    // dot sub-passes on the canvas at once, so each rung has both neighbours
    // to be measured against.
    const seedRichDot = (draw?: Transfer['draw']) => {
      seedTwoStationsWithTransfer();
      act(() => {
        const s1 = useDoc.getState().stations.s1;
        useDoc.setState({
          ...useDoc.getState(),
          stations: {
            ...useDoc.getState().stations,
            s1: {
              ...s1,
              stops: [
                {
                  ...s1.stops[0],
                  dotStyle: {
                    shape: 'circle',
                    fill: { day: '#000000', night: '#000000' },
                    strokeWidth: 2,
                    strokeColor: { day: '#ffffff', night: '#ffffff' },
                    strokeAlign: 'center',
                    showServiceCode: true,
                  },
                },
              ],
            },
          },
        });
        if (draw) useDoc.getState().updateTransferStyle('x1', { draw });
      });
    };
    const one = (sel: string) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`no element for ${sel}`);
      return el;
    };
    // s1's three dot sub-pass elements, bottom-up.
    const silhouette = () => one('[data-stop-stroke="s1"][data-stop-line="L1"]');
    const body = () => one('[data-stop-station="s1"][data-stop-line="L1"]');
    const code = () => one('[data-stop-code="s1"][data-stop-line="L1"]');
    // `a` paints before `b` (so b covers a).
    const under = (a: Element, b: Element) =>
      Boolean(b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_PRECEDING);

    it('the dots pass splits into silhouettes → bodies → codes, in that order', () => {
      seedRichDot();
      render(<App />);
      expect(under(silhouette(), body())).toBe(true);
      expect(under(body(), code())).toBe(true);
    });

    it('"under" (the default) paints beneath the whole stack, silhouettes included', () => {
      seedRichDot();
      render(<App />);
      expect(useDoc.getState().transfers.x1.draw).toBeUndefined();
      expect(under(transferBody('x1'), silhouette())).toBe(true);
    });

    it('"over-stroke" paints over the dot silhouette but under its body', () => {
      seedRichDot('over-stroke');
      render(<App />);
      expect(under(silhouette(), transferBody('x1'))).toBe(true);
      expect(under(transferBody('x1'), body())).toBe(true);
    });

    it('"over-dot" paints over the dot body but under the service code', () => {
      seedRichDot('over-dot');
      render(<App />);
      expect(under(body(), transferBody('x1'))).toBe(true);
      expect(under(transferBody('x1'), code())).toBe(true);
    });

    it('"over-code" paints over everything the dot draws', () => {
      seedRichDot('over-code');
      render(<App />);
      expect(under(code(), transferBody('x1'))).toBe(true);
    });

    // Paint order IS hit order in SVG, and this canvas leans on that
    // everywhere (see the drag-proxy reroute, which exists precisely because
    // selection must keep following paint order while dragging does not). So
    // lifting a transfer over a dot lifts its CLICK over that dot too. That is
    // the deliberate trade, not an oversight — pinned here so it can't change
    // silently, and reachable the same way every other buried item is.
    it('an "under" transfer loses the click where it crosses a dot; a lifted one wins it', () => {
      seedRichDot();
      render(<App />);
      // Baseline: the dot is above the 'under' rung, so its pixels absorb.
      fireEvent.click(body());
      expect(useSelection.getState().selectedStationIds).toEqual(['s1']);
      expect(useSelection.getState().selectedTransferId).toBeNull();
    });

    it('a lifted transfer takes the click over the dot it covers', () => {
      seedRichDot('over-dot');
      render(<App />);
      fireEvent.click(transferBody('x1'));
      expect(useSelection.getState().selectedTransferId).toBe('x1');
      // The station underneath stays reachable through the alt+click deep
      // pick, which resolves the whole hit stack rather than the top element.
      expect(resolveHitStack([transferBody('x1'), body()]).map((e) => `${e.kind}:${e.id}`)).toEqual(
        ['transfer:x1', 'station:s1'],
      );
    });

    it('rungs are independent: two transfers can sit on opposite sides of one dot', () => {
      seedRichDot('over-code');
      act(() => {
        useDoc.setState({
          ...useDoc.getState(),
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
      expect(under(transferBody('x2'), silhouette())).toBe(true);
      expect(under(code(), transferBody('x1'))).toBe(true);
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
          firstEnd: { stationId: 's1', lineId: 'L1' },
        });
      });
      // Cursor tracking populates cursorWorld; jsdom geometry is degenerate
      // but the branch only needs a truthy cursor point to render.
      fireEvent.pointerMove(document.querySelector('.canvas-host svg')!, {
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
