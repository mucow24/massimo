import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SnapGuides } from './SnapGuides';
import type { SnapGuide } from '../../geometry/snap';
import { capCenterDy } from '../../geometry/textMeasure';

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
    // side, i.e. its CENTER sits at y = -9 — the attribute carries the
    // alphabetic-baseline shift on top (see the dominant-baseline spec below).
    expect(Number(text.getAttribute('x'))).toBeCloseTo(5, 6);
    expect(Number(text.getAttribute('y'))).toBeCloseTo(-9 + capCenterDy(14), 6);
  });

  // `dominantBaseline="central"` centers the font's ascent..descent box, which
  // Chrome sources per-platform (usWin on Windows, hhea on macOS) — the readout
  // rendered ~0.09em lower on a Mac. Centered on the alphabetic baseline instead.
  it('centers the measurement readout on the alphabetic baseline, not via dominant-baseline', () => {
    const guides: SnapGuide[] = [{ from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, label: '42' }];
    const { container } = render(<SnapGuides guides={guides} zoom={2} />);
    const text = labelText(container);
    // Zoom-compensated: both the offset and the font size scale by 1/zoom.
    const fontSize = Number(text.getAttribute('font-size'));
    expect(fontSize).toBeCloseTo(7, 6);
    expect(Number(text.getAttribute('y'))).toBeCloseTo(-4.5 + capCenterDy(fontSize), 6);
    expect(text.getAttribute('dominant-baseline')).toBeNull();
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
    // The degenerate guide collapses the perpendicular to 0, so the label
    // centers on the (shared) point.
    expect(x).toBeCloseTo(5, 6);
    expect(y).toBeCloseTo(5 + capCenterDy(14), 6);
  });
});
