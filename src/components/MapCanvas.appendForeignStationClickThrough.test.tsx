import { beforeEach, describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import App from '../App';
import { dragState, useDoc } from '../state/store';
import { useSelection } from '../state/selection';
import { DEFAULT_DOC } from '../model/transforms';
import { makeLine, makeStation, makeStop } from '../test/fixtures';
import type { LineId, StationId } from '../model/types';

// Edit Stops with NOTHING armed (append cursor null): a station that is NOT a
// member of the edited line is a dead click, and it visually sits over other
// lines. It must go click-through (pointer-events: none) so the click falls
// through to the line beneath — switching the editor to it — instead of being
// swallowed by the station on top. An armed cursor makes foreign stations live
// again (a click there CONNECTS the edited line to them), so the gate is the
// null cursor only. Member stations of the edited line are never affected.

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

// L1 (edited) has members A,B. L2 is a separate line with foreign members C,D.
const seedForeign = () => {
  act(() => {
    useDoc.setState({
      ...useDoc.getState(),
      stations: {
        A: makeStation({ id: 'A' as StationId, x: 0, y: 0, stops: [makeStop('L1' as LineId)] }),
        B: makeStation({ id: 'B' as StationId, x: 200, y: 0, stops: [makeStop('L1' as LineId)] }),
        C: makeStation({ id: 'C' as StationId, x: 0, y: 100, stops: [makeStop('L2' as LineId)] }),
        D: makeStation({ id: 'D' as StationId, x: 200, y: 100, stops: [makeStop('L2' as LineId)] }),
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

// The transparent hit rect of a station's bg pass carries the pointer-events
// that `hitless` controls.
const hitPointerEvents = (id: string) =>
  document
    .querySelector(`[data-station-id="${id}"] rect[fill="transparent"]`)
    ?.getAttribute('pointer-events') ?? null;

describe('Edit Stops — foreign stations are click-through when nothing is armed', () => {
  it('makes a foreign (non-member) station click-through with a null cursor', () => {
    render(<App />);
    seedForeign();
    expect(hitPointerEvents('C')).toBe('none');
  });

  it('keeps member stations of the edited line hittable (a click arms the pen there)', () => {
    render(<App />);
    seedForeign();
    expect(hitPointerEvents('A')).toBe('all');
    expect(hitPointerEvents('B')).toBe('all');
  });

  it('re-enables foreign stations once the pen is armed (a click there connects)', () => {
    render(<App />);
    seedForeign();
    act(() => {
      useSelection.getState().setAppendCursor({ kind: 'station', stationId: 'A' as StationId });
    });
    expect(hitPointerEvents('C')).toBe('all');
  });

  it('keeps every station hittable when the edited line is EMPTY (a click seeds it)', () => {
    // With no members yet, a click on ANY station seeds the first stop — that is
    // never a dead click, so nothing goes click-through (the length>0 guard).
    render(<App />);
    act(() => {
      useDoc.setState({
        ...useDoc.getState(),
        stations: {
          C: makeStation({ id: 'C' as StationId, x: 0, y: 100, stops: [makeStop('L2' as LineId)] }),
          D: makeStation({
            id: 'D' as StationId,
            x: 200,
            y: 100,
            stops: [makeStop('L2' as LineId)],
          }),
        },
        lines: {
          L1: makeLine({ id: 'L1' as LineId, stations: [] as StationId[] }),
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
    expect(hitPointerEvents('C')).toBe('all');
  });
});
