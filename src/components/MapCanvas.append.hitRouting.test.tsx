import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '../App';
import { DEFAULT_DOC } from '../model/transforms';
import type { LineId, LineStyle, StationId } from '../model/types';
import { useSelection } from '../state/selection';
import { dragState, useDoc } from '../state/store';
import { makeLine, makeStation, makeStop, stationWithStop } from '../test/fixtures';

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
  useSelection.setState({
    ...useSelection.getState(),
    toolMode: 'arrow',
    spaceHeld: false,
    altHeld: false,
    uiMode: { kind: 'idle' },
    selectedStationIds: [],
    appendHover: null,
  });
  dragState.suppressClick = false;
});

// ---------------------------------------------------------------------------
// from MapCanvas.appendDashedHitbox.test.tsx
// ---------------------------------------------------------------------------
// Edit Stops on a segment whose style has GAPS (dashed / dotted / dashed-open):
// the painted stroke is a run of separate dashes, so `pointer-events: stroke` on
// it made only the painted pieces clickable — roughly a coin flip on whether a
// click on the segment registered at all. The band now emits a continuous
// transparent hit box over the whole stripe, and THAT is the pointer surface.

// One line, one edge A|B, painted in the given per-segment style. Editing L1.
const seedStyled = (style: LineStyle) => {
  act(() => {
    useDoc.setState({
      ...useDoc.getState(),
      stations: {
        A: makeStation({ id: 'A' as StationId, x: 0, y: 0, stops: [makeStop('L1' as LineId)] }),
        B: makeStation({ id: 'B' as StationId, x: 200, y: 0, stops: [makeStop('L1' as LineId)] }),
      },
      lines: {
        L1: makeLine({
          id: 'L1' as LineId,
          stations: ['A', 'B'] as StationId[],
          segmentStyles: { 'A|B': style },
        }),
      },
      lineOrder: ['L1'] as LineId[],
    });
    useSelection.getState().startAppend('L1' as LineId);
  });
};

// The band's OWN hit box. Edit Stops also lifts a `data-band-lift` copy of the
// edited line's pointer surface above the band layer (see MapCanvas); that one
// is mounted for every style, so it must not be mistaken for the gappy-style
// hit box this file is about.
const hitbox = () =>
  document.querySelector('[data-band-hitbox]:not([data-band-lift])[data-pair-key="A|B"]');

describe('Edit Stops — a gappy segment is clickable across its whole length', () => {
  it.each(['dashed', 'dotted', 'dashed-open'] as LineStyle[])(
    'gives a %s segment a continuous hit box, not just its painted pieces',
    (style) => {
      render(<App />);
      seedStyled(style);
      const hit = hitbox()!;
      expect(hit).not.toBeNull();
      expect(hit.getAttribute('stroke-dasharray')).toBeNull();
      // The painted stripe keeps its gaps — this is a hit fix, not a paint one.
      const stripe = document.querySelector('[data-band-stripe][data-pair-key="A|B"]')!;
      expect(stripe.getAttribute('stroke-dasharray')).toBeTruthy();
    },
  );

  it('arms the edge cursor from the hit box', () => {
    render(<App />);
    seedStyled('dashed');
    fireEvent.click(hitbox()!, { clientX: 100, clientY: 0 });
    const mode = useSelection.getState().uiMode;
    expect(mode.kind === 'appending-to-line' && mode.cursor?.kind).toBe('edge');
  });

  it('previews the segment halo from the hit box', () => {
    render(<App />);
    seedStyled('dashed');
    fireEvent.pointerMove(hitbox()!, { clientX: 100, clientY: 0 });
    expect(useSelection.getState().appendHover).toEqual({ kind: 'segment', pairKey: 'A|B' });
  });

  it('leaves a SOLID segment with its painted stroke as the only hit surface', () => {
    render(<App />);
    seedStyled('solid');
    expect(hitbox()).toBeNull();
    expect(
      document
        .querySelector('[data-band-stripe][data-pair-key="A|B"]')!
        .getAttribute('pointer-events'),
    ).toBe('stroke');
  });
});

