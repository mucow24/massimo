import { describe, it, expect, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { fireEvent, render } from '@testing-library/react';
import { BandWarning, SegmentBand } from './SegmentBand';
import { hatchPatternId } from './HatchPatterns';
import { buildBands, type SegmentBandSpec } from '../geometry/interlining';
import type { Line, LineId, SeamEdges } from '../model/types';
import { makeBandSpec, makeDoc, makeLine, makeStation, makeStop } from '../test/fixtures';

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

describe('<SegmentBand> — hit surface for gappy styles', () => {
  // The three styles whose paint has GAPS along the stroke (a dasharray).
  // `pointer-events: stroke` on the painted path would hit only the painted
  // pieces, so half of every such segment is dead to the pointer.
  const gappy: StripeStyle[] = ['dashed', 'dotted', 'dashed-open'];

  const renderBand = (style: StripeStyle, props: Partial<ComponentProps<typeof SegmentBand>>) =>
    render(
      <svg>
        <SegmentBand
          spec={baseSpec(['L1'])}
          stripeIndex={0}
          pass="body"
          lines={linesFor([style])}
          {...props}
        />
      </svg>,
    );

  it.each(gappy)('covers the WHOLE %s segment with a continuous hit stroke', (style) => {
    const { container } = renderBand(style, { interactive: true, onLineClick: () => {} });
    const hit = container.querySelector('[data-band-hitbox]')!;
    expect(hit).not.toBeNull();
    // Continuous: the gaps are part of the hit box, so no dasharray…
    expect(hit.getAttribute('stroke-dasharray')).toBeNull();
    // …and it traces the painted stripe exactly — same path, same width, so
    // the hit box never spills onto a neighboring stripe.
    const stripe = container.querySelector('[data-band-stripe]')!;
    expect(hit.getAttribute('d')).toBe(stripe.getAttribute('d'));
    expect(hit.getAttribute('stroke-width')).toBe(stripe.getAttribute('stroke-width'));
    expect(hit.getAttribute('pointer-events')).toBe('stroke');
    // It is the ONLY hit surface: the painted stripe stops hit-testing (its
    // handlers stay wired for synthetic dispatch).
    expect(stripe.getAttribute('pointer-events')).toBe('none');
    // Invisible ink, and never printed.
    expect(hit.getAttribute('stroke')).toBe('transparent');
    expect(hit.getAttribute('data-export-exclude')).toBe('1');
  });

  it('carries the stripe’s identity so the deep-pick resolves it', () => {
    const { container } = renderBand('dashed', { interactive: true, onLineClick: () => {} });
    const hit = container.querySelector('[data-band-hitbox]')!;
    expect(hit.getAttribute('data-line-id')).toBe('L1');
    expect(hit.getAttribute('data-pair-key')).toBe('s1|s2');
  });

  it('runs the interactive handlers — clicking a GAP is a click on the segment', () => {
    const onLineClick = vi.fn();
    const onLineHover = vi.fn();
    const { container } = renderBand('dashed', {
      interactive: true,
      interactiveCursor: 'pointer',
      onLineClick,
      onLineHover,
    });
    const hit = container.querySelector('[data-band-hitbox]')!;
    fireEvent.pointerMove(hit);
    fireEvent.click(hit);
    expect(onLineHover).toHaveBeenCalledWith('L1', expect.anything());
    expect(onLineClick).toHaveBeenCalledWith('L1', expect.anything());
    expect((hit as SVGPathElement).style.cursor).toBe('pointer');
  });

  it('selects the line in default mode too (same 50/50 gap problem)', () => {
    const onLineSelect = vi.fn();
    const { container } = renderBand('dashed', { onLineSelect });
    fireEvent.click(container.querySelector('[data-band-hitbox]')!);
    expect(onLineSelect).toHaveBeenCalledWith('L1', expect.anything(), 's1|s2');
  });

  it('adds nothing for a CONTINUOUS style — its painted stroke is already the hit box', () => {
    for (const style of ['solid', 'hatched'] as StripeStyle[]) {
      const { container } = renderBand(style, { interactive: true, onLineClick: () => {} });
      expect(container.querySelector('[data-band-hitbox]')).toBeNull();
      expect(container.querySelector('[data-band-stripe]')!.getAttribute('pointer-events')).toBe(
        'stroke',
      );
    }
  });

  it('adds nothing when the band is inert (plain paint, or a decorative copy)', () => {
    expect(renderBand('dashed', {}).container.querySelector('[data-band-hitbox]')).toBeNull();
    const decorative = renderBand('dashed', {
      decorative: true,
      interactive: true,
      onLineClick: () => {},
    });
    expect(decorative.container.querySelector('[data-band-hitbox]')).toBeNull();
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
    opts: { strokeWidth?: number; seamWidth?: number; seamEdges?: SeamEdges } = {},
  ): Record<LineId, Line> => {
    const strokeWidth = opts.strokeWidth ?? 4;
    return {
      L1: makeLine({
        id: 'L1',
        stations: ['s1', 's2'],
        ...(strokeWidth > 0 ? { strokeWidth } : {}),
        ...(seamColor ? { seamColor } : {}),
        ...(opts.seamWidth !== undefined ? { seamWidth: opts.seamWidth } : {}),
        ...(opts.seamEdges !== undefined ? { seamEdges: opts.seamEdges } : {}),
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

  describe('seamEdges — which arm of the notch draws (branch inner edges)', () => {
    // The BRANCH arm at a self-overlap, as the build classified it (see
    // assignSeamArms) — bent, so its seam edges carry a fillet arc, and that is
    // what 'curved' keeps and 'straight' drops. The plain `renderSeam` spec is
    // the through-running arm: the opposite verdict under both modes.
    const bentSeam = (seamEdges?: SeamEdges, radius = 24) => {
      const spec = baseSpec(['L1']);
      spec.centerline = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ];
      spec.radius = radius;
      spec.seamArms = ['curved'];
      return render(
        <svg>
          <SegmentBand
            spec={spec}
            stripeIndex={0}
            pass="seam"
            lines={seamLines('#ff000080', { seamEdges })}
          />
        </svg>,
      );
    };
    const seamPaths = (c: HTMLElement) =>
      Array.from(c.querySelectorAll('[data-band-seam]'))
        .map((p) => p.getAttribute('d') ?? '')
        .join(' ');

    it('a line storing no mode draws every seam edge, bent or straight', () => {
      const d = seamPaths(bentSeam().container);
      expect(d).toContain('L');
      expect(d).toContain('A');
      expect(
        renderSeam(seamLines('#ff000080')).container.querySelectorAll('[data-band-seam]').length,
      ).toBe(2);
    });

    it("'curved' keeps a bent edge WHOLE — the fillet's straight lead-in comes with it", () => {
      const d = seamPaths(bentSeam('curved').container);
      expect(d).toContain('A');
      // The lead-in is what closes the branch mouth: dropping it leaves a gap
      // between the fillet and where the branch clears the trunk's corridor.
      expect(d).toContain('L');
      // One unbroken sub-path per edge — the seam never lifts the pen mid-edge.
      expect(d.match(/M /g)!.length).toBe(2);
    });

    it("'curved' drops a straight band's seam — it is the through-runner, not the branch", () => {
      const { container } = renderSeam(seamLines('#ff000080', { seamEdges: 'curved' }));
      expect(container.querySelectorAll('[data-band-seam]').length).toBe(0);
    });

    it("'straight' drops a bent edge — the branch's own stroke stays out of the notch", () => {
      expect(seamPaths(bentSeam('straight').container)).toBe('');
    });

    // The verdict is the STRIPE's, and it covers BOTH its edges. A fillet
    // tighter than the seam offset (`radius < width/2`, which the marker-fit cap
    // can produce on a short branch lead-in) degenerates the INNER edge's corner
    // to a straight — an edge-by-edge test would then call one side of the same
    // stripe a branch and the other a through-runner, and each mode would paint
    // half a notch.
    it('applies one verdict to both edges, even where a tight fillet flattens one', () => {
      expect(bentSeam('curved', 4).container.querySelectorAll('[data-band-seam]').length).toBe(2);
      expect(bentSeam('straight', 4).container.querySelectorAll('[data-band-seam]').length).toBe(0);
    });

    it("'straight' keeps a straight band's edges whole, so the main line's stroke carries through", () => {
      const { container } = renderSeam(seamLines('#ff000080', { seamEdges: 'straight' }));
      const rings = Array.from(container.querySelectorAll('[data-band-seam]'));
      expect(rings.length).toBe(2);
      for (const r of rings) expect(r.getAttribute('d')).toContain('L');
    });

    // The mode is per LINE now, so two lines sharing a band can disagree — the
    // whole point of moving it off the doc.
    it('reads each line’s own mode, so two lines in one band can differ', () => {
      const lines: Record<LineId, Line> = {
        L1: makeLine({
          id: 'L1',
          stations: ['s1', 's2'],
          strokeWidth: 4,
          seamColor: '#ff000080',
          seamEdges: 'straight',
        }),
        L2: makeLine({
          id: 'L2',
          stations: ['s1', 's2'],
          strokeWidth: 4,
          seamColor: '#ff000080',
        }),
      };
      const spec = baseSpec(['L1', 'L2']);
      spec.centerline = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ];
      spec.radius = 24;
      spec.seamArms = ['curved', 'curved'];
      const at = (stripeIndex: number) =>
        seamPaths(
          render(
            <svg>
              <SegmentBand spec={spec} stripeIndex={stripeIndex} pass="seam" lines={lines} />
            </svg>,
          ).container,
        );
      expect(at(0)).toBe(''); // L1: straight only, and this band bends
      expect(at(1)).toContain('A'); // L2: every edge, bent ones included
    });

    // Which arm a band is, is a fact about the JUNCTION — not about the band's
    // own shape. A through corridor whose next station sits off-axis doglegs
    // there, and a branch can leave the junction along the very SAME axis as
    // the through-run and only peel away further on. Both happen at once on a
    // real map (the A line at Broad Channel), so these bands are built through
    // the real router rather than hand-shaped.
    describe('at a real branch junction', () => {
      // n —— j —— m runs through on the NW/SE diagonal; b branches off it,
      // leaving j along that same diagonal and turning away 85 units on. m's
      // own far end is off-axis, so the THROUGH band j|m doglegs at the end
      // away from the junction.
      const branchBands = () => {
        const doc = makeDoc({
          stations: [
            makeStation({
              id: 'j',
              x: 0,
              y: 0,
              stops: [makeStop('L1', { orientation: 'auto-nw-se' })],
            }),
            makeStation({
              id: 'n',
              x: -200,
              y: -200,
              stops: [makeStop('L1', { orientation: 'auto-nw-se' })],
            }),
            makeStation({
              id: 'm',
              x: 200,
              y: 260,
              stops: [makeStop('L1', { orientation: 'auto-vertical' })],
            }),
            makeStation({
              id: 'b',
              x: 140,
              y: 60,
              stops: [makeStop('L1', { orientation: 'auto-horizontal' })],
            }),
          ],
          lines: [makeLine({ id: 'L1', edges: ['j|n', 'j|m', 'b|j'] })],
        });
        const bands = buildBands(doc.stations, doc.lines, doc.lineOrder);
        const at = (pairKey: string) => bands.find((x) => x.pairKey === pairKey)!;
        return { incoming: at('j|n'), through: at('j|m'), branch: at('b|j') };
      };

      const seamCount = (spec: SegmentBandSpec, seamEdges: SeamEdges) =>
        render(
          <svg>
            <SegmentBand
              spec={spec}
              stripeIndex={0}
              pass="seam"
              lines={seamLines('#ff000080', { seamEdges })}
            />
          </svg>,
        ).container.querySelectorAll('[data-band-seam]').length;

      it("'curved' draws the branch only — the through band's far dogleg is not a branch", () => {
        const { incoming, through, branch } = branchBands();
        expect(seamCount(branch, 'curved')).toBe(2);
        expect(seamCount(through, 'curved')).toBe(0);
        expect(seamCount(incoming, 'curved')).toBe(0);
      });

      it("'straight' draws the through arms only — including the one that doglegs", () => {
        const { incoming, through, branch } = branchBands();
        expect(seamCount(through, 'straight')).toBe(2);
        expect(seamCount(incoming, 'straight')).toBe(2);
        expect(seamCount(branch, 'straight')).toBe(0);
      });
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
