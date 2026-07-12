import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { arrowTrianglePath, HighlightedLineLayer } from './HighlightedLineLayer';
import { makeLine, makeStation, makeStop } from '../../test/fixtures';
import type { Line, Station } from '../../model/types';

describe('arrowTrianglePath', () => {
  it('points along +x with the apex ahead of the base', () => {
    expect(arrowTrianglePath(0, 0, 1, 0, 10, 15, 3)).toBe('M 15 0 L 10 3 L 10 -3 Z');
  });

  it('points along +y (screen-down) with the base wings spread on x', () => {
    expect(arrowTrianglePath(0, 0, 0, 1, 10, 15, 3)).toBe('M 0 15 L -3 10 L 3 10 Z');
  });

  it('flips 180° when base/apex distances are swapped (apex behind the base)', () => {
    const fwd = arrowTrianglePath(0, 0, 1, 0, 10, 15, 3);
    const flipped = arrowTrianglePath(0, 0, 1, 0, 15, 10, 3);
    expect(flipped).toBe('M 10 0 L 15 3 L 15 -3 Z');
    expect(flipped).not.toBe(fwd);
  });

  it('translates with the origin', () => {
    expect(arrowTrianglePath(100, 50, 1, 0, 10, 15, 3)).toBe('M 115 50 L 110 53 L 110 47 Z');
  });
});

describe('<HighlightedLineLayer /> — direction-triangle orientation (E11)', () => {
  // Beyond the pure arrowTrianglePath helper, verify the INTEGRATED orientation
  // math (HighlightedLineLayer.tsx:224-249): for a known horizontal segment the
  // triangles must point the right way. The triangles iterate ln.stations
  // directly (independent of `renderables`), so an empty renderables array still
  // exercises them.
  //
  // Geometry: s1 (0,0) → s2 (100,0), both rotation 0, auto-horizontal stops.
  // dotR = STOP_DOT_RADIUS(4), gap 2, halfW 3, height 5 ⇒ baseDist 6, apexDist 11.
  // The tail s2 is the sole terminus (its arrowhead points +x, outward); the
  // front stop s1 is a plain forward chevron (+x). Both point +x here.
  const seedDoc = () => {
    const lines: Record<string, Line> = {
      L1: makeLine({ id: 'L1', service: 'A', color: '#cc0000', stations: ['s1', 's2'] }),
    };
    const stations: Record<string, Station> = {
      s1: makeStation({
        id: 's1',
        name: 'One',
        x: 0,
        y: 0,
        stops: [makeStop('L1', { orientation: 'auto-horizontal' })],
      }),
      s2: makeStation({
        id: 's2',
        name: 'Two',
        x: 100,
        y: 0,
        stops: [makeStop('L1', { orientation: 'auto-horizontal' })],
      }),
    };
    return { lines, stations };
  };

  const renderLayer = () => {
    const { lines, stations } = seedDoc();
    return render(
      <svg>
        <HighlightedLineLayer
          highlightLineId="L1"
          lines={lines}
          stations={stations}
          renderables={[]}
          underlayColor="#ffffff"
          hoveredInspectorSegment={null}
          uiMode={{ kind: 'idle' }}
          zoom={1}
          onStartDrag={vi.fn()}
          vbX={-50}
          vbY={-50}
          vbW={300}
          vbH={200}
        />
      </svg>,
    );
  };

  // A direction triangle is a closed 3-point path emitted by arrowTrianglePath:
  // "M ax ay L lx ly L rx ry Z". Stripe paths are open (no Z, fill="none"), so
  // this picks only the triangles. Terminus arrowheads are filled with the LINE
  // color; interior chevrons use the contrasting legible color — so line-colored
  // triangles are exactly the termini (genuine degree-1 line ends).
  const triangleEls = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('path')).filter((p) =>
      /^M [-\d.]+ [-\d.]+ L [-\d.]+ [-\d.]+ L [-\d.]+ [-\d.]+ Z$/.test(p.getAttribute('d') ?? ''),
    );
  const terminusDs = (container: HTMLElement) =>
    triangleEls(container)
      .filter((p) => p.getAttribute('fill') === '#cc0000')
      .map((p) => p.getAttribute('d') ?? '');

  const renderWith = (lines: Record<string, Line>, stations: Record<string, Station>) =>
    render(
      <svg>
        <HighlightedLineLayer
          highlightLineId="L1"
          lines={lines}
          stations={stations}
          renderables={[]}
          underlayColor="#ffffff"
          hoveredInspectorSegment={null}
          uiMode={{ kind: 'idle' }}
          zoom={1}
          onStartDrag={vi.fn()}
          vbX={-200}
          vbY={-200}
          vbW={600}
          vbH={600}
        />
      </svg>,
    );
  const triStation = (id: string, x: number, y: number): Station =>
    makeStation({ id, x, y, stops: [makeStop('L1', { orientation: 'auto-horizontal' })] });
  const redLine = (stations: string[], edges?: string[]) => ({
    L1: makeLine({ id: 'L1', service: 'A', color: '#cc0000', stations, edges }),
  });

  it('caps only the display-tail end (append direction), not the front stop', () => {
    const { container } = renderLayer();
    // Tail s2 (x=100) is the sole terminus, arrowhead outward (+x). The front
    // stop s1 gets no arrowhead — it is a plain interior chevron.
    const term = terminusDs(container);
    expect(term.length).toBe(1);
    const apexX = Number(/^M ([-\d.]+)/.exec(term[0])![1]);
    expect(apexX).toBeGreaterThan(100);
  });

  it('draws NO terminus arrowhead on a loop (the tail is degree 2)', () => {
    const { container } = renderWith(redLine(['s1', 's2', 's3'], ['s1|s2', 's2|s3', 's1|s3']), {
      s1: triStation('s1', 0, 0),
      s2: triStation('s2', 100, 0),
      s3: triStation('s3', 50, 90),
    });
    expect(terminusDs(container)).toEqual([]);
  });

  it('a branch caps its last-drawn stop when that tail is a leaf (not a false one)', () => {
    // Trunk s1-J with branches J-s2, J-s3; display tail s3 is a degree-1 leaf.
    const { container } = renderWith(redLine(['s1', 'J', 's2', 's3'], ['J|s1', 'J|s2', 'J|s3']), {
      s1: triStation('s1', -100, 0),
      J: triStation('J', 0, 0),
      s2: triStation('s2', 100, 50),
      s3: triStation('s3', 100, -50),
    });
    // Exactly one arrowhead — at the tail leaf s3, and none at the junction J.
    expect(terminusDs(container).length).toBe(1);
  });
});
