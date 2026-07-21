import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, fireEvent } from '@testing-library/react';
import App from '../App';
import { dragState, useDoc } from '../state/store';
import { useSelection } from '../state/selection';
import { DEFAULT_DOC } from '../model/transforms';
import { makeLine, stationWithStop } from '../test/fixtures';
import type { LineId, StationId } from '../model/types';

// The Edit Stops hover preview (ring/halo) must not render mid-pan. A
// middle-button pan captures the pointer, so the stripes get no enter/leave
// while the world slides beneath — the frozen appendHover would keep painting
// a halo under a pointer that is no longer over it. The caller promises
// HighlightedLineLayer an "already pan-suppressed" target; that must cover an
// arrow-mode middle-drag pan, not just hand mode.

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

const seedAndEnter = () => {
  act(() => {
    useDoc.setState({
      ...useDoc.getState(),
      stations: {
        A: stationWithStop('A' as StationId, 'L1' as LineId, { x: 0, y: 0 }),
        B: stationWithStop('B' as StationId, 'L1' as LineId, { x: 200, y: 0 }),
      },
      lines: { L1: makeLine({ id: 'L1' as LineId, stations: ['A', 'B'] as StationId[] }) },
      lineOrder: ['L1' as LineId],
    });
    useSelection.getState().startAppend('L1' as LineId);
  });
};

describe('MapCanvas — append hover preview suppressed while panning', () => {
  it('a middle-button pan hides the segment hover halo until the pan ends', () => {
    render(<App />);
    seedAndEnter();
    act(() => useSelection.getState().setAppendHover({ kind: 'segment', pairKey: 'A|B' }));
    expect(document.querySelector('[data-append-hover-segment="A|B"]')).not.toBeNull();

    const bg = document.querySelector('[data-bg]')!;
    fireEvent.pointerDown(bg, { button: 1, buttons: 4, clientX: 300, clientY: 300, pointerId: 7 });
    // Sanity: the pan is live (the svg wears the .panning cursor class).
    expect(document.querySelector('svg.panning')).not.toBeNull();
    expect(document.querySelector('[data-append-hover-segment="A|B"]')).toBeNull();

    fireEvent.pointerUp(bg, { button: 1, clientX: 320, clientY: 300, pointerId: 7 });
    expect(document.querySelector('svg.panning')).toBeNull();
    expect(document.querySelector('[data-append-hover-segment="A|B"]')).not.toBeNull();
  });
});
