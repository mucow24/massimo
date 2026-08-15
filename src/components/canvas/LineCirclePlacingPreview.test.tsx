import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CircleDiameterLabel } from './LineCirclePlacingPreview';

const diameterText = (container: HTMLElement): SVGTextElement =>
  container.querySelector('[data-circle-diameter]') as unknown as SVGTextElement;

describe('<CircleDiameterLabel />', () => {
  // It is the same white-on-accent chip the snap guides paint, shown live while
  // a circle's radius is being chosen or its knob dragged, so it reads in the
  // same format as every other measurement: one decimal, trailing .0 kept.
  it('reads the diameter to one decimal place, whole numbers included', () => {
    const { container } = render(<CircleDiameterLabel cx={0} cy={0} radius={5} zoom={1} />);
    expect(diameterText(container).textContent).toBe('⌀ 10.0');
  });

  it('keeps the fractional half a quarter-gridded radius can land on', () => {
    // snapDraggedLineCircleRadius quantises to LINE_WIDTH_STEP (0.25), so on
    // the ordinary drag the diameter is a multiple of 0.5 — lossless at one
    // decimal.
    const { container } = render(<CircleDiameterLabel cx={0} cy={0} radius={5.25} zoom={1} />);
    expect(diameterText(container).textContent).toBe('⌀ 10.5');
  });

  it('rounds an OFF-grid radius to the shared one-decimal format', () => {
    // Shift declines the quarter-unit grid mid-drag (useLineCircleDrag), so the
    // radius reaching this label can be a raw pointer distance. The readout is
    // then an approximation of what gets stored, not the exact value — pinned
    // here so the label's contract is stated rather than assumed away.
    const { container } = render(<CircleDiameterLabel cx={0} cy={0} radius={5.31} zoom={1} />);
    expect(diameterText(container).textContent).toBe('⌀ 10.6');
  });
});
