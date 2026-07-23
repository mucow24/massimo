import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { HighlightedLineLayer } from './HighlightedLineLayer';
import { makeBandSpec, makeLine, makeStation, makeStop } from '../../test/fixtures';
import type { Line, Station } from '../../model/types';
import type { OrderedRenderable } from '../../geometry/interlining';
import type { UiMode } from '../../state/selection';
import type { AppendCursor, AppendHover } from '../../model/appendGestures';

const triStation = (id: string, x: number, y: number): Station =>
  makeStation({ id, x, y, stops: [makeStop('L1', { orientation: 'auto-horizontal' })] });
const redLine = (stations: string[], edges?: string[]) => ({
  L1: makeLine({ id: 'L1', service: 'A', color: '#cc0000', stations, edges }),
});

const renderLayer = (
  lines: Record<string, Line>,
  stations: Record<string, Station>,
  uiMode: UiMode = { kind: 'idle' },
  opts: {
    onRemoveCursorStation?: (sid: string) => void;
    onRemoveCursorEdge?: (from: string, to: string) => void;
    onCycleCursorEdgeStyle?: (from: string, to: string) => void;
    renderables?: OrderedRenderable[];
    appendHover?: AppendHover;
  } = {},
) =>
  render(
    <svg>
      <HighlightedLineLayer
        highlightLineId="L1"
        lines={lines}
        stations={stations}
        renderables={opts.renderables ?? []}
        underlayColor="#ffffff"
        seamEdges="both"
        uiMode={uiMode}
        appendHover={opts.appendHover}
        zoom={1}
        onStartDrag={vi.fn()}
        onRemoveCursorStation={opts.onRemoveCursorStation}
        onRemoveCursorEdge={opts.onRemoveCursorEdge}
        onCycleCursorEdgeStyle={opts.onCycleCursorEdgeStyle}
        vbX={-200}
        vbY={-200}
        vbW={600}
        vbH={600}
      />
    </svg>,
  );

describe('<HighlightedLineLayer /> — no per-stop chevrons or terminus arrowheads', () => {
  // The selected-line highlight draws no direction arrows: neither the small
  // per-stop chevrons nor the big cased arrowhead that capped the line's end.
  // A direction triangle was a closed 3-point path ("M … L … L … Z"); stripe
  // paths are open (no Z) and stop dots are circles, so this regex matches
  // only those arrows.
  const triangleEls = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('path')).filter((p) =>
      /^M [-\d.]+ [-\d.]+ L [-\d.]+ [-\d.]+ L [-\d.]+ [-\d.]+ Z$/.test(p.getAttribute('d') ?? ''),
    );

  it('draws no arrows on a simple two-stop line', () => {
    const { container } = renderLayer(redLine(['s1', 's2']), {
      s1: triStation('s1', 0, 0),
      s2: triStation('s2', 100, 0),
    });
    expect(triangleEls(container)).toEqual([]);
  });

  it('draws no arrows on a branch', () => {
    const { container } = renderLayer(redLine(['s1', 'J', 's2', 's3'], ['J|s1', 'J|s2', 'J|s3']), {
      s1: triStation('s1', -100, 0),
      J: triStation('J', 0, 0),
      s2: triStation('s2', 100, 50),
      s3: triStation('s3', 100, -50),
    });
    expect(triangleEls(container)).toEqual([]);
  });
});

