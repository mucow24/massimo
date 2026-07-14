import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { HighlightedLineLayer } from './HighlightedLineLayer';
import { makeBandSpec, makeLine, makeStation, makeStop } from '../../test/fixtures';
import type { Line, Station } from '../../model/types';
import type { OrderedRenderable } from '../../geometry/interlining';
import type { UiMode } from '../../state/selection';
import type { AppendCursor } from './appendGestures';

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
    renderables?: OrderedRenderable[];
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
        zoom={1}
        onStartDrag={vi.fn()}
        onRemoveCursorStation={opts.onRemoveCursorStation}
        onRemoveCursorEdge={opts.onRemoveCursorEdge}
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
      renderables: stripeRenderables(),
    });
    expect(container.querySelector('[data-append-cursor]')).toBeNull();
    expect(container.querySelector('[data-append-remove-stop]')).toBeNull();
    expect(container.querySelector('[data-append-remove-segment]')).toBeNull();
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
