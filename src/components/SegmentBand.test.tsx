import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { BandWarning, SegmentBand } from './SegmentBand';
import { hatchPatternId } from './HatchPatterns';
import type { SegmentBandSpec } from '../geometry/interlining';
import type { Line, LineId, SeamEdges } from '../model/types';
import { makeBandSpec, makeLine } from '../test/fixtures';

type StripeStyle = 'solid' | 'dashed' | 'hatched' | 'dotted' | 'dashed-open';

// Presentation-free band over the canonical station pair s1|s2. The spec
// carries only line ids; color + per-segment style are resolved at render
// from the live `lines` map (mirrors how MapCanvas drives the real render).
const baseSpec = (lineIds: LineId[]): SegmentBandSpec => makeBandSpec(lineIds);

// Live lines map: a per-stripe style becomes a segmentStyles override on the
// band's pairKey, exactly as the doc stores it. Solid carries no override.
const linesFor = (styles: StripeStyle[], color = '#EF374B'): Record<LineId, Line> => {
  const out: Record<LineId, Line> = {};
  styles.forEach((style, i) => {
    const id = `L${i + 1}`;
    out[id] = makeLine({
      id,
      color,
      stations: ['s1', 's2'],
      segmentStyles: style === 'solid' ? undefined : { 's1|s2': style },
    });
  });
  return out;
};

const renderStripe = (
  styles: StripeStyle[],
  stripeIndex: number,
  opts: { color?: string; underlayColor?: string } = {},
) => {
  const color = opts.color ?? '#EF374B';
  const ids = styles.map((_, i) => `L${i + 1}`);
  return render(
    <svg>
      <SegmentBand
        spec={baseSpec(ids)}
        stripeIndex={stripeIndex}
        pass="body"
        lines={linesFor(styles, color)}
        underlayColor={opts.underlayColor}
      />
    </svg>,
  );
};

