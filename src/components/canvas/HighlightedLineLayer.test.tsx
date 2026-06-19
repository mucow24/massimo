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
  // Forward tangent is +x, so BOTH the interior arrow (at s1, pointing toward s2)
  // and the terminus arrow (at s2, pointing outward in the travel direction)
  // point +x: apex AHEAD of the base on the x axis.
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
  // "M ax ay L lx ly L rx ry Z". Pick those out of all <path>s.
  const trianglePaths = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('path'))
      .map((p) => p.getAttribute('d') ?? '')
      .filter((d) => /^M [-\d.]+ [-\d.]+ L [-\d.]+ [-\d.]+ L [-\d.]+ [-\d.]+ Z$/.test(d));

  it('renders both triangles pointing +x for a left-to-right horizontal line', () => {
    const { container } = renderLayer();
    const ds = trianglePaths(container);
    // The interior arrow at s1 and the terminus arrow at s2 — both present.
    expect(ds).toContain('M 11 0 L 6 3 L 6 -3 Z'); // at s1: apex at x=11 (+x)
    expect(ds).toContain('M 111 0 L 106 3 L 106 -3 Z'); // at s2: apex at x=111 (+x)
  });

  it('every triangle apex sits to the +x side of its base (points along travel)', () => {
    const { container } = renderLayer();
    const ds = trianglePaths(container);
    expect(ds.length).toBeGreaterThanOrEqual(2);
    for (const d of ds) {
      const m = /^M ([-\d.]+) [-\d.]+ L ([-\d.]+) [-\d.]+ L ([-\d.]+)/.exec(d)!;
      const apexX = Number(m[1]);
      const baseX = Number(m[2]); // both base wings share the same x
      expect(apexX).toBeGreaterThan(baseX);
    }
  });
});
