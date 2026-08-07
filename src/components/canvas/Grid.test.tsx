import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Grid, gridStep } from './Grid';

// Vertical grid lines run top-to-bottom (x1 === x2); their x is the column.
function verticalLineXs(container: HTMLElement): number[] {
  return [...container.querySelectorAll('line')]
    .filter((l) => l.getAttribute('x1') === l.getAttribute('x2'))
    .map((l) => Number(l.getAttribute('x1')))
    .sort((a, b) => a - b);
}

describe('Grid rendering', () => {
  it('steps columns by gridSize=10 across the viewport', () => {
    const { container } = render(
      <svg>
        <Grid vbX={0} vbY={0} vbW={20} vbH={20} zoom={1} gridSize={10} />
      </svg>,
    );
    expect(verticalLineXs(container)).toEqual([0, 10, 20]);
  });

  it('steps columns by gridSize=5 — twice as dense', () => {
    const { container } = render(
      <svg>
        <Grid vbX={0} vbY={0} vbW={20} vbH={20} zoom={1} gridSize={5} />
      </svg>,
    );
    expect(verticalLineXs(container)).toEqual([0, 5, 10, 15, 20]);
  });

  // A wheel zoom rewrites the viewBox imperatively and does not re-render until
  // it settles, so a world-unit stroke width (1/zoom) is stale for the whole
  // gesture: the hairlines fatten as you zoom in, then SNAP back on commit.
  // non-scaling-stroke hands the width to the browser's CTM instead, so there
  // is nothing left for the commit to correct. (The grid lives inside a
  // data-export-exclude subtree, so this never reaches an SVG/PNG/PDF.)
  it('sizes its hairlines in screen space, identically at any zoom', () => {
    const widths = [1, 4].map((zoom) => {
      const { container } = render(
        <svg>
          <Grid vbX={0} vbY={0} vbW={20} vbH={20} zoom={zoom} gridSize={10} />
        </svg>,
      );
      const line = container.querySelector('line')!;
      return [line.getAttribute('stroke-width'), line.getAttribute('vector-effect')];
    });
    expect(widths[0]).toEqual(['1', 'non-scaling-stroke']);
    expect(widths[1]).toEqual(widths[0]);
  });

  it('coarsens the drawn columns when zoomed out (LOD)', () => {
    // gridSize 10 at zoom 0.4 = 4px on screen → below the 5px floor → the
    // drawn step doubles to 20 world units (8px).
    const { container } = render(
      <svg>
        <Grid vbX={0} vbY={0} vbW={100} vbH={100} zoom={0.4} gridSize={10} />
      </svg>,
    );
    expect(verticalLineXs(container)).toEqual([0, 20, 40, 60, 80, 100]);
  });
});

// Level-of-detail step: designed zoom-1 spacings (5/10/20) pass through
// untouched; zoomed out, the step doubles in powers of two so on-screen
// spacing never drops below 5px. Before this, minimum zoom rendered the
// default grid as a LITERAL SOLID FILL (1px strokes at 1px spacing) built
// from ~9k DOM lines.
describe('gridStep — level of detail', () => {
  it('keeps every designed grid size untouched at zoom 1', () => {
    expect(gridStep(5, 1)).toBe(5);
    expect(gridStep(10, 1)).toBe(10);
    expect(gridStep(20, 1)).toBe(20);
  });

  it('keeps the step while on-screen spacing is at or above the 5px floor', () => {
    expect(gridStep(10, 0.5)).toBe(10); // exactly 5px
    expect(gridStep(20, 0.25)).toBe(20); // exactly 5px
  });

  it('doubles in powers of two below the floor', () => {
    expect(gridStep(10, 0.4)).toBe(20); // 4px → 8px
    expect(gridStep(10, 0.1)).toBe(80); // 1px → 8px
    expect(gridStep(5, 0.1)).toBe(80); // 0.5px → 8px
    expect(gridStep(20, 0.1)).toBe(80); // 2px → 8px
  });

  // Doubling can never rescue a non-positive step or zoom — without the
  // guard these inputs would spin the loop forever and hang the tab.
  // Unreachable through the UI, but a pure exported function must be total.
  it('passes degenerate inputs through instead of looping forever', () => {
    expect(gridStep(0, 1)).toBe(0);
    expect(gridStep(-5, 1)).toBe(-5);
    expect(gridStep(10, 0)).toBe(10);
    expect(gridStep(10, -1)).toBe(10);
    expect(gridStep(Number.NaN, 1)).toBe(Number.NaN);
  });
});
