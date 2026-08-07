import { describe, it, expect, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { StopGlyph, X_POINTS } from './StopGlyph';
import { DOT_SHAPE_PRESETS, SERVICE_CODE_DOT_RADIUS } from '../model/dotStyle';
import { STOP_DOT_RADIUS } from '../geometry/orientation';
import { CAP_FRACTION } from '../geometry/textMeasure';
import { useDoc } from '../state/store';
import type { DotStyle } from '../model/types';

const P = DOT_SHAPE_PRESETS;

function renderGlyph(
  style: DotStyle | undefined,
  isHovered = false,
  lineColor?: string,
  serviceCode?: string,
) {
  const { container } = render(
    <svg>
      <StopGlyph
        cx={0}
        cy={0}
        style={style}
        lineColor={lineColor}
        serviceCode={serviceCode}
        isHovered={isHovered}
        stationId="A"
        lineId="L1"
      />
    </svg>,
  );
  return container.querySelector('svg')!;
}

const parsePoints = (points: string): [number, number][] =>
  points
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(',').map(Number) as [number, number]);

afterEach(() => {
  useDoc.setState({ darkMode: false });
});

// ——— Characterization: every legacy preset renders exactly as before ———

describe('<StopGlyph /> presets', () => {
  it('renders filled-black (default) as a black circle with no stroke', () => {
    const svg = renderGlyph(P['filled-black']);
    const c = svg.querySelector('circle')!;
    expect(c).toBeTruthy();
    expect(c.getAttribute('fill')).toBe('#000000');
    expect(c.getAttribute('stroke')).toBeNull();
    expect(parseFloat(c.getAttribute('r')!)).toBeCloseTo(STOP_DOT_RADIUS, 5);
  });

  it('treats an undefined style as filled-black', () => {
    const svg = renderGlyph(undefined);
    const c = svg.querySelector('circle')!;
    expect(c.getAttribute('fill')).toBe('#000000');
    expect(c.getAttribute('data-stop-shape')).toBe('circle');
  });

  it("renders open-black as a circle with fill='none' and a 1.5px black stroke", () => {
    const svg = renderGlyph(P['open-black']);
    const c = svg.querySelector('circle')!;
    expect(c.getAttribute('fill')).toBe('none');
    expect(c.getAttribute('stroke')).toBe('#000000');
    expect(c.getAttribute('stroke-width')).toBe('1.5');
  });

  it('renders filled-black-white-stroke', () => {
    const svg = renderGlyph(P['filled-black-white-stroke']);
    const c = svg.querySelector('circle')!;
    expect(c.getAttribute('fill')).toBe('#000000');
    expect(c.getAttribute('stroke')).toBe('#ffffff');
    expect(c.getAttribute('stroke-width')).toBe('2');
  });

  it('renders filled-white as a white circle with no stroke', () => {
    const svg = renderGlyph(P['filled-white']);
    const c = svg.querySelector('circle')!;
    expect(c.getAttribute('fill')).toBe('#ffffff');
    expect(c.getAttribute('stroke')).toBeNull();
  });

  it('renders open-white as fill=none with 1.5px white stroke', () => {
    const svg = renderGlyph(P['open-white']);
    const c = svg.querySelector('circle')!;
    expect(c.getAttribute('fill')).toBe('none');
    expect(c.getAttribute('stroke')).toBe('#ffffff');
    expect(c.getAttribute('stroke-width')).toBe('1.5');
  });

  it('renders filled-white-black-stroke', () => {
    const svg = renderGlyph(P['filled-white-black-stroke']);
    const c = svg.querySelector('circle')!;
    expect(c.getAttribute('fill')).toBe('#ffffff');
    expect(c.getAttribute('stroke')).toBe('#000000');
    expect(c.getAttribute('stroke-width')).toBe('2');
  });

  it("renders filled-line-color as a circle filled with the line's color, no stroke", () => {
    const svg = renderGlyph(P['filled-line-color'], false, '#e6002d');
    const c = svg.querySelector('circle')!;
    expect(c.getAttribute('fill')).toBe('#e6002d');
    expect(c.getAttribute('stroke')).toBeNull();
    expect(parseFloat(c.getAttribute('r')!)).toBeCloseTo(STOP_DOT_RADIUS, 5);
  });

  it('filled-line-color falls back to black when no lineColor is provided', () => {
    const svg = renderGlyph(P['filled-line-color']);
    const c = svg.querySelector('circle')!;
    expect(c.getAttribute('fill')).toBe('#000');
  });

  it('renders filled-line-color-white-stroke: line-color fill, 2px white stroke', () => {
    const svg = renderGlyph(P['filled-line-color-white-stroke'], false, '#e6002d');
    const c = svg.querySelector('circle')!;
    expect(c.getAttribute('fill')).toBe('#e6002d');
    expect(c.getAttribute('stroke')).toBe('#ffffff');
    expect(c.getAttribute('stroke-width')).toBe('2');
    expect(parseFloat(c.getAttribute('r')!)).toBeCloseTo(STOP_DOT_RADIUS, 5);
  });

  it('renders filled-line-color-black-stroke: line-color fill, 2px black stroke', () => {
    const svg = renderGlyph(P['filled-line-color-black-stroke'], false, '#e6002d');
    const c = svg.querySelector('circle')!;
    expect(c.getAttribute('fill')).toBe('#e6002d');
    expect(c.getAttribute('stroke')).toBe('#000000');
    expect(c.getAttribute('stroke-width')).toBe('2');
    expect(parseFloat(c.getAttribute('r')!)).toBeCloseTo(STOP_DOT_RADIUS, 5);
  });

  it('renders filled-black-service-code as a black circle with the service code in white', () => {
    const svg = renderGlyph(P['filled-black-service-code'], false, '#e6002d', 'A');
    const c = svg.querySelector('circle')!;
    expect(c.getAttribute('fill')).toBe('#000000');
    // Full service-code disc, not the smaller standard dot.
    expect(parseFloat(c.getAttribute('r')!)).toBeCloseTo(SERVICE_CODE_DOT_RADIUS, 5);
    const t = svg.querySelector('text')!;
    expect(t.textContent).toBe('A');
    expect(t.getAttribute('fill')).toBe('#fff');
    expect(svg.querySelector('g')!.getAttribute('data-stop-shape')).toBe('circle');
  });

  it('the service code falls back to "?" when no serviceCode is provided', () => {
    const svg = renderGlyph(P['filled-black-service-code']);
    expect(svg.querySelector('text')!.textContent).toBe('?');
  });

  it('hover on a service-code dot strokes the circle white 3px', () => {
    const svg = renderGlyph(P['filled-black-service-code'], true, undefined, 'A');
    const c = svg.querySelector('circle')!;
    expect(c.getAttribute('stroke')).toBe('#fff');
    expect(c.getAttribute('stroke-width')).toBe('3');
  });

  it('renders filled-black-diamond as a polygon', () => {
    const svg = renderGlyph(P['filled-black-diamond']);
    const p = svg.querySelector('polygon')!;
    expect(p).toBeTruthy();
    expect(p.getAttribute('fill')).toBe('#000000');
    expect(svg.querySelector('circle')).toBeNull();
    // Diamond inscribed in the circle's bounding box: vertex distance = STOP_DOT_RADIUS.
    const ys = parsePoints(p.getAttribute('points')!).map((c) => c[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(2 * STOP_DOT_RADIUS, 5);
  });

  it('renders filled-white-diamond as a white polygon', () => {
    const svg = renderGlyph(P['filled-white-diamond']);
    expect(svg.querySelector('polygon')!.getAttribute('fill')).toBe('#ffffff');
  });

  it('renders the X presets as black/white saltire polygons', () => {
    const black = renderGlyph(P['filled-black-x']).querySelector('polygon')!;
    expect(black.getAttribute('fill')).toBe('#000000');
    expect(black.getAttribute('data-stop-shape')).toBe('x');
    const white = renderGlyph(P['filled-white-x']).querySelector('polygon')!;
    expect(white.getAttribute('fill')).toBe('#ffffff');
  });

  it("'none' renders nothing — no circle, no polygon, no data-stop-shape", () => {
    const svg = renderGlyph(P['none']);
    expect(svg.querySelector('circle')).toBeNull();
    expect(svg.querySelector('polygon')).toBeNull();
    expect(svg.querySelector('[data-stop-shape]')).toBeNull();
  });

  it('hover overrides the stroke with white 3px regardless of base style', () => {
    const svg = renderGlyph(P['filled-white-black-stroke'], true);
    const c = svg.querySelector('circle')!;
    expect(c.getAttribute('stroke')).toBe('#fff');
    expect(c.getAttribute('stroke-width')).toBe('3');
  });

  it('hover on a diamond also gets the white 3px stroke', () => {
    const svg = renderGlyph(P['filled-black-diamond'], true);
    const p = svg.querySelector('polygon')!;
    expect(p.getAttribute('stroke')).toBe('#fff');
    expect(p.getAttribute('stroke-width')).toBe('3');
  });

  it('tags each glyph with data-stop-station and the base shape for E2E', () => {
    const svg = renderGlyph(P['filled-black-diamond']);
    const p = svg.querySelector('polygon')!;
    expect(p.getAttribute('data-stop-station')).toBe('A');
    expect(p.getAttribute('data-stop-shape')).toBe('diamond');
  });
});

// ——— Procedural capabilities beyond the presets ———

describe('<StopGlyph /> procedural styles', () => {
  const custom = (overrides: Partial<DotStyle>): DotStyle => ({
    ...P['filled-black'],
    ...overrides,
  });

  it('renders a square as a 2r×2r rect centered on the stop', () => {
    const svg = renderGlyph(custom({ shape: 'square' }));
    const rect = svg.querySelector('rect')!;
    expect(rect).toBeTruthy();
    expect(parseFloat(rect.getAttribute('x')!)).toBeCloseTo(-STOP_DOT_RADIUS, 5);
    expect(parseFloat(rect.getAttribute('y')!)).toBeCloseTo(-STOP_DOT_RADIUS, 5);
    expect(parseFloat(rect.getAttribute('width')!)).toBeCloseTo(2 * STOP_DOT_RADIUS, 5);
    expect(parseFloat(rect.getAttribute('height')!)).toBeCloseTo(2 * STOP_DOT_RADIUS, 5);
    expect(rect.getAttribute('fill')).toBe('#000000');
    expect(rect.getAttribute('data-stop-shape')).toBe('square');
  });

  it('renders an x as a 12-vertex saltire polygon spanning the 2r box', () => {
    const svg = renderGlyph(custom({ shape: 'x' }));
    const p = svg.querySelector('polygon')!;
    expect(p).toBeTruthy();
    expect(p.getAttribute('data-stop-shape')).toBe('x');
    const pts = parsePoints(p.getAttribute('points')!);
    expect(pts.length).toBe(12);
    const xs = pts.map((c) => c[0]);
    const ys = pts.map((c) => c[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2 * STOP_DOT_RADIUS, 5);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(2 * STOP_DOT_RADIUS, 5);
  });

  it('the x polygon is symmetric under 90° rotation about its center', () => {
    const pts = parsePoints(X_POINTS(0, 0, STOP_DOT_RADIUS));
    const key = ([x, y]: [number, number]) => `${x.toFixed(4)},${y.toFixed(4)}`;
    const original = new Set(pts.map(key));
    const rotated = new Set(pts.map(([x, y]) => key([-y, x])));
    expect(rotated).toEqual(original);
  });

  it('a day/night fill pair follows the viewport dark mode', () => {
    const s = custom({ fill: { day: '#112233', night: '#445566' } });
    expect(renderGlyph(s).querySelector('circle')!.getAttribute('fill')).toBe('#112233');
    useDoc.setState({ darkMode: true });
    expect(renderGlyph(s).querySelector('circle')!.getAttribute('fill')).toBe('#445566');
  });

  it("a 'line' stroke color follows the line's color", () => {
    const s = custom({ strokeWidth: 2, strokeColor: 'line' });
    const c = renderGlyph(s, false, '#e6002d').querySelector('circle')!;
    expect(c.getAttribute('stroke')).toBe('#e6002d');
  });

  it('a service code on a light fill renders in black for legibility', () => {
    const s = custom({ fill: { day: '#ffffff', night: '#ffffff' }, showServiceCode: true });
    const svg = renderGlyph(s, false, undefined, 'A');
    expect(svg.querySelector('text')!.getAttribute('fill')).toBe('#000');
  });

  it('anchors the service code on the ALPHABETIC baseline, cap-box centered on the dot', () => {
    // `dominant-baseline="central"` centers the font's ascent..descent box, and
    // Chrome sources those from a different table per platform: usWin on
    // Windows (central at 0.345em), hhea on macOS (0.258em) — this font sets
    // neither USE_TYPO_METRICS nor matching values, so the code sat ~0.09em low
    // on macOS. The alphabetic baseline is platform-invariant, so the code is
    // placed on it explicitly, half a cap-height below the dot center.
    const { container } = render(
      <svg>
        <StopGlyph cx={30} cy={50} style={P['filled-black-service-code']} serviceCode="A" />
      </svg>,
    );
    const t = container.querySelector('text')!;
    const fontSize = SERVICE_CODE_DOT_RADIUS * 1.2;
    expect(parseFloat(t.getAttribute('x')!)).toBeCloseTo(30, 5);
    expect(parseFloat(t.getAttribute('y')!)).toBeCloseTo(50 + (fontSize * CAP_FRACTION) / 2, 5);
    expect(t.getAttribute('dominant-baseline')).toBeNull();
  });

  it('a service code on a non-circle shape still bumps the glyph to the code disc size', () => {
    const s = custom({ shape: 'diamond', showServiceCode: true });
    const svg = renderGlyph(s, false, undefined, 'A');
    const ys = parsePoints(svg.querySelector('polygon')!.getAttribute('points')!).map((c) => c[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(2 * SERVICE_CODE_DOT_RADIUS, 5);
  });

  it('an invisible custom style renders nothing even when hovered', () => {
    const s = custom({ fill: 'none' });
    const svg = renderGlyph(s, true);
    expect(svg.querySelector('[data-stop-shape]')).toBeNull();
  });
});

// ——— Size overrides (the stop/line dot-size chain) ———

describe('<StopGlyph /> size override', () => {
  function renderSized(style: DotStyle, sizeOverride: number | undefined, serviceCode?: string) {
    const { container } = render(
      <svg>
        <StopGlyph
          cx={0}
          cy={0}
          style={style}
          serviceCode={serviceCode}
          sizeOverride={sizeOverride}
          stationId="A"
          lineId="L1"
        />
      </svg>,
    );
    return container.querySelector('svg')!;
  }

  it('halves an explicit diameter into the circle r', () => {
    const svg = renderSized(P['filled-black'], 12);
    expect(svg.querySelector('circle')!.getAttribute('r')).toBe('6');
  });

  it('scales non-circle shapes through the same radius', () => {
    const svg = renderSized({ ...P['filled-black-diamond'] }, 12);
    const ys = parsePoints(svg.querySelector('polygon')!.getAttribute('points')!).map((c) => c[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(12, 5);
  });

  it('resizes a service-code disc and its label font with it', () => {
    const svg = renderSized(P['filled-black-service-code'], 16, 'A');
    const c = svg.querySelector('circle')!;
    expect(c.getAttribute('r')).toBe('8');
    // Code font tracks the resolved radius (r × 1.2).
    expect(parseFloat(svg.querySelector('text')!.getAttribute('font-size')!)).toBeCloseTo(9.6, 5);
  });

  it('keeps the per-style fixed radii when no override is passed (pin)', () => {
    const plain = renderSized(P['filled-black'], undefined);
    expect(parseFloat(plain.querySelector('circle')!.getAttribute('r')!)).toBeCloseTo(
      STOP_DOT_RADIUS,
      5,
    );
    const code = renderSized(P['filled-black-service-code'], undefined, 'A');
    expect(parseFloat(code.querySelector('circle')!.getAttribute('r')!)).toBeCloseTo(
      SERVICE_CODE_DOT_RADIUS,
      5,
    );
  });
});

// ——— Two-pass split: strokes render before fills (the `pass` prop) ———
//
// StationDots paints all dot strokes (pass="stroke") and then all dot fills
// (pass="fill"), so overlapping dots share one continuous outer border. Each
// pass renders only its half; the canonical E2E seam (data-stop-shape /
// -station / -line) lives on the fill pass so it stays one element per dot.

describe('<StopGlyph /> stroke/fill/code split (pass prop)', () => {
  function renderPass(
    style: DotStyle | undefined,
    pass: 'stroke' | 'fill' | 'code',
    opts: { isHovered?: boolean; lineColor?: string; serviceCode?: string } = {},
  ) {
    const { container } = render(
      <svg>
        <StopGlyph
          cx={0}
          cy={0}
          style={style}
          pass={pass}
          isHovered={opts.isHovered}
          lineColor={opts.lineColor}
          serviceCode={opts.serviceCode}
          stationId="A"
          lineId="L1"
        />
      </svg>,
    );
    return container.querySelector('svg')!;
  }

  it('stroke pass draws the outline as a filled silhouette in the stroke color, outset by half the width', () => {
    const svg = renderPass(P['filled-white-black-stroke'], 'stroke');
    const c = svg.querySelector('circle')!;
    // A filled silhouette (the border color as fill), NOT an SVG stroke.
    expect(c.getAttribute('fill')).toBe('#000000');
    expect(c.getAttribute('stroke')).toBeNull();
    // Outset by strokeWidth/2 = 1, so with the body inset by 1 a 2px band shows.
    expect(parseFloat(c.getAttribute('r')!)).toBeCloseTo(STOP_DOT_RADIUS + 1, 5);
    expect(c.hasAttribute('data-stop-stroke')).toBe(true);
    // data-stop-stroke carries the station id as its VALUE (the canonical
    // data-stop-station attr must stay one-element-per-dot on the fill pass,
    // but the alt+click deep-pick resolver still needs to map border pixels
    // back to their station).
    expect(c.getAttribute('data-stop-stroke')).toBe('A');
    // The canonical seam stays on the fill pass — never on the stroke element.
    expect(c.getAttribute('data-stop-shape')).toBeNull();
    expect(svg.querySelector('text')).toBeNull();
  });

  it('fill pass draws the body inset by half the stroke width, no stroke, carrying the data attrs', () => {
    const svg = renderPass(P['filled-white-black-stroke'], 'fill');
    const c = svg.querySelector('circle')!;
    expect(c.getAttribute('fill')).toBe('#ffffff');
    expect(c.getAttribute('stroke')).toBeNull();
    // Inset by strokeWidth/2 = 1 so the silhouette below shows exactly 2px.
    expect(parseFloat(c.getAttribute('r')!)).toBeCloseTo(STOP_DOT_RADIUS - 1, 5);
    expect(c.getAttribute('data-stop-shape')).toBe('circle');
    expect(c.getAttribute('data-stop-station')).toBe('A');
    expect(c.getAttribute('data-stop-line')).toBe('L1');
    expect(c.hasAttribute('data-stop-stroke')).toBe(false);
  });

  it('a lone filled dot keeps its footprint: outer edge of the silhouette equals a centered stroke', () => {
    // filled-white-black-stroke has strokeWidth 2 → ±1 split. The silhouette's
    // outer edge (r + 1) matches a centered 2px stroke's outer edge, and the
    // body's inner edge (r − 1) matches its inner edge — so a single dot looks
    // identical to the old combined render while overlaps now merge.
    const sil = renderPass(P['filled-white-black-stroke'], 'stroke').querySelector('circle')!;
    const body = renderPass(P['filled-white-black-stroke'], 'fill').querySelector('circle')!;
    expect(parseFloat(sil.getAttribute('r')!)).toBeCloseTo(STOP_DOT_RADIUS + 1, 5);
    expect(parseFloat(body.getAttribute('r')!)).toBeCloseTo(STOP_DOT_RADIUS - 1, 5);
  });

  it('stroke pass renders nothing for a stroke-less style', () => {
    const svg = renderPass(P['filled-black'], 'stroke');
    expect(svg.querySelector('circle, rect, polygon, g, text')).toBeNull();
  });

  it('fill pass still renders the body for a stroke-less style', () => {
    const c = renderPass(P['filled-black'], 'fill').querySelector('circle')!;
    expect(c.getAttribute('fill')).toBe('#000000');
    expect(c.getAttribute('data-stop-shape')).toBe('circle');
  });

  it('an open style keeps its ring (stroke + fill) on the single fill-pass element', () => {
    // No fill to merge against, so an open dot isn't split — and the seam
    // element keeps the stroke so it stays selectable and matches the pre-split
    // render (the v6→v7 migration e2e asserts stroke on this element).
    expect(renderPass(P['open-black'], 'stroke').querySelector('circle')).toBeNull();
    const fc = renderPass(P['open-black'], 'fill').querySelector('circle')!;
    expect(fc.getAttribute('fill')).toBe('none');
    expect(fc.getAttribute('stroke')).toBe('#000000');
    expect(fc.getAttribute('stroke-width')).toBe('1.5');
    expect(fc.getAttribute('data-stop-shape')).toBe('circle');
    expect(fc.getAttribute('data-stop-line')).toBe('L1');
  });

  it('hover paints the white 3px affordance as a silhouette in the stroke pass', () => {
    const c = renderPass(P['filled-black'], 'stroke', { isHovered: true }).querySelector('circle')!;
    // White silhouette outset by 3/2 = 1.5; the black body (inset 1.5) leaves a
    // 3px white ring around it.
    expect(c.getAttribute('fill')).toBe('#fff');
    expect(c.getAttribute('stroke')).toBeNull();
    expect(parseFloat(c.getAttribute('r')!)).toBeCloseTo(STOP_DOT_RADIUS + 1.5, 5);
  });

  it('a service-code dot splits the disc and the code across the fill and code passes', () => {
    // The code rides its OWN pass so no neighbouring dot's body can land on it
    // — and so a transfer has a rung to sit on between the two (see
    // TransferDrawOrder). With the code gone from the fill pass, the disc keeps
    // the canonical seam attrs directly rather than through a wrapping <g>.
    const fillSvg = renderPass(P['filled-black-service-code'], 'fill', { serviceCode: 'A' });
    expect(fillSvg.querySelector('text')).toBeNull();
    const disc = fillSvg.querySelector('circle')!;
    expect(disc.getAttribute('data-stop-shape')).toBe('circle');
    expect(disc.getAttribute('data-stop-line')).toBe('L1');

    const codeSvg = renderPass(P['filled-black-service-code'], 'code', { serviceCode: 'A' });
    const text = codeSvg.querySelector('text')!;
    expect(text.textContent).toBe('A');
    // Its own seam, carrying the station id as the VALUE — a second
    // data-stop-station would break the one-element-per-dot locators.
    expect(text.getAttribute('data-stop-code')).toBe('A');
    expect(text.getAttribute('data-stop-line')).toBe('L1');
    expect(codeSvg.querySelector('circle')).toBeNull();

    // filled-black-service-code has strokeWidth 0 → nothing in the stroke pass.
    const strokeSvg = renderPass(P['filled-black-service-code'], 'stroke', { serviceCode: 'A' });
    expect(strokeSvg.querySelector('circle, text')).toBeNull();
  });

  it('a codeless dot renders nothing at all in the code pass', () => {
    expect(
      renderPass(P['filled-black'], 'code').querySelector('circle, rect, polygon, g, text'),
    ).toBeNull();
  });

  it("'none' renders nothing in any pass", () => {
    for (const pass of ['stroke', 'fill', 'code'] as const) {
      expect(
        renderPass(P['none'], pass).querySelector('circle, rect, polygon, g, text'),
      ).toBeNull();
    }
  });

  // The silhouette/inset distance is in radius units, so it must be shape-aware
  // to keep the border a uniform width on every edge.
  const strokedDiamond: DotStyle = {
    shape: 'diamond',
    fill: { day: '#ffffff', night: '#ffffff' },
    strokeWidth: 2,
    strokeColor: { day: '#000000', night: '#000000' },
    strokeAlign: 'center',
    showServiceCode: false,
  };
  const strokedX: DotStyle = { ...strokedDiamond, shape: 'x' };
  const yExtent = (p: Element) => {
    const ys = parsePoints(p.getAttribute('points')!).map((c) => c[1]);
    return Math.max(...ys) - Math.min(...ys);
  };

  it('offsets a diamond silhouette by √2× the half-width so its border is uniform', () => {
    // strokeWidth 2 → half-width 1; a diamond's edges are r/√2 from center, so
    // the radius delta is 1 × √2. Silhouette outset, body inset by that.
    const sil = renderPass(strokedDiamond, 'stroke').querySelector('polygon')!;
    const body = renderPass(strokedDiamond, 'fill').querySelector('polygon')!;
    expect(sil.getAttribute('fill')).toBe('#000000');
    expect(sil.hasAttribute('data-stop-stroke')).toBe(true);
    expect(yExtent(sil)).toBeCloseTo(2 * (STOP_DOT_RADIUS + Math.SQRT2), 5);
    expect(body.getAttribute('fill')).toBe('#ffffff');
    expect(yExtent(body)).toBeCloseTo(2 * (STOP_DOT_RADIUS - Math.SQRT2), 5);
  });

  // Stroke alignment (center/inside/outside): center straddles the edge (the
  // default, tested above); 'inside' pins the outer edge and grows the stroke
  // inward; 'outside' pins the fill and grows it outward. filled-white-black-stroke
  // is a strokeWidth-2 circle, so each shift is a full 2px.
  const aligned = (a: DotStyle['strokeAlign']): DotStyle => ({
    ...P['filled-white-black-stroke'],
    strokeAlign: a,
  });

  it("'inside' pins the silhouette outer edge at r and eats the body inward", () => {
    const sil = renderPass(aligned('inside'), 'stroke').querySelector('circle')!;
    const body = renderPass(aligned('inside'), 'fill').querySelector('circle')!;
    expect(parseFloat(sil.getAttribute('r')!)).toBeCloseTo(STOP_DOT_RADIUS, 5);
    expect(parseFloat(body.getAttribute('r')!)).toBeCloseTo(STOP_DOT_RADIUS - 2, 5);
  });

  it("'outside' pins the body at r and grows the silhouette outward", () => {
    const sil = renderPass(aligned('outside'), 'stroke').querySelector('circle')!;
    const body = renderPass(aligned('outside'), 'fill').querySelector('circle')!;
    expect(parseFloat(sil.getAttribute('r')!)).toBeCloseTo(STOP_DOT_RADIUS + 2, 5);
    expect(parseFloat(body.getAttribute('r')!)).toBeCloseTo(STOP_DOT_RADIUS, 5);
  });

  it("scales an inside-aligned diamond's inward shift by √2", () => {
    const insideDiamond: DotStyle = { ...strokedDiamond, strokeAlign: 'inside' };
    const sil = renderPass(insideDiamond, 'stroke').querySelector('polygon')!;
    const body = renderPass(insideDiamond, 'fill').querySelector('polygon')!;
    expect(yExtent(sil)).toBeCloseTo(2 * STOP_DOT_RADIUS, 5);
    expect(yExtent(body)).toBeCloseTo(2 * (STOP_DOT_RADIUS - 2 * Math.SQRT2), 5);
  });

  it('shifts an open ring native-stroke radius to honor alignment', () => {
    // open-black: strokeWidth 1.5 → half 0.75. Inside draws the ring at r − 0.75
    // (band [r−1.5, r]); outside at r + 0.75. The native stroke width is unchanged.
    const inside = renderPass({ ...P['open-black'], strokeAlign: 'inside' }, 'fill').querySelector(
      'circle',
    )!;
    expect(parseFloat(inside.getAttribute('r')!)).toBeCloseTo(STOP_DOT_RADIUS - 0.75, 5);
    expect(inside.getAttribute('stroke-width')).toBe('1.5');
    const outside = renderPass(
      { ...P['open-black'], strokeAlign: 'outside' },
      'fill',
    ).querySelector('circle')!;
    expect(parseFloat(outside.getAttribute('r')!)).toBeCloseTo(STOP_DOT_RADIUS + 0.75, 5);
  });

  it('keeps the hover affordance centered regardless of the style alignment', () => {
    const c = renderPass(aligned('inside'), 'stroke', { isHovered: true }).querySelector('circle')!;
    expect(parseFloat(c.getAttribute('r')!)).toBeCloseTo(STOP_DOT_RADIUS + 1.5, 5);
  });

  it('splits a non-center dot in combined (preview) mode so the shift is visible', () => {
    const { container } = render(
      <svg>
        <StopGlyph cx={0} cy={0} style={aligned('inside')} />
      </svg>,
    );
    const radii = [...container.querySelectorAll('circle')]
      .map((c) => parseFloat(c.getAttribute('r')!))
      .sort((a, b) => a - b);
    expect(radii).toHaveLength(2);
    expect(radii[0]).toBeCloseTo(STOP_DOT_RADIUS - 2, 5);
    expect(radii[1]).toBeCloseTo(STOP_DOT_RADIUS, 5);
  });

  it('keeps a center-aligned dot as a single element in combined (preview) mode', () => {
    const { container } = render(
      <svg>
        <StopGlyph cx={0} cy={0} style={aligned('center')} />
      </svg>,
    );
    // Center is pixel-identical to the historical single native-stroke element.
    expect(container.querySelectorAll('circle')).toHaveLength(1);
  });

  it('clamps the body radius at 0 for a stroke thicker than the dot (inside)', () => {
    // inside body radius = r − 2·off; a strokeWidth of 2r+2 drives it negative, so
    // it clamps to 0 (mirrors casingInsetBodyWidth) rather than a negative r.
    const thick: DotStyle = {
      ...P['filled-white-black-stroke'],
      strokeWidth: 2 * STOP_DOT_RADIUS + 2,
      strokeAlign: 'inside',
    };
    const body = renderPass(thick, 'fill').querySelector('circle')!;
    expect(parseFloat(body.getAttribute('r')!)).toBe(0);
  });

  it('keeps a stroked X on a centered stroke (fill pass) with no silhouette', () => {
    // The saltire is concave; a radius offset can't make its border uniform, so
    // it isn't split — the outline rides the fill pass centered, as before.
    expect(renderPass(strokedX, 'stroke').querySelector('polygon')).toBeNull();
    const body = renderPass(strokedX, 'fill').querySelector('polygon')!;
    expect(body.getAttribute('fill')).toBe('#ffffff');
    expect(body.getAttribute('stroke')).toBe('#000000');
    expect(body.getAttribute('stroke-width')).toBe('2');
    expect(body.getAttribute('data-stop-shape')).toBe('x');
  });
});
