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

  it('never draws an alignment-guide MARKER as a plain segment', () => {
    const guides: SnapGuide[] = [{ from: { x: 5, y: 5 }, to: { x: 5, y: 5 }, alignGuideId: 'gh' }];
    const { container } = render(<SnapGuides guides={guides} zoom={1} />);
    expect(container.querySelectorAll('line')).toHaveLength(0);
    expect(labelText(container)).toBeNull();
  });

  it('renders an ENGAGED guide with the full snap chrome: span, halo, ring at the snap point, coordinate chip', () => {
    const { container } = render(
      <SnapGuides
        guides={[]}
        zoom={1}
        engaged={[{ id: 'gh', orientation: 'horizontal', offset: 120, at: { x: 40, y: 120 } }]}
        vb={{ vbX: -500, vbY: -500, vbW: 1000, vbH: 1000 }}
      />,
    );
    // The dashed accent line spans the whole overdrawn box along the guide.
    const dashed = Array.from(container.querySelectorAll('line')).find((l) =>
      l.getAttribute('stroke-dasharray'),
    )!;
    expect(dashed.getAttribute('stroke')).toBe('#1a4ea8');
    expect(Number(dashed.getAttribute('x1'))).toBe(-500);
    expect(Number(dashed.getAttribute('x2'))).toBe(500);
    expect(Number(dashed.getAttribute('y1'))).toBe(120);
    // A halo pass underneath, like every other snap guide.
    expect(container.querySelector('g[filter] line')).not.toBeNull();
    // The ring marks the snapped reference point.
    const ring = container.querySelector('circle')!;
    expect(Number(ring.getAttribute('cx'))).toBe(40);
    expect(Number(ring.getAttribute('cy'))).toBe(120);
    // The chip names what you snapped TO — the guide's coordinate.
    const text = labelText(container);
    expect(text.textContent).toBe('Y 120');
    expect(Number(text.getAttribute('x'))).toBeCloseTo(40, 6);
  });

  it('renders an engaged diagonal clipped to the box, chip naming its Y₀', () => {
    // The \ at intercept 200 over a box spanning ±500: it enters the box at
    // the left edge (−500, −300) and exits at the bottom (300, 500).
    const { container } = render(
      <SnapGuides
        guides={[]}
        zoom={1}
        engaged={[{ id: 'gd', orientation: 'diagonal-down', offset: 200, at: { x: 40, y: 240 } }]}
        vb={{ vbX: -500, vbY: -500, vbW: 1000, vbH: 1000 }}
      />,
    );
    const dashed = Array.from(container.querySelectorAll('line')).find((l) =>
      l.getAttribute('stroke-dasharray'),
    )!;
    expect(Number(dashed.getAttribute('x1'))).toBe(-500);
    expect(Number(dashed.getAttribute('y1'))).toBe(-300);
    expect(Number(dashed.getAttribute('x2'))).toBe(300);
    expect(Number(dashed.getAttribute('y2'))).toBe(500);
    const text = labelText(container);
    expect(text.textContent).toBe('Y₀ 200');
  });

  it('labels a vertical engaged guide with its X, chip beside the snap point', () => {
    const { container } = render(
      <SnapGuides
        guides={[]}
        zoom={1}
        engaged={[{ id: 'gv', orientation: 'vertical', offset: -340, at: { x: -340, y: 80 } }]}
        vb={{ vbX: -500, vbY: -500, vbW: 1000, vbH: 1000 }}
      />,
    );
    const text = labelText(container);
    expect(text.textContent).toBe('X -340');
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