// ---------------------------------------------------------------------------
// from MapCanvas.appendInterlinedHitbox.test.tsx
// ---------------------------------------------------------------------------
// Edit Stops hit box: the target for splicing into the edited line's edge is
// that line's OWN stripe. When two lines interline along the same corridor the
// band has one stripe per line, side by side; the edited line's stripe sits at
// one edge of the band (mean-centered offsets). Historically ANY stripe in the
// corridor targeted the edited segment, so the clickable region spilled a full
// stripe width across the neighbor on the inner side but stopped at the visible
// edge on the outer side — a ~stripe-width asymmetric hit box about the line
// the user sees highlighted. A co-corridor neighbor stripe now behaves like any
// other foreign stripe: it previews / switches to ITS line, keeping the segment
// target symmetric about the edited line. (Mirrors resolveAppendStack, which
// already scopes alt-pick segments to data-line-id === editedLineId.)

// L1 and L2 BOTH run edge A-B → interlined into one band with two stripes for
// corridor A|B. Editing L1.
const seedInterlined = () => {
  act(() => {
    useDoc.setState({
      ...useDoc.getState(),
      stations: {
        A: makeStation({
          id: 'A' as StationId,
          x: 0,
          y: 0,
          stops: [makeStop('L1' as LineId), makeStop('L2' as LineId)],
        }),
        B: makeStation({
          id: 'B' as StationId,
          x: 200,
          y: 0,
          stops: [makeStop('L1' as LineId), makeStop('L2' as LineId)],
        }),
      },
      lines: {
        L1: makeLine({ id: 'L1' as LineId, stations: ['A', 'B'] as StationId[] }),
        L2: makeLine({
          id: 'L2' as LineId,
          service: 'B',
          color: '#0039a6',
          stations: ['A', 'B'] as StationId[],
        }),
      },
      lineOrder: ['L1', 'L2'] as LineId[],
    });
    useSelection.getState().startAppend('L1' as LineId);
  });
};

const ownStripe = () =>
  document.querySelector('[data-band-stripe][data-line-id="L1"][data-pair-key="A|B"]')!;
const neighborStripe = () =>
  document.querySelector('[data-band-stripe][data-line-id="L2"][data-pair-key="A|B"]')!;

describe('Edit Stops — interlined-corridor hit box is symmetric about the edited line', () => {
  it('renders one stripe per line for the shared corridor A|B', () => {
    render(<App />);
    seedInterlined();
    expect(ownStripe()).not.toBeNull();
    expect(neighborStripe()).not.toBeNull();
  });

  it("hovering the edited line's OWN stripe targets the segment", () => {
    render(<App />);
    seedInterlined();
    fireEvent.pointerMove(ownStripe(), { clientX: 100, clientY: 0 });
    expect(useSelection.getState().appendHover).toEqual({ kind: 'segment', pairKey: 'A|B' });
  });

  it('hovering the co-corridor NEIGHBOR stripe targets its LINE, not the edited segment', () => {
    render(<App />);
    seedInterlined();
    fireEvent.pointerMove(neighborStripe(), { clientX: 100, clientY: 0 });
    // Was {segment, A|B} (the asymmetry); now a switch-line preview.
    expect(useSelection.getState().appendHover).toEqual({ kind: 'line', lineId: 'L2' });
  });

  it('clicking the co-corridor NEIGHBOR stripe switches the editor to that line', () => {
    render(<App />);
    seedInterlined();
    fireEvent.click(neighborStripe(), { clientX: 100, clientY: 0 });
    const mode = useSelection.getState().uiMode;
    expect(mode.kind).toBe('appending-to-line');
    expect(mode.kind === 'appending-to-line' && mode.lineId).toBe('L2');
    // The neighbor click did NOT splice a stop into the edited line L1.
    expect(useDoc.getState().lines.L1.stations).toEqual(['A', 'B']);
  });

  it("clicking the edited line's OWN stripe arms the edge cursor (still works)", () => {
    render(<App />);
    seedInterlined();
    fireEvent.click(ownStripe(), { clientX: 100, clientY: 0 });
    const mode = useSelection.getState().uiMode;
    expect(mode.kind).toBe('appending-to-line');
    if (mode.kind === 'appending-to-line') {
      expect(mode.lineId).toBe('L1');
      expect(mode.cursor?.kind).toBe('edge');
    }
  });
});

// ---------------------------------------------------------------------------
// from MapCanvas.appendEditedLineHitLift.test.tsx
// ---------------------------------------------------------------------------
// Edit Stops: the line being edited owns every pixel it paints. The mode dims
// the map and repaints the edited line ON TOP of it, so the base layer's
// z-priority (whichever line `lineOrder` happens to put in front) is invisible
// to the user — yet it was what hit-testing followed. Over a crossing where
// another line painted above, hovering the line you are editing highlighted
// THAT line and a click switched the editor to it; and the casing rim of the
// edited line was dead to the pointer entirely (the painted body is inset by
// railW), so the same steal happened along both edges of every stripe.
//
// The mode therefore lifts the edited line's pointer surface — one transparent
// stroke per stripe, at the FULL painted width, casing included — above every
// band renderable. Stations stay above it, so the pen still wins on a stop.

