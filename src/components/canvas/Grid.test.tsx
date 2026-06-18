import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Grid } from './Grid';

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
});
