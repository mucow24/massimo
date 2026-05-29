import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { StationView } from './StationView';
import { useDoc, useSelection } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { makeLine, makeStation, makeStop } from '../test/fixtures';
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

  it('applies labelFontSize, labelWeight, and labelItalic from the store', () => {
    useDoc.setState({
      ...useDoc.getState(),
      labelFontSize: 18,
      labelWeight: 500,
      labelItalic: true,
    });
    const { text } = renderLabel();
    expect(text.getAttribute('font-size')).toBe('18');
    expect(text.getAttribute('font-weight')).toBe('500');
    expect(text.getAttribute('font-style')).toBe('italic');
  });

  it('per-station labelBold bumps the rendered weight two indices heavier (Regular → Bold)', () => {
    const station = { ...makeStation({ id: 's1', name: 'Foo' }), labelBold: true as const };
    const { container } = render(
      <svg>
        <StationView station={station} lines={{}} zoom={1} onStartDrag={vi.fn()} layer="label" />
      </svg>,
    );
    const text = container.querySelector('text');
    expect(text?.getAttribute('font-weight')).toBe('700'); // 400 → 700
  });

  it('per-station labelBold bumps two indices from a non-default labelWeight (Light → Medium)', () => {
    useDoc.setState({ ...useDoc.getState(), labelWeight: 300 });
    const station = { ...makeStation({ id: 's1', name: 'Foo' }), labelBold: true as const };
    const { container } = render(
      <svg>
        <StationView station={station} lines={{}} zoom={1} onStartDrag={vi.fn()} layer="label" />
      </svg>,
    );
    const text = container.querySelector('text');
    expect(text?.getAttribute('font-weight')).toBe('500'); // 300 → 500
  });

  it('per-station labelBold saturates at Black (900) when the default is near the top', () => {
    useDoc.setState({ ...useDoc.getState(), labelWeight: 800 });
    const station = { ...makeStation({ id: 's1', name: 'Foo' }), labelBold: true as const };
    const { container } = render(
      <svg>
        <StationView station={station} lines={{}} zoom={1} onStartDrag={vi.fn()} layer="label" />
      </svg>,
    );
    const text = container.querySelector('text');
    expect(text?.getAttribute('font-weight')).toBe('900');
  });

  it('hover bumps the rendered weight two indices heavier from the current weight (Regular → Bold)', () => {
    const station = makeStation({ id: 's1', name: 'Foo' });
    useSelection.setState({ ...useSelection.getState(), hoveredStationId: station.id });
    const { container } = render(
      <svg>
        <StationView station={station} lines={{}} zoom={1} onStartDrag={vi.fn()} layer="label" />
      </svg>,
    );
    const text = container.querySelector('text');
    expect(text?.getAttribute('font-weight')).toBe('700');
  });

  it('hover stacks on top of per-station bold (400 → 700 → 900), saturating at Black', () => {
    const station = { ...makeStation({ id: 's1', name: 'Foo' }), labelBold: true as const };
    useSelection.setState({ ...useSelection.getState(), hoveredStationId: station.id });
    const { container } = render(
      <svg>
        <StationView station={station} lines={{}} zoom={1} onStartDrag={vi.fn()} layer="label" />
      </svg>,
    );
    const text = container.querySelector('text');
    // 400 → +2 (station bold) → 700 → +2 (hover) → 900.
    expect(text?.getAttribute('font-weight')).toBe('900');
  });

  it('non-hovered labels render no underline geometry and no text-decoration attribute', () => {
    // The renderer draws the hover underline as an explicit <line> element
    // (not the SVG `text-decoration` attribute, which leaks paint residue
    // on rotated <text> in Chromium). When hover is off, there should be
    // neither the line element nor the attribute.
    const station = makeStation({ id: 's1', name: 'Foo' });
    const { container } = render(
      <svg>
        <StationView station={station} lines={{}} zoom={1} onStartDrag={vi.fn()} layer="label" />
      </svg>,
    );
    const text = container.querySelector('text');
    expect(text?.getAttribute('text-decoration')).toBeNull();
    expect(container.querySelectorAll('line')).toHaveLength(0);
  });

  it('hovered labels render one <line> underline per text line (replaces text-decoration)', () => {
    const station = makeStation({ id: 's1', name: 'Foo\nBar' });
    useSelection.setState({ ...useSelection.getState(), hoveredStationId: station.id });
    const { container } = render(
      <svg>
        <StationView station={station} lines={{}} zoom={1} onStartDrag={vi.fn()} layer="label" />
      </svg>,
    );
    // No SVG text-decoration attribute on the <text> — the underline is its
    // own geometry.
    const text = container.querySelector('text');
    expect(text?.getAttribute('text-decoration')).toBeNull();
    // One <line> per visible text line.
    const lines = Array.from(container.querySelectorAll('line'));
    expect(lines).toHaveLength(2);
  });

  it('hovered labels with an inline bullet still render <line> underlines (bullet render path)', () => {
    const station = makeStation({ id: 's1', name: 'Hub <A1>' });
    useSelection.setState({ ...useSelection.getState(), hoveredStationId: station.id });
    const lines = {
      L1: makeLine({ id: 'L1', service: 'A1', color: '#abc123' }),
    };
    const { container } = render(
      <svg>
        <StationView station={station} lines={lines} zoom={1} onStartDrag={vi.fn()} layer="label" />
      </svg>,
    );
    expect(container.querySelector('text')?.getAttribute('text-decoration')).toBeNull();
    expect(container.querySelectorAll('line').length).toBeGreaterThanOrEqual(1);
  });

  it('hover saturates at Black (900) when the doc default is already 900', () => {
    useDoc.setState({ ...useDoc.getState(), labelWeight: 900 });
    const station = makeStation({ id: 's1', name: 'Foo' });
    useSelection.setState({ ...useSelection.getState(), hoveredStationId: station.id });
    const { container } = render(
      <svg>
        <StationView station={station} lines={{}} zoom={1} onStartDrag={vi.fn()} layer="label" />
      </svg>,
    );
    const text = container.querySelector('text');
    expect(text?.getAttribute('font-weight')).toBe('900');
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

describe('<StationView /> — dot layer renders at cell-grid positions', () => {
  it('every dot sits at stopPosWorld(cell, station) — no neighbor-aware nudging', () => {
    // Mix of cardinal and diagonal orientations. Each dot's cx/cy is the
    // station anchor + the cell offset rotated by the station rotation.
    // Nothing about a stop's neighbors affects its rendered position.
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
    const lines = {
      L1: makeLine({ id: 'L1', service: 'L1', color: '#0039A6' }),
      L2: makeLine({ id: 'L2', service: 'L2', color: '#EE352E' }),
      L3: makeLine({ id: 'L3', service: 'L3', color: '#00933C' }),
      L4: makeLine({ id: 'L4', service: 'L4', color: '#808080' }),
    };
    const { container } = render(
      <svg>
        <StationView station={station} lines={lines} zoom={1} onStartDrag={vi.fn()} layer="dots" />
      </svg>,
    );

    const readDot = (lineId: string) => {
      const el = container.querySelector(`[data-stop-station="s1"][data-stop-line="${lineId}"]`);
      if (!el) throw new Error(`no dot for ${lineId}`);
      return { cx: parseFloat(el.getAttribute('cx')!), cy: parseFloat(el.getAttribute('cy')!) };
    };

    for (const cell of station.stops) {
      const got = readDot(cell.lineId);
      // Cell-grid world position: rotation 0 station at (0,0) → (col, row) * STOP_SIZE.
      expect(got.cx).toBeCloseTo(cell.col * STOP_SIZE, 5);
      expect(got.cy).toBeCloseTo(cell.row * STOP_SIZE, 5);
    }
  });
});

describe('<StationView /> — transfer-pick hover highlight', () => {
  // closestStopLineId falls back to `station.stops[0].lineId` when there's no
  // `.canvas-host svg` ancestor; these tests rely on that, so the picked
  // lineId is just the first stop on each station.

  function renderBg(station: ReturnType<typeof makeStation>) {
    return render(
      <svg>
        <StationView station={station} lines={{}} zoom={1} onStartDrag={vi.fn()} layer="bg" />
      </svg>,
    );
  }

  it('first pick: pointerMove over a station sets hoveredLineStop', async () => {
    const { fireEvent } = await import('@testing-library/react');
    const station = makeStation({
      id: 's1',
      stops: [makeStop('L1')],
    });
    useSelection.setState({
      ...useSelection.getState(),
      creatingTransfer: true,
      transferAnchor: null,
      hoveredLineStop: null,
    });
    const { container } = renderBg(station);
    const hitRect = container.querySelector('[data-station-id="s1"] rect');
    if (!hitRect) throw new Error('no bg hit-rect');
    fireEvent.pointerMove(hitRect);
    expect(useSelection.getState().hoveredLineStop).toEqual({ stationId: 's1', lineId: 'L1' });
  });

  it('second pick: pointerMove over a different station still sets hoveredLineStop', async () => {
    const { fireEvent } = await import('@testing-library/react');
    const stationB = makeStation({
      id: 's2',
      stops: [makeStop('L2')],
    });
    useSelection.setState({
      ...useSelection.getState(),
      creatingTransfer: true,
      transferAnchor: { stationId: 's1', lineId: 'L1' },
      hoveredLineStop: null,
    });
    const { container } = renderBg(stationB);
    const hitRect = container.querySelector('[data-station-id="s2"] rect');
    if (!hitRect) throw new Error('no bg hit-rect');
    fireEvent.pointerMove(hitRect);
    expect(useSelection.getState().hoveredLineStop).toEqual({ stationId: 's2', lineId: 'L2' });
  });

  it('second pick: pointerMove over the anchor dot itself does NOT highlight (self-transfer guard)', async () => {
    const { fireEvent } = await import('@testing-library/react');
    const station = makeStation({
      id: 's1',
      stops: [makeStop('L1')],
    });
    useSelection.setState({
      ...useSelection.getState(),
      creatingTransfer: true,
      transferAnchor: { stationId: 's1', lineId: 'L1' },
      hoveredLineStop: null,
    });
    const { container } = renderBg(station);
    const hitRect = container.querySelector('[data-station-id="s1"] rect');
    if (!hitRect) throw new Error('no bg hit-rect');
    fireEvent.pointerMove(hitRect);
    expect(useSelection.getState().hoveredLineStop).toBeNull();
  });
});