describe('<HighlightedLineLayer /> — Edit Stops cursor chrome', () => {
  const lines = () => redLine(['s1', 's2']);
  const stations = () => ({ s1: triStation('s1', 0, 0), s2: triStation('s2', 100, 0) });
  const appending = (cursor: AppendCursor): UiMode => ({
    kind: 'appending-to-line',
    lineId: 'L1',
    cursor,
  });
  // One stripe renderable in the s1–s2 corridor, so the armed-segment halo
  // and its × chip have real band geometry to anchor to.
  const stripeRenderables = (): OrderedRenderable[] => [
    { kind: 'stripe', band: makeBandSpec(['L1']), stripeIndex: 0, priority: 0 },
  ];

  it('renders no cursor chrome while nothing is armed', () => {
    const { container } = renderLayer(lines(), stations(), appending(null), {
      onRemoveCursorStation: vi.fn(),
      onRemoveCursorEdge: vi.fn(),
      onCycleCursorEdgeStyle: vi.fn(),
      renderables: stripeRenderables(),
    });
    expect(container.querySelector('[data-append-cursor]')).toBeNull();
    expect(container.querySelector('[data-append-remove-stop]')).toBeNull();
    expect(container.querySelector('[data-append-remove-segment]')).toBeNull();
    expect(container.querySelector('[data-append-cycle-segment-style]')).toBeNull();
    expect(container.querySelector('[data-armed-segment]')).toBeNull();
  });

  it('a station cursor gets the ring and the clickable × chip', () => {
    const onRemove = vi.fn();
    const { container } = renderLayer(
      lines(),
      stations(),
      appending({ kind: 'station', stationId: 's1' }),
      { onRemoveCursorStation: onRemove },
    );
    expect(container.querySelector('[data-append-cursor="s1"]')).not.toBeNull();
    const chip = container.querySelector('[data-append-remove-stop="s1"]');
    expect(chip).not.toBeNull();
    fireEvent.click(chip!);
    expect(onRemove).toHaveBeenCalledWith('s1');
  });

  it('an edge cursor gets the segment halo and its clickable × chip', () => {
    const onRemoveEdge = vi.fn();
    const { container } = renderLayer(
      lines(),
      stations(),
      appending({ kind: 'edge', from: 's2', to: 's1' }),
      { onRemoveCursorEdge: onRemoveEdge, renderables: stripeRenderables() },
    );
    const armed = container.querySelector('[data-armed-segment="s1|s2"]');
    expect(armed).not.toBeNull();
    // The halo: black-edge / white-core strokes under the repainted body.
    expect(armed!.querySelector('path[stroke="#000"]')).not.toBeNull();
    expect(armed!.querySelector('path[stroke="#fff"]')).not.toBeNull();
    expect(container.querySelector('[data-append-cursor]')).toBeNull();

    const chip = container.querySelector('[data-append-remove-segment="s1|s2"]');
    expect(chip).not.toBeNull();
    fireEvent.click(chip!);
    expect(onRemoveEdge).toHaveBeenCalledWith('s2', 's1'); // the cursor's order
  });

  it('an edge cursor gets a clickable style-cycle chip beside the × chip', () => {
    const onCycle = vi.fn();
    const { container } = renderLayer(
      lines(),
      stations(),
      appending({ kind: 'edge', from: 's2', to: 's1' }),
      { onCycleCursorEdgeStyle: onCycle, renderables: stripeRenderables() },
    );
    const chip = container.querySelector('[data-append-cycle-segment-style="s1|s2"]');
    expect(chip).not.toBeNull();
    fireEvent.click(chip!);
    expect(onCycle).toHaveBeenCalledWith('s2', 's1'); // the cursor's order
  });

  it('every chip carries an invisible hit pad wider than its painted disc', () => {
    // The glyph disc is 8px radius over live targets; the transparent 14px pad
    // makes a near-miss land on the chip instead of mutating the line beneath.
    const { container } = renderLayer(
      lines(),
      stations(),
      appending({ kind: 'edge', from: 's2', to: 's1' }),
      {
        onRemoveCursorEdge: vi.fn(),
        onCycleCursorEdgeStyle: vi.fn(),
        renderables: stripeRenderables(),
      },
    );
    for (const chip of [
      container.querySelector('[data-append-remove-segment="s1|s2"]'),
      container.querySelector('[data-append-cycle-segment-style="s1|s2"]'),
    ]) {
      const pad = chip!.querySelector('[data-chip-hit-pad]');
      expect(pad).not.toBeNull();
      expect(Number(pad!.getAttribute('r'))).toBeGreaterThan(8);
    }
  });

  it('a station cursor gets no style-cycle chip (style is a segment property)', () => {
    const { container } = renderLayer(
      lines(),
      stations(),
      appending({ kind: 'station', stationId: 's1' }),
      { onRemoveCursorStation: vi.fn(), onCycleCursorEdgeStyle: vi.fn() },
    );
    expect(container.querySelector('[data-append-cycle-segment-style]')).toBeNull();
  });

  it('a stale cursor renders no chrome (undo can strip it out from under the mode)', () => {
    const { container } = renderLayer(
      lines(),
      stations(),
      appending({ kind: 'station', stationId: 'gone' }),
      { onRemoveCursorStation: vi.fn(), onRemoveCursorEdge: vi.fn() },
    );
    expect(container.querySelector('[data-append-cursor]')).toBeNull();
    expect(container.querySelector('[data-append-remove-stop]')).toBeNull();
  });
});

