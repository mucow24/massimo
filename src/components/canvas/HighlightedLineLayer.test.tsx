import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { HighlightedLineLayer } from './HighlightedLineLayer';
import { makeBandSpec, makeDoc, makeLine, makeStation, makeStop } from '../../test/fixtures';
import { connectStationsOnLine } from '../../model/transforms';
import { stopPosWorld } from '../../geometry/interlining';
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

  it('rings a not-yet-added EMPTY station a click would connect — at its center', () => {
    // Pen on s1, hovering an orphan with NO stops at all → a click connects it,
    // spawning its first stop at the origin (0,0) = the station center, so the
    // ring sits there. (The interchange case — new stop east of existing stops —
    // is the neighbouring test.)
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

  it('rings where the stop will DROP on an interchange station — not the anchor', () => {
    // Pen on s1, hovering s3 — an interchange already carrying ANOTHER line's
    // stop but not L1's. A click connects, and spawnStopCell drops L1's new stop
    // one tangent gap EAST of s3's existing stop, NOT at the station anchor. The
    // preview ring must promise that real landing spot: the old code drew it at
    // the anchor, which on an interchange sits over an unrelated existing stop.
    const withL2 = {
      ...lines(),
      L2: makeLine({ id: 'L2', service: 'B', color: '#0000cc', stations: ['s3'] }),
    };
    const s3 = makeStation({
      id: 's3',
      x: 200,
      y: 0,
      stops: [makeStop('L2', { orientation: 'auto-horizontal' })],
    });
    const withStations = { ...stations(), s3 };
    const { container } = renderLayer(
      withL2,
      withStations,
      appending({ kind: 'station', stationId: 's1' }),
      { appendHover: { kind: 'station', stationId: 's3' } },
    );
    const ring = container.querySelector('[data-append-hover-ring="s3"] circle');
    expect(ring).not.toBeNull();

    // Ground truth: where does the connect gesture ACTUALLY place the stop?
    const doc = makeDoc({
      lines: Object.values(withL2),
      stations: Object.values(withStations),
    });
    const after = connectStationsOnLine(doc, 'L1', 's1', 's3');
    const cell = after.stations.s3.stops.find((c) => c.lineId === 'L1')!;
    const truth = stopPosWorld(cell, after.stations.s3);

    expect(truth.x).not.toBeCloseTo(200); // the stop really moves off the anchor
    expect(Number(ring!.getAttribute('cx'))).toBeCloseTo(truth.x);
    expect(Number(ring!.getAttribute('cy'))).toBeCloseTo(truth.y);
  });

  it('does not ring a non-member when a click there is a dead click (null cursor)', () => {
    const withOrphan = { ...stations(), s3: triStation('s3', 200, 0) };
    const { container } = renderLayer(lines(), withOrphan, appending(null), {
      appendHover: { kind: 'station', stationId: 's3' },
    });
    expect(container.querySelector('[data-append-hover-ring]')).toBeNull();
  });

  it('shows the hover-zone boundary on a hovered member station', () => {
    // The zone boundary is the station's true clickable footprint (cells ∪
    // label rect) — "you are over this station, here is its edge". It rides
    // alongside the ring preview, which separately promises an actionable
    // click.
    const { container } = renderLayer(lines(), stations(), appending(null), {
      appendHover: { kind: 'station', stationId: 's1' },
    });
    expect(container.querySelector('[data-station-hover-zone="s1"]')).not.toBeNull();
  });

  it('shows the hover-zone boundary on a hovered NON-member with the pen armed', () => {
    // With the pen armed, hovering a non-member is a live connect target, so its
    // footprint-edge cue rides alongside the ring. (With NOTHING armed a
    // non-member is click-through and never hovers — see the foreign-station
    // click-through test — so this cue only appears once there's a pen.)
    const withOrphan = { ...stations(), s3: triStation('s3', 200, 0) };
    const { container } = renderLayer(
      lines(),
      withOrphan,
      appending({ kind: 'station', stationId: 's1' }),
      { appendHover: { kind: 'station', stationId: 's3' } },
    );
    expect(container.querySelector('[data-station-hover-zone="s3"]')).not.toBeNull();
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

  it('lifts a hovered FOREIGN line above the dim at half strength, cased, with its dots', () => {
    // Hovering another line lifts the WHOLE line above the dim — the same three-
    // pass (silhouette/body/seam) repaint the edited line gets PLUS its stop dots
    // — at HALF strength, so "click here edits L2 instead" reads as a cased line
    // that stands out without competing with the fully-bright edited line (not
    // the old body-only @0.55 smear that mangled dashes and dropped the dots).
    const twoLines = {
      ...lines(),
      L2: makeLine({
        id: 'L2',
        service: 'B',
        color: '#0000cc',
        stations: ['s3', 's4'],
        // A casing so the silhouette pass has something to paint; a distinct
        // color makes that casing path unambiguous to find.
        strokeWidth: 3,
        strokeColor: '#00ff00',
      }),
    };
    // s3/s4 carry L2 stops so the line's dots have geometry to render.
    const withL2 = {
      ...stations(),
      s3: makeStation({
        id: 's3',
        x: 0,
        y: 100,
        stops: [makeStop('L2', { orientation: 'auto-horizontal' })],
      }),
      s4: makeStation({
        id: 's4',
        x: 100,
        y: 100,
        stops: [makeStop('L2', { orientation: 'auto-horizontal' })],
      }),
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
    const { container } = renderLayer(twoLines, withL2, appending(null), {
      appendHover: { kind: 'line', lineId: 'L2' },
      renderables,
    });
    const group = container.querySelector('[data-append-hover-line="L2"]');
    expect(group).not.toBeNull();
    // Half strength — dimmer than the edited line, brighter than the dim.
    expect(group!.getAttribute('opacity')).toBe('0.5');
    // Cased (silhouette pass paints the casing) — the dashed/cased-line fix.
    expect(group!.querySelector('path[stroke="#00ff00"]')).not.toBeNull();
    // Its two stop dots ride along inside the same group (they used to vanish).
    expect(group!.querySelectorAll('[data-stop-line="L2"]')).toHaveLength(2);
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
