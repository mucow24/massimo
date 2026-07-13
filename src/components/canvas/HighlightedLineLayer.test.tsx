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

describe('<HighlightedLineLayer /> — no per-stop chevrons or terminus arrowheads', () => {
  // The selected-line "line editor" no longer draws direction arrows: neither
  // the small per-stop chevrons nor the big cased arrowhead that capped the
  // line's end. In idle mode the highlight layer must render NO closed triangle
  // paths at all.
  //
  // A direction triangle was a closed 3-point path from arrowTrianglePath:
  // "M ax ay L lx ly L rx ry Z". Stripe paths are open (no Z), stop dots are
  // circles, so this regex matched only those arrows.
  const triangleEls = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('path')).filter((p) =>
      /^M [-\d.]+ [-\d.]+ L [-\d.]+ [-\d.]+ L [-\d.]+ [-\d.]+ Z$/.test(p.getAttribute('d') ?? ''),
    );

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

  it('draws no arrows on a simple two-stop line', () => {
    const { container } = renderWith(redLine(['s1', 's2']), {
      s1: triStation('s1', 0, 0),
      s2: triStation('s2', 100, 0),
    });
    expect(triangleEls(container)).toEqual([]);
  });

  it('draws no arrows on a branch', () => {
    const { container } = renderWith(redLine(['s1', 'J', 's2', 's3'], ['J|s1', 'J|s2', 'J|s3']), {
      s1: triStation('s1', -100, 0),
      J: triStation('J', 0, 0),
      s2: triStation('s2', 100, 50),
      s3: triStation('s3', 100, -50),
    });
    expect(triangleEls(container)).toEqual([]);
  });
});