describe('<SegmentBand> — single-stripe renderer', () => {
  it('renders a solid stroke for solid stripes', () => {
    const { container } = renderStripe(['solid'], 0);
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(1);
    expect(paths[0].getAttribute('stroke')).toBe('#EF374B');
    expect(paths[0].getAttribute('stroke-dasharray')).toBeNull();
  });

  it('renders a white underlay + dashed foreground for dashed stripes', () => {
    const { container } = renderStripe(['dashed'], 0);
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(2);
    const [underlay, foreground] = paths;
    expect(underlay.getAttribute('stroke')).toBe('#fff');
    expect(underlay.getAttribute('stroke-dasharray')).toBeNull();
    expect(foreground.getAttribute('stroke')).toBe('#EF374B');
    expect(foreground.getAttribute('stroke-dasharray')).toBeTruthy();
  });

  it('uses the hatch pattern url for hatched stripes (no underlay)', () => {
    const { container } = renderStripe(['hatched'], 0);
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(1);
    expect(paths[0].getAttribute('stroke')).toBe(`url(#${hatchPatternId('#EF374B')})`);
    expect(paths[0].getAttribute('stroke-dasharray')).toBeNull();
  });

  it('renders dotted stripes as one round-capped zero-dash path with NO underlay', () => {
    const { container } = renderStripe(['dotted'], 0);
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(1); // transparent gaps — no underlay path
    expect(paths[0].getAttribute('stroke')).toBe('#EF374B');
    expect(paths[0].getAttribute('stroke-linecap')).toBe('round');
    expect(paths[0].getAttribute('stroke-dasharray')).toMatch(/^0 /);
  });

  it('renders dashed-open stripes as one butt-capped dashed path with NO underlay', () => {
    const { container } = renderStripe(['dashed-open'], 0);
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(1); // transparent gaps — no underlay path
    expect(paths[0].getAttribute('stroke')).toBe('#EF374B');
    expect(paths[0].getAttribute('stroke-linecap')).toBe('butt');
    expect(paths[0].getAttribute('stroke-dasharray')).toBeTruthy();
  });

  it('selects the requested stripe out of a multi-stripe band', () => {
    const styles: StripeStyle[] = ['solid', 'dashed', 'hatched'];
    // stripeIndex 1 → dashed → 2 paths (underlay + foreground).
    const { container } = renderStripe(styles, 1);
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(2);
    expect(paths[1].getAttribute('stroke-dasharray')).toBeTruthy();
    // stripeIndex 2 → hatched → single path with the hatch pattern url.
    const hatched = renderStripe(styles, 2).container.querySelectorAll('path');
    expect(hatched.length).toBe(1);
    expect(hatched[0].getAttribute('stroke')).toBe(`url(#${hatchPatternId('#EF374B')})`);
  });

  it('resolves color live from the lines map — a color edit repaints without a new spec', () => {
    // Regression: presentation is NOT baked into the spec, so re-rendering
    // with a changed `lines` map (same spec reference) updates the stripe.
    // This is the unit-level guard for the "color change needs reload" bug.
    const spec = baseSpec(['L1']);
    const stroke = () => document.querySelector('path')?.getAttribute('stroke');
    const { rerender } = render(
      <svg>
        <SegmentBand
          spec={spec}
          stripeIndex={0}
          pass="body"
          lines={linesFor(['solid'], '#EF374B')}
        />
      </svg>,
    );
    expect(stroke()).toBe('#EF374B');
    rerender(
      <svg>
        <SegmentBand
          spec={spec}
          stripeIndex={0}
          pass="body"
          lines={linesFor(['solid'], '#00AA55')}
        />
      </svg>,
    );
    expect(stroke()).toBe('#00AA55');
  });

  it('resolves per-segment style live — a style edit repaints without a new spec', () => {
    const spec = baseSpec(['L1']);
    const { container, rerender } = render(
      <svg>
        <SegmentBand spec={spec} stripeIndex={0} pass="body" lines={linesFor(['solid'])} />
      </svg>,
    );
    // Solid: one path, no dasharray.
    expect(container.querySelectorAll('path').length).toBe(1);
    rerender(
      <svg>
        <SegmentBand spec={spec} stripeIndex={0} pass="body" lines={linesFor(['hatched'])} />
      </svg>,
    );
    // Hatched: still one path, now the hatch pattern url.
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(1);
    expect(paths[0].getAttribute('stroke')).toBe(`url(#${hatchPatternId('#EF374B')})`);
  });

  it('paints the dashed underlay in the supplied underlayColor (dark mode)', () => {
    const { container } = renderStripe(['dashed'], 0, { underlayColor: '#000000' });
    const [underlay] = container.querySelectorAll('path');
    expect(underlay.getAttribute('stroke')).toBe('#000000');
  });

  it('strokes each stripe of a mixed-width band at its own width (underlay included)', () => {
    const spec = makeBandSpec(['L1', 'L2'], { stripeWidths: [14, 28] });
    const lines = linesFor(['solid', 'dashed']);
    const narrow = render(
      <svg>
        <SegmentBand spec={spec} stripeIndex={0} pass="body" lines={lines} />
      </svg>,
    );
    expect(narrow.container.querySelector('path')!.getAttribute('stroke-width')).toBe('14');
    const wide = render(
      <svg>
        <SegmentBand spec={spec} stripeIndex={1} pass="body" lines={lines} />
      </svg>,
    );
    const paths = wide.container.querySelectorAll('path');
    expect(paths).toHaveLength(2); // dashed → underlay + foreground
    expect(paths[0].getAttribute('stroke-width')).toBe('28');
    expect(paths[1].getAttribute('stroke-width')).toBe('28');
  });
});

