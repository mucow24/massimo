import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, fireEvent } from '@testing-library/react';
import App from '../App';
import { dragState, useDoc } from '../state/store';
import { useSelection } from '../state/selection';
import { DEFAULT_DOC } from '../model/transforms';
import { makeLine, stationWithStop } from '../test/fixtures';
import type { LineId, StationId } from '../model/types';

// Edit Stops — a hovered FOREIGN line whose segment is `hatched`.
// The overlay (HighlightedLineLayer) repaints that line with SegmentBand but
// passes NO colorMap, so the body resolves the RAW line color and emits
// stroke="url(#hatch-<raw>)". MapCanvas's <defs> however registers hatch
// patterns for colorMap?.[id] ?? color — the DESATURATED hue while a line is
// being edited. The referenced id therefore doesn't exist in <defs>.

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
          // The C–D corridor is hatched.
          segmentStyles: { 'C|D': 'hatched' },
        }),
      },
      lineOrder: ['L1', 'L2'] as LineId[],
    });
    useSelection.getState().startAppend('L1' as LineId);
  });
};

// Every `url(#…)` id referenced by a paint attribute inside `root`.
const paintRefs = (root: Element): string[] => {
  const out: string[] = [];
  for (const el of Array.from(root.querySelectorAll('*'))) {
    for (const attr of ['stroke', 'fill'] as const) {
      const v = el.getAttribute(attr);
      const m = v && /^url\(#(.+)\)$/.exec(v);
      if (m) out.push(m[1]);
    }
  }
  return out;
};

describe('hovered foreign line with a hatched segment', () => {
  it('references only hatch patterns that actually exist in <defs>', () => {
    render(<App />);
    seedTwoLines();

    const foreign = document.querySelector('[data-band-stripe][data-line-id="L2"]')!;
    expect(foreign).not.toBeNull();
    fireEvent.pointerMove(foreign, { clientX: 100, clientY: 200 });
    expect(useSelection.getState().appendHover).toEqual({ kind: 'line', lineId: 'L2' });

    const group = document.querySelector('[data-append-hover-line="L2"]')!;
    expect(group).not.toBeNull();

    const definedIds = new Set(
      Array.from(document.querySelectorAll('pattern[id]')).map((p) => p.id),
    );
    const referenced = paintRefs(group).filter((id) => id.startsWith('hatch'));

    // The hovered foreign line's hatched body must reference a pattern that
    // exists, otherwise it paints nothing at all.
    expect(referenced.length).toBeGreaterThan(0);
    const dangling = referenced.filter((id) => !definedIds.has(id));
    expect({ dangling, defined: Array.from(definedIds) }).toEqual({
      dangling: [],
      defined: Array.from(definedIds),
    });
  });
});
