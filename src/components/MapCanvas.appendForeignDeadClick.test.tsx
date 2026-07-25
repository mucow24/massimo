import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, fireEvent } from '@testing-library/react';
import App from '../App';
import { dragState, useDoc } from '../state/store';
import { useSelection } from '../state/selection';
import { DEFAULT_DOC } from '../model/transforms';
import { decideStationClick } from '../model/appendGestures';
import { makeLine, makeStation, makeStop } from '../test/fixtures';
import type { LineId, StationId } from '../model/types';

// Edit Stops: a dead click on a foreign station must stay dead.
//
// f9a9157 made a non-member station click-through (pointer-events: none) while
// the append cursor is null, reasoning "the click was already dead, so let it
// fall through to the line beneath". But pointer-events does not choose WHAT it
// falls through to — only that this surface stops hit-testing. Where no stripe
// is painted under the station's footprint, the click lands on MapCanvas's
// full-viewport background rect, which onCanvasClick treats as a canvas click →
// decideCanvasClick(line, null, false) → {kind:'exit'} → cancelAppendMode().
//
// The scenario below is the cleanest instance: station Z is an ORPHAN (created
// by the place-station tool, not yet on any line — store.addStation makes
// stations with stops: []). It has no stripe of its own and sits far from every
// other line, so the ONLY thing painted beneath its footprint is the background
// rect. The pre-f9a9157 behavior was a genuine no-op; now it tears down the
// whole editing session.

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

// L1 (the edited line) has members A,B near the origin. Z is an orphan station
// with NO stops at all, parked far away — nothing else in the doc is anywhere
// near it.
const seedOrphan = () => {
  act(() => {
    useDoc.setState({
      ...useDoc.getState(),
      stations: {
        A: makeStation({ id: 'A' as StationId, x: 0, y: 0, stops: [makeStop('L1' as LineId)] }),
        B: makeStation({ id: 'B' as StationId, x: 200, y: 0, stops: [makeStop('L1' as LineId)] }),
        Z: makeStation({ id: 'Z' as StationId, x: 0, y: 600, stops: [] }),
      },
      lines: { L1: makeLine({ id: 'L1' as LineId, stations: ['A', 'B'] as StationId[] }) },
      lineOrder: ['L1'] as LineId[],
    });
    useSelection.getState().startAppend('L1' as LineId);
  });
};

const hitRect = (id: string) =>
  document.querySelector(`[data-station-id="${id}"] rect[fill="transparent"]`);

/**
 * Click inside station `id`'s footprint the way a browser routes it.
 *
 * A surface with `pointer-events: none` is removed from hit-testing, so the
 * click is delivered to whatever paints BENEATH the point. For orphan station Z
 * there is nothing below it but MapCanvas's full-viewport `data-bg` rect — no
 * band stripe, no other station, and the dim wash is itself pointerEvents="none"
 * (HighlightedLineLayer). So the retarget below is exactly what the browser does.
 */
const clickInFootprint = (id: string) => {
  const rect = hitRect(id);
  expect(rect, `hit rect for ${id}`).not.toBeNull();
  const passesThrough = rect!.getAttribute('pointer-events') === 'none';
  const target = passesThrough ? document.querySelector('[data-bg]') : rect;
  expect(target, 'click target').not.toBeNull();
  fireEvent.click(target!, {});
};

describe('Edit Stops: clicking a foreign station with nothing armed', () => {
  it('is a dead click per the gesture matrix (nothing should happen)', () => {
    // The model layer agrees the click means nothing: not a member, no cursor.
    const line = makeLine({ id: 'L1' as LineId, stations: ['A', 'B'] as StationId[] });
    expect(decideStationClick(line, null, 'Z' as StationId, false)).toEqual({ kind: 'none' });
  });

  it('leaves the Edit Stops session intact', () => {
    render(<App />);
    seedOrphan();
    expect(useSelection.getState().uiMode).toEqual({
      kind: 'appending-to-line',
      lineId: 'L1',
      cursor: null,
    });

    clickInFootprint('Z');

    // A dead click must not tear down the editor: the mode, the highlighted
    // line and the dim wash all have to survive it.
    expect(useSelection.getState().uiMode.kind).toBe('appending-to-line');
    expect(useSelection.getState().selectedLineId).toBe('L1');
  });

  it('CONTROL: the station hit rect itself still swallows the click', () => {
    // jsdom ignores pointer-events for *dispatched* events, so firing straight
    // at Z's hit rect exercises the handler that a real browser now skips.
    // It leaves the mode alone (decideStationClick → 'none' → return, after
    // e.stopPropagation()) — i.e. the ONLY thing that kills the editor is the
    // pointer-events retarget onto the background rect.
    render(<App />);
    seedOrphan();

    fireEvent.click(hitRect('Z')!, {});

    expect(useSelection.getState().uiMode.kind).toBe('appending-to-line');
  });
});
