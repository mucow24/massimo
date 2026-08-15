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
    const { container } = render(<CircleDiameterLabel cx={0} cy={0} radius={5.25} zoom={1} />);
    expect(diameterText(container).textContent).toBe('⌀ 10.5');
  });

  it('shows a finer radius at the same one decimal', () => {
    // One decimal is a DISPLAY precision, not the set of legal radii — a
    // radius carries whatever `cleanFloat` kept, and the Diameter field shows
    // it at one decimal too (step 0.5). Pinned so nobody reads the format as a
    // promise about what is stored ("A field's `step` is not its grid").
    const { container } = render(<CircleDiameterLabel cx={0} cy={0} radius={5.31} zoom={1} />);
    expect(diameterText(container).textContent).toBe('⌀ 10.6');
  });
});