// L1 runs A–B horizontally, L2 runs C–D vertically: the two CROSS at (100, 0).
// `lineOrder` puts L2 first — index 0 is front-most — so L2's stripe paints
// over L1's at the crossing, which is exactly the case that stole the hover.
// L1 carries a casing so its painted body is inset from its stripe width.
const seedCrossing = () => {
  act(() => {
    useDoc.setState({
      ...useDoc.getState(),
      stations: {
        A: stationWithStop('A' as StationId, 'L1' as LineId, { x: 0, y: 0 }),
        B: stationWithStop('B' as StationId, 'L1' as LineId, { x: 200, y: 0 }),
        C: stationWithStop('C' as StationId, 'L2' as LineId, { x: 100, y: -100 }),
        D: stationWithStop('D' as StationId, 'L2' as LineId, { x: 100, y: 100 }),
      },
      lines: {
        L1: makeLine({ id: 'L1' as LineId, stations: ['A', 'B'] as StationId[], strokeWidth: 2 }),
        L2: makeLine({
          id: 'L2' as LineId,
          service: 'B',
          color: '#0039a6',
          stations: ['C', 'D'] as StationId[],
        }),
      },
      lineOrder: ['L2', 'L1'] as LineId[],
    });
    useSelection.getState().startAppend('L1' as LineId);
  });
};

const lift = () =>
  document.querySelector('[data-band-lift][data-line-id="L1"][data-pair-key="A|B"]')!;

