import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { StationView } from './StationView';
import { useDoc, useSelection } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { makeLine, makeStation, makeStop } from '../test/fixtures';
import { computeRenderedStopPositions } from '../geometry/stopPositions';
import { STOP_SIZE } from '../geometry/orientation';

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useSelection.setState({
    ...useSelection.getState(),
    hoveredStationId: null,
    selectedStationIds: [],
    selectedLineId: null,
    appendingToLineId: null,
  });
});

function renderLabel() {
  const station = makeStation({ id: 's1', name: 'Foo', x: 100, y: 100 });
  const { container } = render(
    <svg>
      <StationView station={station} lines={{}} zoom={1} onStartDrag={vi.fn()} layer="label" />
    </svg>,
  );
  // The first <text> rendered by the label layer is the station name.
  const text = container.querySelector('text');
  if (!text) throw new Error('expected <text> for station label');
  return { text, station };
}

describe('<StationView /> — label styling', () => {
  it('uses the document defaults: fontSize 12, weight 400, no italic', () => {
    const { text } = renderLabel();
    expect(text.getAttribute('font-size')).toBe('12');
    expect(text.getAttribute('font-weight')).toBe('400');
    expect(text.getAttribute('font-style')).toBeNull();
  });

  it('applies labelFontSize, labelBold, and labelItalic from the store', () => {
    useDoc.setState({
      ...useDoc.getState(),
      labelFontSize: 18,
      labelBold: true,
      labelItalic: true,
    });
    const { text } = renderLabel();
    expect(text.getAttribute('font-size')).toBe('18');
    expect(text.getAttribute('font-weight')).toBe('700');
    expect(text.getAttribute('font-style')).toBe('italic');
  });

  it('hover bumps weight to 700 even when labelBold is off', () => {
    const { text, station } = (() => {
      const station = makeStation({ id: 's1', name: 'Foo', x: 0, y: 0 });
      useSelection.setState({ ...useSelection.getState(), hoveredStationId: station.id });
      const { container } = render(
        <svg>
          <StationView station={station} lines={{}} zoom={1} onStartDrag={vi.fn()} layer="label" />
        </svg>,
      );
      const text = container.querySelector('text');
      if (!text) throw new Error('expected <text>');
      return { text, station };
    })();
    expect(useDoc.getState().labelBold).toBe(false);
    expect(text.getAttribute('font-weight')).toBe('700');
    // Sanity: station was actually rendered.
    expect(text.textContent).toContain(station.name);
  });
});

describe('<StationView /> — inline bullets in station names', () => {
  it('renders no bullets and a single <text> for plain station names', () => {
    const station = makeStation({ id: 's1', name: 'Plain', x: 0, y: 0 });
    const { container } = render(
      <svg>
        <StationView station={station} lines={{}} zoom={1} onStartDrag={vi.fn()} layer="label" />
      </svg>,
    );
    expect(container.querySelectorAll('[data-inline-bullet]')).toHaveLength(0);
    // Plain text path is intentionally kept as a single <text> + <tspan>s so
    // the wash silhouette and hit-test rect stay byte-for-byte the same.
    expect(container.querySelectorAll('text')).toHaveLength(1);
  });

  it('emits a colored inline bullet when the name contains <CODE>', () => {
    const station = makeStation({ id: 's1', name: 'Hub <A1>', x: 0, y: 0 });
    const lines = {
      L1: makeLine({ id: 'L1', service: 'A1', color: '#abc123' }),
    };
    const { container } = render(
      <svg>
        <StationView station={station} lines={lines} zoom={1} onStartDrag={vi.fn()} layer="label" />
      </svg>,
    );
    const bullets = container.querySelectorAll('[data-inline-bullet]');
    expect(bullets).toHaveLength(1);
    expect(bullets[0].querySelector('circle')?.getAttribute('fill')).toBe('#abc123');
  });

  it('falls back to a gray "?" bullet for an unknown code', () => {
    const station = makeStation({ id: 's1', name: '<ZZ>', x: 0, y: 0 });
    const { container } = render(
      <svg>
        <StationView station={station} lines={{}} zoom={1} onStartDrag={vi.fn()} layer="label" />
      </svg>,
    );
    const bullet = container.querySelector('[data-inline-bullet]');
    expect(bullet?.querySelector('circle')?.getAttribute('fill')).toBe('#888');
    expect(bullet?.querySelector('text')?.textContent).toBe('?');
  });
});