describe('<SegmentBand> — casing (silhouette + inset body)', () => {
  const strokedLines = (
    strokeWidth: number,
    strokeColor?: string,
    style?: StripeStyle,
  ): Record<LineId, Line> => ({
    L1: makeLine({
      id: 'L1',
      stations: ['s1', 's2'],
      ...(strokeWidth > 0 ? { strokeWidth } : {}),
      ...(strokeColor ? { strokeColor } : {}),
      ...(style && style !== 'solid' ? { segmentStyles: { 's1|s2': style } } : {}),
    }),
  });

  // Render both passes in paint order — silhouette (the casing renderable, at
  // priority + ε) BEHIND the body — mirroring MapCanvas.
  const renderCased = (lines: Record<LineId, Line>, spec = baseSpec(['L1']), idx = 0) =>
    render(
      <svg>
        <SegmentBand spec={spec} stripeIndex={idx} pass="silhouette" lines={lines} />
        <SegmentBand spec={spec} stripeIndex={idx} pass="body" lines={lines} />
      </svg>,
    );

  // First M-coordinate pair of a path's d — for a straight horizontal band
  // this is the stroke's y position.
  const startY = (p: Element) => Number(p.getAttribute('d')!.match(/M [\d.-]+ ([\d.-]+)/)![1]);

  it('paints one casing silhouette BEHIND the inset body', () => {
    const { container } = renderCased(strokedLines(4, '#ff0000'));
    const paths = Array.from(container.querySelectorAll('path'));
    expect(paths.length).toBe(2); // silhouette + inset body
    const [sil, body] = paths;
    // Silhouette first in DOM = painted first = behind the body.
    expect(sil.hasAttribute('data-band-casing')).toBe(true);
    expect(sil.getAttribute('data-line-id')).toBe('L1');
    expect(sil.getAttribute('stroke')).toBe('#ff0000');
    expect(sil.getAttribute('stroke-width')).toBe('18'); // width 14 + railW 4
    expect(sil.getAttribute('stroke-dasharray')).toBeNull();
    expect(sil.getAttribute('pointer-events')).toBe('none');
    // Body is the colored core, inset by railW so the silhouette shows a railW
    // rim on each edge.
    expect(body.hasAttribute('data-band-stripe')).toBe(true);
    expect(body.getAttribute('stroke-width')).toBe('10'); // width 14 − railW 4
  });

  it('defaults the casing color to white', () => {
    const { container } = renderCased(strokedLines(4));
    expect(container.querySelector('[data-band-casing]')!.getAttribute('stroke')).toBe('#ffffff');
  });

  it('sizes silhouette/inset against the stripe’s own width in a mixed-width band', () => {
    // Stripe 1 (width 28) with stroke 3 ⇒ silhouette 28 + 3 = 31, inset 28 − 3 = 25.
    const spec = makeBandSpec(['L1', 'L2'], { stripeWidths: [14, 28] });
    const lines: Record<LineId, Line> = {
      L1: makeLine({ id: 'L1', stations: ['s1', 's2'] }),
      L2: makeLine({ id: 'L2', stations: ['s1', 's2'], strokeWidth: 3 }),
    };
    const { container } = renderCased(lines, spec, 1);
    expect(container.querySelector('[data-band-casing]')!.getAttribute('stroke-width')).toBe('31');
    expect(container.querySelector('[data-band-stripe]')!.getAttribute('stroke-width')).toBe('25');
  });

  it('clamps the casing at the stripe width (railW ≤ width)', () => {
    // Stored stroke 30 on a 14-wide stripe: railW clamps to 14, so the
    // silhouette is 14 + 14 = 28 and the inset body collapses to 0.
    const { container } = renderCased(strokedLines(30));
    expect(container.querySelector('[data-band-casing]')!.getAttribute('stroke-width')).toBe('28');
    expect(container.querySelector('[data-band-stripe]')!.getAttribute('stroke-width')).toBe('0');
  });

  it('renders no casing for a stroke-less line', () => {
    const { container } = renderCased(strokedLines(0));
    expect(container.querySelector('[data-band-casing]')).toBeNull();
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(1); // body only, full width
    expect(paths[0].getAttribute('stroke-width')).toBe('14');
  });

  it('a dashed (opaque) body: solid silhouette + inset underlay/dashes, no rails', () => {
    const { container } = renderCased(strokedLines(2, undefined, 'dashed'));
    const paths = Array.from(container.querySelectorAll('path'));
    expect(paths.length).toBe(3); // silhouette + underlay + dashes (no rails)
    const sil = container.querySelector('[data-band-casing]')!;
    expect(sil.getAttribute('stroke-dasharray')).toBeNull(); // casing stays solid
    expect(sil.getAttribute('stroke-width')).toBe('16'); // 14 + 2
    expect(container.querySelectorAll('[data-band-casing]').length).toBe(1); // just the silhouette
  });

  it('an OPEN style keeps inline centered rails and emits NO silhouette', () => {
    // dashed-open has transparent gaps a solid silhouette would fill white, so
    // it keeps the two centered rails (painted in the body pass) instead.
    const { container } = renderCased(strokedLines(2, undefined, 'dashed-open'));
    const casings = Array.from(container.querySelectorAll('[data-band-casing]'));
    expect(casings.length).toBe(2); // two rails
    for (const rail of casings) expect(rail.getAttribute('stroke-width')).toBe('2');
    // Rail centers at ±14/2 = ±7 — the full-width body's edges (no inset).
    expect(casings.map(startY).sort((a, b) => a - b)).toEqual([-7, 7]);
  });

  it('resolves the casing live from the lines map — an edit repaints without a new spec', () => {
    const spec = baseSpec(['L1']);
    const { container, rerender } = render(
      <svg>
        <SegmentBand
          spec={spec}
          stripeIndex={0}
          pass="silhouette"
          lines={strokedLines(4, '#ff0000')}
        />
      </svg>,
    );
    const sil = () => container.querySelector('[data-band-casing]')!;
    expect(sil().getAttribute('stroke')).toBe('#ff0000');
    expect(sil().getAttribute('stroke-width')).toBe('18');
    rerender(
      <svg>
        <SegmentBand
          spec={spec}
          stripeIndex={0}
          pass="silhouette"
          lines={strokedLines(1.5, '#00aa55')}
        />
      </svg>,
    );
    expect(sil().getAttribute('stroke')).toBe('#00aa55');
    expect(sil().getAttribute('stroke-width')).toBe('15.5'); // 14 + 1.5
  });
});