describe('<HighlightedLineLayer /> — Edit Stops hover preview', () => {
  const lines = () => redLine(['s1', 's2']);
  const stations = () => ({ s1: triStation('s1', 0, 0), s2: triStation('s2', 100, 0) });
  const appending = (cursor: AppendCursor): UiMode => ({
    kind: 'appending-to-line',
    lineId: 'L1',
    cursor,
  });
  const stripeRenderables = (): OrderedRenderable[] => [
    { kind: 'stripe', band: makeBandSpec(['L1']), stripeIndex: 0, priority: 0 },
  ];

  it('rings the hovered station a click would act on', () => {
    // Pen on s1, hovering s2 → a click connects, so s2 previews its ring.
    const { container } = renderLayer(
      lines(),
      stations(),
      appending({ kind: 'station', stationId: 's1' }),
      {
        appendHover: { kind: 'station', stationId: 's2' },
      },
    );
    expect(container.querySelector('[data-append-hover-ring="s2"]')).not.toBeNull();
  });

  it('does not ring the armed station cursor itself (already fully ringed)', () => {
    const { container } = renderLayer(
      lines(),
      stations(),
      appending({ kind: 'station', stationId: 's1' }),
      {
        appendHover: { kind: 'station', stationId: 's1' },
      },
    );
    expect(container.querySelector('[data-append-hover-ring]')).toBeNull();
    expect(container.querySelector('[data-append-cursor="s1"]')).not.toBeNull();
  });

  it('rings a not-yet-added station (no stop cell) a click would connect — at its anchor', () => {
    // Pen on s1, hovering an orphan with no L1 stop → a click connects it, so it
    // previews a ring positioned at the station anchor (the stop-cell branch has
    // nothing to read).
    const orphan = { ...stations(), s3: makeStation({ id: 's3', x: 200, y: 0, stops: [] }) };
    const { container } = renderLayer(
      lines(),
      orphan,
      appending({ kind: 'station', stationId: 's1' }),
      {
        appendHover: { kind: 'station', stationId: 's3' },
      },
    );
    const ring = container.querySelector('[data-append-hover-ring="s3"]');
    expect(ring).not.toBeNull();
    expect(ring!.querySelector('circle')!.getAttribute('cx')).toBe('200');
  });

  it('does not ring a non-member when a click there is a dead click (null cursor)', () => {
    const withOrphan = { ...stations(), s3: triStation('s3', 200, 0) };
    const { container } = renderLayer(lines(), withOrphan, appending(null), {
      appendHover: { kind: 'station', stationId: 's3' },
    });
    expect(container.querySelector('[data-append-hover-ring]')).toBeNull();
  });

  it('shows the dashed hover-zone boundary on a hovered member station', () => {
    // The zone boundary is the station's true clickable footprint (cells ∪
    // label rect) — "you are over this station, here is its edge". It rides
    // alongside the ring preview, which separately promises an actionable
    // click.
    const { container } = renderLayer(lines(), stations(), appending(null), {
      appendHover: { kind: 'station', stationId: 's1' },
    });
    expect(container.querySelector('[data-station-hover-zone="s1"]')).not.toBeNull();
  });

  it('shows the hover-zone boundary on a NON-member too, even when the click is dead', () => {
    // A non-member with nothing armed gets no ring (the click does nothing) —
    // but the zone cue still acknowledges the station under the pointer.
    const withOrphan = { ...stations(), s3: triStation('s3', 200, 0) };
    const { container } = renderLayer(lines(), withOrphan, appending(null), {
      appendHover: { kind: 'station', stationId: 's3' },
    });
    expect(container.querySelector('[data-station-hover-zone="s3"]')).not.toBeNull();
    expect(container.querySelector('[data-append-hover-ring]')).toBeNull();
  });

  it('no hover-zone boundary outside Edit Stops', () => {
    const { container } = renderLayer(
      lines(),
      stations(),
      { kind: 'idle' },
      {
        appendHover: { kind: 'station', stationId: 's1' },
      },
    );
    expect(container.querySelector('[data-station-hover-zone]')).toBeNull();
  });

  it('gently repaints a hovered FOREIGN line above the dim (clicking switches to it)', () => {
    // Hovering another line's stripe marks the whole line, so "click here
    // edits L2 instead" is visible before the click. Its stripes repaint
    // (decorative, partial opacity) inside a data-append-hover-line group.
    const twoLines = {
      ...lines(),
      L2: makeLine({ id: 'L2', service: 'B', color: '#0000cc', stations: ['s3', 's4'] }),
    };
    const renderables: OrderedRenderable[] = [
      { kind: 'stripe', band: makeBandSpec(['L1']), stripeIndex: 0, priority: 0 },
      {
        kind: 'stripe',
        band: makeBandSpec(['L2'], { pairKey: 's3|s4', fromId: 's3', toId: 's4' }),
        stripeIndex: 0,
        priority: 1,
      },
    ];
    const { container } = renderLayer(twoLines, stations(), appending(null), {
      appendHover: { kind: 'line', lineId: 'L2' },
      renderables,
    });
    const group = container.querySelector('[data-append-hover-line="L2"]');
    expect(group).not.toBeNull();
    expect(group!.querySelector('path')).not.toBeNull();
  });

  it('no foreign-line preview outside Edit Stops', () => {
    const twoLines = {
      ...lines(),
      L2: makeLine({ id: 'L2', service: 'B', color: '#0000cc', stations: ['s3', 's4'] }),
    };
    const renderables: OrderedRenderable[] = [
      {
        kind: 'stripe',
        band: makeBandSpec(['L2'], { pairKey: 's3|s4', fromId: 's3', toId: 's4' }),
        stripeIndex: 0,
        priority: 0,
      },
    ];
    const { container } = renderLayer(
      twoLines,
      stations(),
      { kind: 'idle' },
      {
        appendHover: { kind: 'line', lineId: 'L2' },
        renderables,
      },
    );
    expect(container.querySelector('[data-append-hover-line]')).toBeNull();
  });

  it('halos the hovered segment a click would arm', () => {
    const { container } = renderLayer(lines(), stations(), appending(null), {
      appendHover: { kind: 'segment', pairKey: 's1|s2' },
      renderables: stripeRenderables(),
    });
    const halo = container.querySelector('[data-append-hover-segment="s1|s2"]');
    expect(halo).not.toBeNull();
    // The same two-tone (black-edge / white-core) stroke pair as the armed halo.
    expect(halo!.querySelector('path[stroke="#000"]')).not.toBeNull();
    expect(halo!.querySelector('path[stroke="#fff"]')).not.toBeNull();
  });

  it('does not halo the already-armed edge (it wears the full halo)', () => {
    const { container } = renderLayer(
      lines(),
      stations(),
      appending({ kind: 'edge', from: 's1', to: 's2' }),
      { appendHover: { kind: 'segment', pairKey: 's1|s2' }, renderables: stripeRenderables() },
    );
    expect(container.querySelector('[data-append-hover-segment]')).toBeNull();
    expect(container.querySelector('[data-armed-segment="s1|s2"]')).not.toBeNull();
  });

  it('renders no preview when nothing is hovered', () => {
    const { container } = renderLayer(lines(), stations(), appending(null), {
      renderables: stripeRenderables(),
    });
    expect(container.querySelector('[data-append-hover-ring]')).toBeNull();
    expect(container.querySelector('[data-append-hover-segment]')).toBeNull();
  });
});
