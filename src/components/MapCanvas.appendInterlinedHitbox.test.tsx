import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, fireEvent } from '@testing-library/react';
import App from '../App';
import { dragState, useDoc } from '../state/store';
import { useSelection } from '../state/selection';
import { DEFAULT_DOC } from '../model/transforms';
import { makeLine, makeStation, makeStop } from '../test/fixtures';
import type { LineId, StationId } from '../model/types';

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