describe('<StationView /> — dot layer renders at compressed positions', () => {
  it('three diagonal stops at a station render dots at the compressed world coords', () => {
    // Three perp-adjacent auto-nw-se stops at one station — should compress
    // to STOP_SIZE perp spacing centered on the cell-grid centroid (L2 cell).
    const station = makeStation({
      id: 's1',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [
        makeStop('L1', { row: 1, col: 2, orientation: 'auto-nw-se' }),
        makeStop('L2', { row: 2, col: 1, orientation: 'auto-nw-se' }),
        makeStop('L3', { row: 3, col: 0, orientation: 'auto-nw-se' }),
      ],
    });
    const stations = { [station.id]: station };
    const renderedPos = computeRenderedStopPositions(stations);
    const lines = {
      L1: makeLine({ id: 'L1', service: 'L1', color: '#0039A6' }),
      L2: makeLine({ id: 'L2', service: 'L2', color: '#EE352E' }),
      L3: makeLine({ id: 'L3', service: 'L3', color: '#00933C' }),
    };
    const { container } = render(
      <svg>
        <StationView
          station={station}
          lines={lines}
          zoom={1}
          onStartDrag={vi.fn()}
          layer="dots"
          renderedPos={renderedPos}
        />
      </svg>,
    );

    const readDot = (lineId: string) => {
      const el = container.querySelector(`[data-stop-station="s1"][data-stop-line="${lineId}"]`);
      if (!el) throw new Error(`no dot for ${lineId}`);
      return { cx: parseFloat(el.getAttribute('cx')!), cy: parseFloat(el.getAttribute('cy')!) };
    };

    const d1 = readDot('L1');
    const d2 = readDot('L2');
    const d3 = readDot('L3');

    // The middle stop sits at the cell-grid centroid (= L2's own cell pos).
    expect(d2.cx).toBeCloseTo(STOP_SIZE, 5); // col 1
    expect(d2.cy).toBeCloseTo(2 * STOP_SIZE, 5); // row 2

    // Centroid of compressed dots equals cell centroid.
    expect((d1.cx + d2.cx + d3.cx) / 3).toBeCloseTo(STOP_SIZE, 5);
    expect((d1.cy + d2.cy + d3.cy) / 3).toBeCloseTo(2 * STOP_SIZE, 5);

    // Consecutive pairs at STOP_SIZE apart (post-compression band stripe pitch).
    expect(Math.hypot(d2.cx - d1.cx, d2.cy - d1.cy)).toBeCloseTo(STOP_SIZE, 5);
    expect(Math.hypot(d3.cx - d2.cx, d3.cy - d2.cy)).toBeCloseTo(STOP_SIZE, 5);
  });

  it('a king-adjacent trailer on a different axis lands STOP_SIZE from its anchor', () => {
    // Screenshot fixture: 3 auto-nw-se band + 1 auto-horizontal trailer at
    // (4, -1), king-adjacent SW of L3. The trailer's dot should sit
    // STOP_SIZE SW of L3's compressed dot.
    const station = makeStation({
      id: 's1',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [
        makeStop('L1', { row: 1, col: 2, orientation: 'auto-nw-se' }),
        makeStop('L2', { row: 2, col: 1, orientation: 'auto-nw-se' }),
        makeStop('L3', { row: 3, col: 0, orientation: 'auto-nw-se' }),
        makeStop('L4', { row: 4, col: -1, orientation: 'auto-horizontal' }),
      ],
    });
    const stations = { [station.id]: station };
    const renderedPos = computeRenderedStopPositions(stations);
    const lines = {
      L1: makeLine({ id: 'L1', service: 'L1', color: '#0039A6' }),
      L2: makeLine({ id: 'L2', service: 'L2', color: '#EE352E' }),
      L3: makeLine({ id: 'L3', service: 'L3', color: '#00933C' }),
      L4: makeLine({ id: 'L4', service: 'L4', color: '#808080' }),
    };
    const { container } = render(
      <svg>
        <StationView
          station={station}
          lines={lines}
          zoom={1}
          onStartDrag={vi.fn()}
          layer="dots"
          renderedPos={renderedPos}
        />
      </svg>,
    );

    const readDot = (lineId: string) => {
      const el = container.querySelector(`[data-stop-station="s1"][data-stop-line="${lineId}"]`);
      if (!el) throw new Error(`no dot for ${lineId}`);
      return { cx: parseFloat(el.getAttribute('cx')!), cy: parseFloat(el.getAttribute('cy')!) };
    };

    const d3 = readDot('L3');
    const d4 = readDot('L4');
    // STOP_SIZE distance, in the SW direction.
    expect(Math.hypot(d4.cx - d3.cx, d4.cy - d3.cy)).toBeCloseTo(STOP_SIZE, 5);
    expect(d4.cx - d3.cx).toBeCloseTo(-STOP_SIZE * Math.SQRT1_2, 5);
    expect(d4.cy - d3.cy).toBeCloseTo(STOP_SIZE * Math.SQRT1_2, 5);
  });

  it('falls back to cell-grid positions when no renderedPos is supplied', () => {
    // Sanity for the StationView default path. Cardinal stops, no compression.
    const station = makeStation({
      id: 's1',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [makeStop('L1', { row: 0, col: 0, orientation: 'auto-vertical' })],
    });
    const lines = { L1: makeLine({ id: 'L1', service: 'L1', color: '#0039A6' }) };
    const { container } = render(
      <svg>
        <StationView station={station} lines={lines} zoom={1} onStartDrag={vi.fn()} layer="dots" />
      </svg>,
    );
    const el = container.querySelector('[data-stop-station="s1"][data-stop-line="L1"]');
    if (!el) throw new Error('no dot for L1');
    expect(parseFloat(el.getAttribute('cx')!)).toBeCloseTo(0, 5);
    expect(parseFloat(el.getAttribute('cy')!)).toBeCloseTo(0, 5);
  });
});