describe('<SegmentBand> — branch seam (pass="seam")', () => {
  const seamLines = (
    seamColor: string | undefined,
    opts: { strokeWidth?: number; seamWidth?: number } = {},
  ): Record<LineId, Line> => {
    const strokeWidth = opts.strokeWidth ?? 4;
    return {
      L1: makeLine({
        id: 'L1',
        stations: ['s1', 's2'],
        ...(strokeWidth > 0 ? { strokeWidth } : {}),
        ...(seamColor ? { seamColor } : {}),
        ...(opts.seamWidth !== undefined ? { seamWidth: opts.seamWidth } : {}),
      }),
    };
  };

  const renderSeam = (lines: Record<LineId, Line>) =>
    render(
      <svg>
        <SegmentBand spec={baseSpec(['L1'])} stripeIndex={0} pass="seam" lines={lines} />
      </svg>,
    );

  const startY = (p: Element) => Number(p.getAttribute('d')!.match(/M [\d.-]+ ([\d.-]+)/)![1]);

  it('paints two clipped seam strokes CENTERED on the body edges, in the seam color', () => {
    const { container } = renderSeam(seamLines('#ff000080'));
    const rings = Array.from(container.querySelectorAll('[data-band-seam]'));
    expect(rings.length).toBe(2);
    for (const r of rings) {
      expect(r.getAttribute('stroke')).toBe('#ff000080'); // alpha preserved
      expect(r.getAttribute('stroke-width')).toBe('4'); // unset seam width inherits railW = 4
      expect(r.getAttribute('data-line-id')).toBe('L1');
    }
    // Centered ON the body edges (±width/2 = ±7) — aligned with the casing.
    expect(rings.map(startY).sort((a, b) => a - b)).toEqual([-7, 7]);
    // Clipped to the line's OTHER band corridors (per-band, excluding this band).
    const g = container.querySelector('g[clip-path]')!;
    expect(g.getAttribute('clip-path')).toBe('url(#seam-clip-L1__s1-s2-L1)');
  });

  it('uses an explicit seam width, independent of the casing width', () => {
    const { container } = renderSeam(seamLines('#ff000080', { strokeWidth: 4, seamWidth: 2 }));
    const rings = Array.from(container.querySelectorAll('[data-band-seam]'));
    expect(rings.length).toBe(2);
    for (const r of rings) expect(r.getAttribute('stroke-width')).toBe('2');
  });

  it('shows a seam at its own width even when the line has no casing', () => {
    const { container } = renderSeam(seamLines('#ff000080', { strokeWidth: 0, seamWidth: 3 }));
    const rings = Array.from(container.querySelectorAll('[data-band-seam]'));
    expect(rings.length).toBe(2);
    for (const r of rings) expect(r.getAttribute('stroke-width')).toBe('3');
  });

  it('renders nothing without a seam color', () => {
    const { container } = renderSeam(seamLines(undefined));
    expect(container.querySelector('[data-band-seam]')).toBeNull();
  });

  it('renders nothing when there is neither a casing nor an explicit seam width', () => {
    const { container } = renderSeam(seamLines('#ff000080', { strokeWidth: 0 }));
    expect(container.querySelector('[data-band-seam]')).toBeNull();
  });

  describe('seamEdges filter (branch inner edges)', () => {
    // A bent centerline so each seam edge carries BOTH a straight (L) run and a
    // fillet arc (A) — the two kinds the global setting picks between.
    const bentSeam = (seamEdges?: SeamEdges) => {
      const spec = baseSpec(['L1']);
      spec.centerline = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ];
      spec.radius = 24;
      return render(
        <svg>
          <SegmentBand
            spec={spec}
            stripeIndex={0}
            pass="seam"
            lines={seamLines('#ff000080')}
            seamEdges={seamEdges}
          />
        </svg>,
      );
    };
    const seamPaths = (c: HTMLElement) =>
      Array.from(c.querySelectorAll('[data-band-seam]'))
        .map((p) => p.getAttribute('d') ?? '')
        .join(' ');

    it("default ('both') draws both the straight and the curved seam pieces", () => {
      const d = seamPaths(bentSeam().container);
      expect(d).toContain('L');
      expect(d).toContain('A');
    });

    it("'straight' keeps only the straight seam pieces (no fillet arcs)", () => {
      const d = seamPaths(bentSeam('straight').container);
      expect(d).toContain('L');
      expect(d).not.toContain('A');
    });

    it("'curved' keeps only the curved fillet pieces (no straight runs)", () => {
      const d = seamPaths(bentSeam('curved').container);
      expect(d).toContain('A');
      expect(d).not.toContain('L');
    });

    it("'curved' on a fully straight band emits no seam paths (skips the empty edge)", () => {
      const { container } = render(
        <svg>
          <SegmentBand
            spec={baseSpec(['L1'])}
            stripeIndex={0}
            pass="seam"
            lines={seamLines('#ff000080')}
            seamEdges="curved"
          />
        </svg>,
      );
      expect(container.querySelectorAll('[data-band-seam]').length).toBe(0);
    });
  });
});

