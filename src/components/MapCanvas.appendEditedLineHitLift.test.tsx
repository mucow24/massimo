import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, fireEvent } from '@testing-library/react';
import App from '../App';
import { dragState, useDoc } from '../state/store';
import { useSelection } from '../state/selection';
import { DEFAULT_DOC } from '../model/transforms';
import { makeLine, stationWithStop } from '../test/fixtures';
import type { LineId, StationId } from '../model/types';

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

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
  useSelection.setState({
    ...useSelection.getState(),
    toolMode: 'arrow',
    spaceHeld: false,
    uiMode: { kind: 'idle' },
    selectedStationIds: [],
    appendHover: null,
  });
  dragState.suppressClick = false;
});

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
