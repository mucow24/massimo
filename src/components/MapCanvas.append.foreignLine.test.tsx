import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '../App';
import { decideStationClick } from '../model/appendGestures';
import { DEFAULT_DOC } from '../model/transforms';
import type { LineId, StationId } from '../model/types';
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
    uiMode: { kind: 'idle' },
    selectedStationIds: [],
    appendHover: null,
  });
  dragState.suppressClick = false;
});

// ---------------------------------------------------------------------------
// from MapCanvas.appendForeignHover.test.tsx
// ---------------------------------------------------------------------------
// Edit Stops: hovering another line's stripe marks that LINE as the hover
// target (a gentle whole-line highlight paints in HighlightedLineLayer), so
// "clicking here switches which line you're editing" is visible before the
// click silently discards the armed cursor.

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

// ---------------------------------------------------------------------------
// from MapCanvas.appendForeignDeadClick.test.tsx
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// from MapCanvas.appendForeignStationClickThrough.test.tsx
// ---------------------------------------------------------------------------
// Edit Stops with NOTHING armed (append cursor null): a station that is NOT a
// member of the edited line is a dead click, and it visually sits over other
// lines. It must go click-through (pointer-events: none) so the click falls
// through to the line beneath — switching the editor to it — instead of being
// swallowed by the station on top. An armed cursor makes foreign stations live
// again (a click there CONNECTS the edited line to them), so the gate is the
// null cursor only. Member stations of the edited line are never affected.

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

  it('re-enables foreign stations with an EDGE armed (a click there splices)', () => {
    // The other half of "an armed cursor makes foreign stations live": with a
    // segment armed rather than a pen, a click on a foreign station SPLICES it
    // into that segment. Same rule, other cursor kind — the gate is the click
    // matrix's dead-click case, not the station-cursor case alone.
    render(<App />);
    seedForeign();
    act(() => {
      useSelection
        .getState()
        .setAppendCursor({ kind: 'edge', from: 'A' as StationId, to: 'B' as StationId });
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