describe('<BandWarning>', () => {
  const warnSpec = (lineIds: LineId[], centerline: { x: number; y: number }[]): SegmentBandSpec => {
    const spec = baseSpec(lineIds);
    spec.warning = true;
    spec.centerline = centerline;
    return spec;
  };

  it('renders nothing when band.warning is false', () => {
    const { container } = render(
      <svg>
        <BandWarning spec={baseSpec(['L1'])} />
      </svg>,
    );
    expect(container.querySelector('text')).toBeNull();
    expect(container.querySelectorAll('path').length).toBe(0);
  });

  it('centers the ⚠ glyph on the segment midpoint (not the middle vertex)', () => {
    // 3 vertices: the middle vertex is at x=100, but the true segment center
    // (mean of the endpoints) is also x=100 here — use an asymmetric layout
    // so the two would disagree if the old floor(length/2) logic returned.
    const spec = warnSpec(
      ['L1'],
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 200, y: 0 },
      ],
    );
    const { container } = render(
      <svg>
        <BandWarning spec={spec} />
      </svg>,
    );
    const text = container.querySelector('text')!;
    expect(text.textContent).toBe('⚠');
    // Midpoint of first/last vertex = (0+200)/2 = 100, NOT the middle vertex (10).
    expect(text.getAttribute('x')).toBe('100');
    expect(text.getAttribute('y')).toBe('0');
  });

  it('frames the bad segment with a 1px white stroke over a 3px red stroke', () => {
    const spec = warnSpec(
      ['L1'],
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    );
    const { container } = render(
      <svg>
        <BandWarning spec={spec} />
      </svg>,
    );
    const paths = Array.from(container.querySelectorAll('path'));
    expect(paths.length).toBe(2);
    const [red, white] = paths;
    // Red is painted first (underneath) so the white core sits on top.
    expect(red.getAttribute('stroke')).toBe('#d00');
    expect(red.getAttribute('stroke-width')).toBe('3');
    expect(white.getAttribute('stroke')).toBe('#fff');
    expect(white.getAttribute('stroke-width')).toBe('1');
    // Both trace the same rectangle so the white sits centered in the red.
    expect(white.getAttribute('d')).toBe(red.getAttribute('d'));
  });

  it('sizes the frame to the band width (n stripes × STOP_SIZE)', () => {
    // Horizontal segment, 2 stripes → half-width = 2 * 14 / 2 = 14, so the
    // rectangle's long edges sit at y = ±14 around the centerline.
    const spec = warnSpec(
      ['L1', 'L2'],
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    );
    const { container } = render(
      <svg>
        <BandWarning spec={spec} />
      </svg>,
    );
    expect(container.querySelector('path')!.getAttribute('d')).toBe(
      'M 0 -14 L 100 -14 L 100 14 L 0 14 Z',
    );
  });

  it('frames a mixed-width band asymmetrically about the (mean) centerline', () => {
    // Widths [14, 28] → offsets [−10.5, +10.5]; the envelope runs from
    // offsets[0] − 7 = −17.5 to offsets[1] + 14 = +24.5 around the centroid
    // centerline — NOT a symmetric ±Σw/2 = ±21. (Perp for an east segment is
    // screen-up, so the +24.5 edge lands at y = −24.5.)
    const spec = makeBandSpec(['L1', 'L2'], {
      stripeWidths: [14, 28],
      warning: true,
    });
    const { container } = render(
      <svg>
        <BandWarning spec={spec} />
      </svg>,
    );
    expect(container.querySelector('path')!.getAttribute('d')).toBe(
      'M 0 -24.5 L 100 -24.5 L 100 17.5 L 0 17.5 Z',
    );
  });

  it('defaults the glyph fill to black and honors the iconColor prop', () => {
    const spec = warnSpec(
      ['L1'],
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    );
    const def = render(
      <svg>
        <BandWarning spec={spec} />
      </svg>,
    );
    expect(def.container.querySelector('text')!.getAttribute('fill')).toBe('#000');
    const custom = render(
      <svg>
        <BandWarning spec={spec} iconColor="#fff" />
      </svg>,
    );
    expect(custom.container.querySelector('text')!.getAttribute('fill')).toBe('#fff');
  });
});
