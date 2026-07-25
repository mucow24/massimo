import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, fireEvent } from '@testing-library/react';
import App from '../App';
import { dragState, useDoc } from '../state/store';
import { useSelection } from '../state/selection';
import { DEFAULT_DOC } from '../model/transforms';
import { makeLine, stationWithStop } from '../test/fixtures';
import type { LineId, StationId } from '../model/types';

// ADVERSARIAL PROBE (independent re-derivation).
//
// Invariant under test: every `url(#hatch-…)` paint reference the canvas emits
// must resolve to a <pattern> that <defs> actually contains. An SVG paint
// server reference that points at nothing paints NOTHING.
//
// The test includes a CONTROL: the same invariant is asserted on the BASE
// layer's hatched stripe first. If the control passes and the lift fails, the
// failure is specific to the hovered-foreign-line lift, not to the harness.

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

// L1 (red, edited) and L2 (blue) with L2's only corridor styled `hatched`.
const seed = () => {
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
        L1: makeLine({ id: 'L1' as LineId, color: '#e0132f', stations: ['A', 'B'] as StationId[] }),
        L2: makeLine({
          id: 'L2' as LineId,
          service: 'B',
          color: '#0039a6',
          stations: ['C', 'D'] as StationId[],
          segmentStyles: { 'C|D': 'hatched' },
        }),
      },
      lineOrder: ['L1', 'L2'] as LineId[],
    });
    useSelection.getState().startAppend('L1' as LineId);
  });
};

// Ids referenced by `stroke`/`fill` paint attributes anywhere under `root`.
const hatchRefsUnder = (root: Element): string[] => {
  const out = new Set<string>();
  const scan = (el: Element) => {
    for (const attr of ['stroke', 'fill'] as const) {
      const v = el.getAttribute(attr);
      const m = v && /^url\(#(.+)\)$/.exec(v);
      if (m && m[1].startsWith('hatch')) out.add(m[1]);
    }
  };
  scan(root);
  for (const el of Array.from(root.querySelectorAll('*'))) scan(el);
  return Array.from(out).sort();
};

const emittedPatternIds = (): string[] =>
  Array.from(document.querySelectorAll('pattern[id]'))
    .map((p) => p.getAttribute('id')!)
    .sort();

describe('Edit Stops foreign-line lift must reference emitted hatch patterns', () => {
  it('every hatch paint reference in the hovered-line lift resolves to a <pattern> in <defs>', () => {
    render(<App />);
    seed();

    // ---- CONTROL: the BASE paint of the same hatched segment ----------------
    // Proves the doc/style/geometry plumbing is real and that the emitter and
    // the base consumer agree, so a later failure is not "nothing renders".
    const baseStripe = document.querySelector('[data-band-stripe][data-line-id="L2"]')!;
    expect(baseStripe).not.toBeNull();
    const baseRefs = hatchRefsUnder(baseStripe);
    expect(baseRefs.length).toBeGreaterThan(0); // it IS painted with a hatch
    expect(baseRefs.filter((id) => !emittedPatternIds().includes(id))).toEqual([]);

    // ---- SUBJECT: hover the foreign line so the lift paints -----------------
    fireEvent.pointerMove(baseStripe, { clientX: 100, clientY: 200 });
    expect(useSelection.getState().appendHover).toEqual({ kind: 'line', lineId: 'L2' });

    const lift = document.querySelector('[data-append-hover-line="L2"]')!;
    expect(lift).not.toBeNull();

    const liftRefs = hatchRefsUnder(lift);
    expect(liftRefs.length).toBeGreaterThan(0); // the lift does paint hatch

    // Every one of them must exist. Compared as a whole array so the failure
    // message shows exactly which id is dangling and what <defs> holds.
    const defined = emittedPatternIds();
    expect({ dangling: liftRefs.filter((id) => !defined.includes(id)), definedInDefs: defined }) //
      .toEqual({ dangling: [], definedInDefs: defined });
  });
});
