import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SnapGuides } from './SnapGuides';
import type { SnapGuide } from '../../geometry/snap';

const labelText = (container: HTMLElement): SVGTextElement =>
  container.querySelector('text') as unknown as SVGTextElement;

describe('<SnapGuides />', () => {
  it('flips a labelled horizontal guide so the label sits above the midpoint (smaller y)', () => {
    // from (0,0) -> to (10,0): the raw perpendicular is py = +1 (points down).
    // The if(py>0) flip negates it so the label ends up on the y<midpoint side.
    const guides: SnapGuide[] = [{ from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, label: '42' }];
    const { container } = render(<SnapGuides guides={guides} zoom={1} />);
    const text = labelText(container);
    expect(text).not.toBeNull();
    expect(text.textContent).toBe('42');
    // Midpoint y is 0; the flipped label is offset by 9/zoom to the smaller-y
    // side, i.e. y = -9.
    expect(Number(text.getAttribute('x'))).toBeCloseTo(5, 6);
    expect(Number(text.getAttribute('y'))).toBeCloseTo(-9, 6);
  });

  // Snap feedback speaks the shared editor accent — not its own teal/subway-
  // yellow palette that clashed with the mode banners and could be pixel-
  // identical to actual NYC-palette line colors.
  it('draws the dashed axis and the measurement label in the theme accent', () => {
    const guides: SnapGuide[] = [{ from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, label: '42' }];
    const { container } = render(<SnapGuides guides={guides} zoom={1} />);
    const dashed = Array.from(container.querySelectorAll('line')).find((l) =>
      l.getAttribute('stroke-dasharray'),
    )!;
    expect(dashed.getAttribute('stroke')).toBe('#1a4ea8');
    const text = labelText(container);
    expect(text.getAttribute('fill')).toBe('#fff');
    expect(text.getAttribute('stroke')).toBe('#1a4ea8');
    // The soft halo pass is accent-derived too (withAlpha), not a one-off blue.
    const halo = container.querySelector('g[filter] line')!;
    expect(halo.getAttribute('stroke')).toBe('rgba(26, 78, 168, 0.3)');
  });

  it('keeps the label coordinates finite for a zero-length guide (from === to)', () => {
    const guides: SnapGuide[] = [{ from: { x: 5, y: 5 }, to: { x: 5, y: 5 }, label: '0' }];
    const { container } = render(<SnapGuides guides={guides} zoom={1} />);
    const text = labelText(container);
    expect(text).not.toBeNull();
    const x = Number(text.getAttribute('x'));
    const y = Number(text.getAttribute('y'));
    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isFinite(y)).toBe(true);
    // The degenerate guide collapses the perpendicular to 0, so the label sits
    // exactly on the (shared) point.
    expect(x).toBeCloseTo(5, 6);
    expect(y).toBeCloseTo(5, 6);
  });
});
