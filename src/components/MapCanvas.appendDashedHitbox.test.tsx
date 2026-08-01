import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, fireEvent } from '@testing-library/react';
import App from '../App';
import { dragState, useDoc } from '../state/store';
import { useSelection } from '../state/selection';
import { DEFAULT_DOC } from '../model/transforms';
import { makeLine, makeStation, makeStop } from '../test/fixtures';
import type { LineId, LineStyle, StationId } from '../model/types';

// Edit Stops on a segment whose style has GAPS (dashed / dotted / dashed-open):
// the painted stroke is a run of separate dashes, so `pointer-events: stroke` on
// it made only the painted pieces clickable — roughly a coin flip on whether a
// click on the segment registered at all. The band now emits a continuous
// transparent hit box over the whole stripe, and THAT is the pointer surface.

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
