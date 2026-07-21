import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, fireEvent } from '@testing-library/react';
import App from '../App';
import { dragState, useDoc } from '../state/store';
import { useSelection } from '../state/selection';
import { DEFAULT_DOC } from '../model/transforms';
import { makeLine, stationWithStop } from '../test/fixtures';
import type { LineId, StationId } from '../model/types';

// Edit Stops alt-ghost: while Alt is held over empty canvas and the alt-click
// would create a station (decideCanvasClick returns a create-* decision), the
// canvas previews the actual stop dot the new station would get — at the same
// snapped point the drop will use. No ghost when the alt-click would do
// nothing, when the pointer is over an interactive target (the click routes
// there instead), or once Alt is released.

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
