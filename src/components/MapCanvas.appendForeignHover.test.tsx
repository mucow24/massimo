import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, fireEvent } from '@testing-library/react';
import App from '../App';
import { dragState, useDoc } from '../state/store';
import { useSelection } from '../state/selection';
import { DEFAULT_DOC } from '../model/transforms';
import { makeLine, stationWithStop } from '../test/fixtures';
import type { LineId, StationId } from '../model/types';

// Edit Stops: hovering another line's stripe marks that LINE as the hover
// target (a gentle whole-line highlight paints in HighlightedLineLayer), so
// "clicking here switches which line you're editing" is visible before the
// click silently discards the armed cursor.

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

const seedTwoLines = () => {
  act(() => {
    useDoc.setState({
      ...useDoc.getState(),
      stations: {
        A: stationWithStop('A' as StationId, 'L1' as LineId, { x: 0, y: 0 }),
        B: stationWithStop('B' as StationId, 'L1' as LineId, { x: 200, y: 0 }),
        C: stationWithStop('C' as StationId, 'L2' as LineId, { x: 0, y: 200 }),
        D: stationWithStop('D' as StationId, 'L2' as LineId, { x: 200, y: 200 }),
      },
      lines: {
        L1: makeLine({ id: 'L1' as LineId, stations: ['A', 'B'] as StationId[] }),
        L2: makeLine({
          id: 'L2' as LineId,
          service: 'B',
          color: '#0039a6',
          stations: ['C', 'D'] as StationId[],
        }),
      },
      lineOrder: ['L1', 'L2'] as LineId[],
    });
    useSelection.getState().startAppend('L1' as LineId);
  });
};

describe('MapCanvas — foreign-line hover during Edit Stops', () => {
  it('pointermove over a foreign stripe sets the line hover target and paints the preview', () => {
    render(<App />);
    seedTwoLines();

    const foreign = document.querySelector('[data-band-stripe][data-line-id="L2"]')!;
    expect(foreign).not.toBeNull();
    fireEvent.pointerMove(foreign, { clientX: 100, clientY: 200 });

    expect(useSelection.getState().appendHover).toEqual({ kind: 'line', lineId: 'L2' });
    expect(document.querySelector('[data-append-hover-line="L2"]')).not.toBeNull();
  });

  it('pointerleave clears the line hover target', () => {
    render(<App />);
    seedTwoLines();

    const foreign = document.querySelector('[data-band-stripe][data-line-id="L2"]')!;
    fireEvent.pointerMove(foreign, { clientX: 100, clientY: 200 });
    expect(useSelection.getState().appendHover).toEqual({ kind: 'line', lineId: 'L2' });

    fireEvent.pointerLeave(foreign);
    expect(useSelection.getState().appendHover).toBeNull();
  });

  it("the edited line's own stripes still set the segment hover, not a line hover", () => {
    render(<App />);
    seedTwoLines();

    const own = document.querySelector('[data-band-stripe][data-line-id="L1"]')!;
    fireEvent.pointerMove(own, { clientX: 100, clientY: 0 });
    expect(useSelection.getState().appendHover).toEqual({ kind: 'segment', pairKey: 'A|B' });
  });
});
