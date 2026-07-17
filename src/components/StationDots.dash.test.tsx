import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { StationView } from './StationView';
import { useDoc, useSelection } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { makeLine, makeStation, makeStop } from '../test/fixtures';
import { DOT_SHAPE_PRESETS } from '../model/dotStyle';
import type { Line, Station } from '../model/types';

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useSelection.setState({
    ...useSelection.getState(),
    hoveredStationId: null,
    hoveredLineStop: null,
    selectedStationIds: [],
    selectedLineId: null,
    editingStationId: null,
    uiMode: { kind: 'idle' },
  });
  useDoc.setState({ darkMode: false });
});

const DASH = DOT_SHAPE_PRESETS['dash'];

function renderDots(station: Station, lines: Record<string, Line>) {
  const { container } = render(
    <svg>
      <StationView station={station} lines={lines} zoom={1} onStartDrag={vi.fn()} layer="dots" />
    </svg>,
  );
  return container.querySelector('svg')!;
}

describe('StationDots — dash stops render as ticks, not dots', () => {
  it('renders one rect per dash stop with the canonical data seam, in the line color', () => {
    const station = makeStation({
      id: 's1',
      x: 100,
      y: 50,
      stops: [makeStop('L1', { row: 0, col: 0, dotStyle: DASH })],
      label: { row: 0, col: 2, rotation: 0, offset: 0, align: 'auto', valign: 'auto-down' },
    });
    const svg = renderDots(station, {
      L1: makeLine({ id: 'L1', stations: ['s1'], color: '#e32017' }),
    });
    const ticks = svg.querySelectorAll('[data-stop-shape="dash"]');
    expect(ticks.length).toBe(1);
    const tick = ticks[0];
    expect(tick.tagName).toBe('rect');
    expect(tick.getAttribute('data-stop-station')).toBe('s1');
    expect(tick.getAttribute('data-stop-line')).toBe('L1');
    expect(tick.getAttribute('fill')).toBe('#e32017');
    // Label east of a vertical line: anchored at the east stripe edge,
    // pointing east (angle 0).
    expect(tick.getAttribute('transform')).toBe('translate(107 50) rotate(0)');
    // One data-stop-station element per stop (locator strict-mode invariant),
    // and no stroke-pass silhouette for a dash.
    expect(svg.querySelectorAll('[data-stop-station="s1"]').length).toBe(1);
    expect(svg.querySelectorAll('[data-stop-stroke]').length).toBe(0);
  });

  it('suppresses the dot glyph for dash stops but keeps neighbors intact, ticks painted beneath', () => {
    const station = makeStation({
      id: 's1',
      stops: [
        makeStop('L1', { row: 0, col: 0, dotStyle: DASH }),
        makeStop('L2', { row: 0, col: 1 }), // default filled-black circle
      ],
      label: { row: 0, col: 3, rotation: 0, offset: 0, align: 'auto', valign: 'auto-down' },
    });
    const svg = renderDots(station, {
      L1: makeLine({ id: 'L1', stations: ['s1'] }),
      L2: makeLine({ id: 'L2', stations: ['s1'] }),
    });
    expect(svg.querySelectorAll('[data-stop-shape="dash"]').length).toBe(1);
    expect(svg.querySelectorAll('[data-stop-shape="circle"]').length).toBe(1);
    // The tick paints before (beneath) the circle dot.
    const all = Array.from(svg.querySelectorAll('[data-stop-shape]')).map((el) =>
      el.getAttribute('data-stop-shape'),
    );
    expect(all).toEqual(['dash', 'circle']);
  });

  it('paints the tick nearest the label LAST (TfL stacking) on interlined dash runs', () => {
    const station = makeStation({
      id: 's1',
      stops: [
        makeStop('A', { row: 0, col: 0, dotStyle: DASH }),
        makeStop('B', { row: 0, col: 1, dotStyle: DASH }),
      ],
      label: { row: 0, col: 3, rotation: 0, offset: 0, align: 'auto', valign: 'auto-down' },
    });
    const svg = renderDots(station, {
      A: makeLine({ id: 'A', stations: ['s1'] }),
      B: makeLine({ id: 'B', stations: ['s1'] }),
    });
    const order = Array.from(svg.querySelectorAll('[data-stop-shape="dash"]')).map((el) =>
      el.getAttribute('data-stop-line'),
    );
    // B sits nearer the (east) label, so it paints after A.
    expect(order).toEqual(['A', 'B']);
  });

  it('flips the tick live when a label offset drags the anchor across the line (Option B)', () => {
    const base = makeStation({
      id: 's1',
      stops: [makeStop('L1', { row: 0, col: 0, dotStyle: DASH })],
      label: { row: 0, col: 1, rotation: 0, offset: 0, align: 'auto', valign: 'auto-down' },
    });
    const lines = { L1: makeLine({ id: 'L1', stations: ['s1'] }) };
    const { container, rerender } = render(
      <svg>
        <StationView station={base} lines={lines} zoom={1} onStartDrag={vi.fn()} layer="dots" />
      </svg>,
    );
    const tickOf = () => container.querySelector('[data-stop-shape="dash"]')!;
    expect(tickOf().getAttribute('transform')).toBe('translate(7 0) rotate(0)');
    // Same cell, offset −30 along the east reading axis ⇒ anchor now 16px
    // west of the line ⇒ the tick flips west, with no cell change.
    const dragged: Station = { ...base, label: { ...base.label, offset: -30 } };
    rerender(
      <svg>
        <StationView station={dragged} lines={lines} zoom={1} onStartDrag={vi.fn()} layer="dots" />
      </svg>,
    );
    expect(tickOf().getAttribute('transform')).toBe('translate(-7 0) rotate(180)');
  });
});