describe('Edit Stops — the edited line owns the pixels it paints', () => {
  it('hovering the edited line targets its segment, not the line painted over it', () => {
    render(<App />);
    seedCrossing();
    fireEvent.pointerMove(lift(), { clientX: 100, clientY: 0 });
    expect(useSelection.getState().appendHover).toEqual({ kind: 'segment', pairKey: 'A|B' });
  });

  it('clicking the edited line arms its edge cursor instead of switching lines', () => {
    render(<App />);
    seedCrossing();
    fireEvent.click(lift(), { clientX: 100, clientY: 0 });
    const mode = useSelection.getState().uiMode;
    expect(mode.kind === 'appending-to-line' && mode.lineId).toBe('L1');
    expect(mode.kind === 'appending-to-line' && mode.cursor?.kind).toBe('edge');
  });

  it('paints its hit surface after every other line’s stripe, so it wins the pointer', () => {
    render(<App />);
    seedCrossing();
    const foreign = document.querySelectorAll(
      '[data-band-stripe]:not([data-line-id="L1"]),[data-band-hitbox]:not([data-line-id="L1"])',
    );
    expect(foreign.length).toBeGreaterThan(0);
    for (const el of foreign) {
      // b PRECEDING a ⇒ a is later in the document ⇒ a hit-tests first.
      expect(lift().compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    }
  });

  it('stays below the station hit areas, so a station still beats a segment', () => {
    render(<App />);
    seedCrossing();
    const stationRect = document.querySelector('[data-station-id="A"] rect')!;
    expect(
      lift().compareDocumentPosition(stationRect) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('spans the stripe’s full painted width — the casing rim, not the inset body', () => {
    render(<App />);
    seedCrossing();
    const casing = document.querySelector('[data-band-casing][data-line-id="L1"]')!;
    const body = document.querySelector('[data-band-stripe][data-line-id="L1"]')!;
    // The casing silhouette IS the line's outer painted extent, so matching it
    // makes the pointer surface exactly the line the user sees.
    expect(lift().getAttribute('stroke-width')).toBe(casing.getAttribute('stroke-width'));
    expect(Number(lift().getAttribute('stroke-width'))).toBeGreaterThan(
      Number(body.getAttribute('stroke-width')),
    );
  });

  it('is invisible chrome: transparent and excluded from export', () => {
    render(<App />);
    seedCrossing();
    expect(lift().getAttribute('stroke')).toBe('transparent');
    expect(lift().getAttribute('data-export-exclude')).toBe('1');
  });

  it('exists only while a line is being edited', () => {
    render(<App />);
    seedCrossing();
    act(() => useSelection.getState().setAppending(null));
    expect(document.querySelector('[data-band-lift]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// from MapCanvas.appendAltGhost.test.tsx
// ---------------------------------------------------------------------------
// Edit Stops alt-ghost: while Alt is held over empty canvas and the alt-click
// would create a station (decideCanvasClick returns a create-* decision), the
// canvas previews the actual stop dot the new station would get — at the same
// snapped point the drop will use. No ghost when the alt-click would do
// nothing, when the pointer is over an interactive target (the click routes
// there instead), or once Alt is released.

const seedAndEnter = (memberIds: string[]) => {
  act(() => {
    useDoc.setState({
      ...useDoc.getState(),
      stations: {
        A: stationWithStop('A' as StationId, 'L1' as LineId, { x: 0, y: 0 }),
        B: stationWithStop('B' as StationId, 'L1' as LineId, { x: 200, y: 0 }),
      },
      lines: {
        L1: makeLine({ id: 'L1' as LineId, stations: memberIds as StationId[] }),
      },
      lineOrder: ['L1' as LineId],
    });
    useSelection.getState().startAppend('L1' as LineId);
  });
};

const altDown = () => fireEvent.keyDown(window, { key: 'Alt' });
const altUp = () => fireEvent.keyUp(window, { key: 'Alt' });
const moveOnCanvas = () =>
  fireEvent.pointerMove(document.querySelector('.canvas-host svg')!, {
    clientX: 400,
    clientY: 300,
  });
const ghost = () => document.querySelector('[data-append-create-ghost]');

describe('MapCanvas — Edit Stops alt-held create ghost', () => {
  it('pen armed + Alt held over empty canvas shows the ghost dot', () => {
    render(<App />);
    seedAndEnter(['A', 'B']);
    act(() => useSelection.getState().setAppendCursor({ kind: 'station', stationId: 'A' }));
    altDown();
    moveOnCanvas();
    expect(ghost()).not.toBeNull();
  });

  it('empty line + Alt held shows the ghost too (the seed creation)', () => {
    render(<App />);
    seedAndEnter([]);
    altDown();
    moveOnCanvas();
    expect(ghost()).not.toBeNull();
  });

  it('no ghost when nothing is armed on a non-empty line (alt-click is inert)', () => {
    render(<App />);
    seedAndEnter(['A', 'B']);
    altDown();
    moveOnCanvas();
    expect(ghost()).toBeNull();
  });

  it('no ghost while the pointer is over an interactive target', () => {
    render(<App />);
    seedAndEnter(['A', 'B']);
    act(() => useSelection.getState().setAppendCursor({ kind: 'station', stationId: 'A' }));
    altDown();
    moveOnCanvas();
    act(() => useSelection.getState().setAppendHover({ kind: 'station', stationId: 'B' }));
    expect(ghost()).toBeNull();
  });

  it("shows the ghost over the line's OWN armed segment (alt-click there splices)", () => {
    render(<App />);
    seedAndEnter(['A', 'B']);
    act(() => useSelection.getState().setAppendCursor({ kind: 'edge', from: 'A', to: 'B' }));
    altDown();
    moveOnCanvas();
    // Hovering the armed segment: alt-click splices a stop into it, so the
    // create ghost DOES show here (unlike other interactive targets).
    act(() => useSelection.getState().setAppendHover({ kind: 'segment', pairKey: 'A|B' }));
    expect(ghost()).not.toBeNull();
  });

  it('no ghost over a segment while the pen is armed (alt-click there arms it, does not splice)', () => {
    render(<App />);
    seedAndEnter(['A', 'B']);
    act(() => useSelection.getState().setAppendCursor({ kind: 'station', stationId: 'A' }));
    altDown();
    moveOnCanvas();
    // A station cursor is armed, not this edge, so an alt-click on the segment
    // would ARM it, not create — no ghost.
    act(() => useSelection.getState().setAppendHover({ kind: 'segment', pairKey: 'A|B' }));
    expect(ghost()).toBeNull();
  });

  it('releasing Alt hides the ghost immediately; window blur does too', () => {
    render(<App />);
    seedAndEnter(['A', 'B']);
    act(() => useSelection.getState().setAppendCursor({ kind: 'station', stationId: 'A' }));
    altDown();
    moveOnCanvas();
    expect(ghost()).not.toBeNull();

    altUp();
    expect(ghost()).toBeNull();

    // A stuck flag after alt-tab would strand the ghost — blur resets it,
    // matching the spaceHeld convention.
    altDown();
    moveOnCanvas();
    expect(ghost()).not.toBeNull();
    fireEvent.blur(window);
    expect(ghost()).toBeNull();
  });
});
