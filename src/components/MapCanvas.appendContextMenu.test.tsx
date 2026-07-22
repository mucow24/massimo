import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, fireEvent } from '@testing-library/react';
import App from '../App';
import { dragState, useDoc } from '../state/store';
import { useSelection } from '../state/selection';
import { DEFAULT_DOC } from '../model/transforms';
import { makeLine, stationWithStop } from '../test/fixtures';
import type { LineId, StationId } from '../model/types';

// Right-click during Edit Stops is the mouse-only exit. With station
// manipulation (drag/rotate) unwired from the mode, EVERY canvas right-click
// — station, edited-line segment, empty background — leaves the editor
// through the same cancelAppendMode() path Esc and the exit canvas-click
// take. The old right-click-removes-edge accelerator is retired (it sat one
// slip away from the exit gesture); removal is the × chip or the Delete key.

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

const contextMenuOn = (selector: string) => {
  const el = document.querySelector(selector);
  expect(el, selector).not.toBeNull();
  fireEvent.contextMenu(el!);
};

describe('MapCanvas — right-click exits Edit Stops', () => {
  it('right-click on the empty background exits the mode', () => {
    render(<App />);
    seedAndEnter();
    contextMenuOn('[data-bg]');
    expect(useSelection.getState().uiMode.kind).toBe('idle');
  });

  it('right-click on a segment of the edited line exits WITHOUT removing the edge', () => {
    render(<App />);
    seedAndEnter();
    contextMenuOn('[data-band-stripe][data-line-id="L1"]');
    expect(useSelection.getState().uiMode.kind).toBe('idle');
    expect(useDoc.getState().lines.L1.edges).toEqual(['A|B']);
  });

  it('right-click on a station exits WITHOUT rotating it', () => {
    render(<App />);
    seedAndEnter();
    contextMenuOn('[data-station-id="A"]');
    expect(useSelection.getState().uiMode.kind).toBe('idle');
    expect(useDoc.getState().stations.A.rotation).toBe(0);
    // The line itself is untouched — exit is non-destructive.
    expect(useDoc.getState().lines.L1.stations).toEqual(['A', 'B']);
  });

  it('right-click on a segment in idle mode does NOT remove the edge (retired accelerator stays retired)', () => {
    // The old right-click-removes-edge accelerator is gone everywhere, not just
    // inside Edit Stops. Outside the mode a right-click on the band stripe must
    // leave the topology untouched — no mode is entered and no edge is dropped.
    render(<App />);
    seedAndEnter();
    act(() => useSelection.getState().setAppending(null));
    expect(useSelection.getState().uiMode.kind).toBe('idle');
    contextMenuOn('[data-band-stripe][data-line-id="L1"]');
    expect(useSelection.getState().uiMode.kind).toBe('idle');
    expect(useDoc.getState().lines.L1.edges).toEqual(['A|B']);
  });
});
