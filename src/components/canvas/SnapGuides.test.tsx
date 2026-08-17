import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LABEL_EDGE_INSET_PX, SnapGuides } from './SnapGuides';
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

  // A `quiet` span is an AMBIENT measurement — it rides every frame of a
  // gesture whether or not anything engaged (the guide drag's spacing readout).
  // The full snap chrome on such a span outshouts the thing being dragged: pull
  // a vertical guide out and all you see is the pair of horizontal spans
  // measuring it, which reads as a bug rather than as feedback.
  describe('the quiet register', () => {
    const span = (extra: Partial<SnapGuide> = {}): SnapGuide[] => [
      { from: { x: 0, y: 0 }, to: { x: 0, y: 60 }, label: '60.0', ...extra },
    ];
    const attrs = (guides: SnapGuide[]) => {
      const { container } = render(<SnapGuides guides={guides} zoom={1} />);
      const line = container.querySelector('line[data-snap-guide]')!;
      const text = labelText(container);
      const dash = (line.getAttribute('stroke-dasharray') ?? '').split(' ').map(Number);
      return {
        haloed: container.querySelector('g[filter] line') !== null,
        rings: container.querySelectorAll('circle').length,
        width: Number(line.getAttribute('stroke-width')),
        mark: dash[0],
        gap: dash[1],
        cap: line.getAttribute('stroke-linecap'),
        fontSize: Number(text.getAttribute('font-size')),
        chipHalo: Number(text.getAttribute('stroke-width')),
      };
    };

    it('draws a quieter line and chip than a snap that engaged, with no halo or rings', () => {
      const loud = attrs(span());
      const quiet = attrs(span({ quiet: true }));
      // Guard the guard: the loud register really does carry the chrome the
      // quiet one is being checked for the absence of.
      expect(loud.haloed).toBe(true);
      expect(loud.rings).toBeGreaterThan(0);
      expect(quiet.haloed).toBe(false);
      expect(quiet.rings).toBe(0);
      expect(quiet.width).toBeLessThan(loud.width);
      expect(quiet.fontSize).toBeLessThan(loud.fontSize);
      expect(quiet.chipHalo).toBeLessThan(loud.chipHalo);
      // Still legible: the chip keeps a halo, or the number dies over band art.
      expect(quiet.chipHalo).toBeGreaterThan(0);
    });

    // A tracer running off a stationary guide should read as a measurement
    // being taken, not as a second line drawn on the map.
    it('runs DOTTED where the loud register runs dashed', () => {
      const loud = attrs(span());
      const quiet = attrs(span({ quiet: true }));
      // A dot is a mark shorter than its gap, round-capped so it reads round.
      expect(quiet.mark).toBeLessThan(quiet.gap);
      expect(quiet.cap).toBe('round');
      // A dash is the other way round, and squared off.
      expect(loud.mark).toBeGreaterThan(loud.gap);
      expect(loud.cap).toBe('butt');
    });

    it('leaves a loud span in the same list its full chrome', () => {
      const { container } = render(
        <SnapGuides
          guides={[
            { from: { x: 0, y: 0 }, to: { x: 0, y: 60 }, label: '60.0', quiet: true },
            { from: { x: 0, y: 0 }, to: { x: 90, y: 0 }, label: '90.0' },
          ]}
          zoom={1}
        />,
      );
      // One halo pass and its two endpoint rings — the loud span's, not both.
      expect(container.querySelectorAll('g[filter] line')).toHaveLength(1);
      expect(container.querySelectorAll('circle')).toHaveLength(2);
      const haloed = container.querySelector('g[filter] line')!;
      expect(Number(haloed.getAttribute('x2'))).toBe(90);
    });
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
    expect(text.textContent).toBe('Y 120.0');
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
    expect(text.textContent).toBe('Y₀ 200.0');
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
    expect(text.textContent).toBe('X -340.0');
  });

  // Zoomed in, a guide's parallel neighbour is routinely several viewports
  // away. The label used to ride the midpoint of the WHOLE span, which is then
  // off screen with the far end — the measurement the readout exists to show
  // was invisible exactly when the span was longest.
  describe('a span running off screen', () => {
    // 200 world units across at zoom 1 — a hard-zoomed viewport.
    const box = { vbX: 0, vbY: 0, vbW: 200, vbH: 200 };

    it('keeps the label inside the visible box, on the span', () => {
      // From a point near the middle of the screen out to a neighbour 4000
      // units below: the true midpoint is y ≈ 2050, ten viewports down.
      const guides: SnapGuide[] = [
        { from: { x: 100, y: 100 }, to: { x: 100, y: 4100 }, label: '4000' },
      ];
      const { container } = render(<SnapGuides guides={guides} zoom={1} labelBox={box} />);
      const text = labelText(container);
      const y = Number(text.getAttribute('y')) - capCenterDy(14);
      expect(Number(text.getAttribute('x'))).toBeGreaterThan(box.vbX);
      expect(Number(text.getAttribute('x'))).toBeLessThan(box.vbX + box.vbW);
      expect(y).toBeGreaterThan(box.vbY);
      expect(y).toBeLessThan(box.vbY + box.vbH);
      // Midway along the VISIBLE run (100 → the inset bottom edge), not at 2050.
      expect(y).toBeCloseTo((100 + (200 - LABEL_EDGE_INSET_PX)) / 2, 6);
    });

    it('centres on the visible run when BOTH ends are off screen', () => {
      const guides: SnapGuide[] = [
        { from: { x: -3000, y: 100 }, to: { x: 3000, y: 100 }, label: '6000' },
      ];
      const { container } = render(<SnapGuides guides={guides} zoom={1} labelBox={box} />);
      expect(Number(labelText(container).getAttribute('x'))).toBeCloseTo(100, 6);
    });

    it('still lands on screen when the whole visible run is inside the inset', () => {
      // Grab a guide 10 units from the bottom edge and measure DOWNWARDS: the
      // visible run is y 190..200, entirely within the label inset, so the
      // inset box has nothing to offer and the bare box has to answer.
      const guides: SnapGuide[] = [
        { from: { x: 100, y: 190 }, to: { x: 100, y: 4100 }, label: '3910' },
      ];
      const { container } = render(<SnapGuides guides={guides} zoom={1} labelBox={box} />);
      const y = Number(labelText(container).getAttribute('y')) - capCenterDy(14);
      expect(y).toBeGreaterThan(box.vbY);
      expect(y).toBeLessThan(box.vbY + box.vbH);
      expect(y).toBeCloseTo(195, 6);
    });

    it('leaves a fully-visible span exactly where it always sat', () => {
      const guides: SnapGuide[] = [
        { from: { x: 40, y: 100 }, to: { x: 160, y: 100 }, label: '120' },
      ];
      const { container } = render(<SnapGuides guides={guides} zoom={1} labelBox={box} />);
      // The plain midpoint, untouched by the clip.
      expect(Number(labelText(container).getAttribute('x'))).toBeCloseTo(100, 6);
    });

    // The case above sits clear of the inset on both sides, so it cannot catch
    // a clip that fires on a span it had no business touching. This one ends
    // INSIDE the inset margin (x 10, with the inset at 24) while still being
    // perfectly on screen and perfectly readable where it is: clipping it would
    // trim the near end to x 24 and slide the label from 55 to 62.
    it('does not nudge a span that ends within the inset but is fully on screen', () => {
      const guides: SnapGuide[] = [{ from: { x: 10, y: 50 }, to: { x: 100, y: 50 }, label: '90' }];
      const { container } = render(<SnapGuides guides={guides} zoom={1} labelBox={box} />);
      expect(Number(labelText(container).getAttribute('x'))).toBeCloseTo(55, 6);
    });
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
