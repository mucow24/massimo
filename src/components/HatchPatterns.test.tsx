import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import {
  HATCH_GAP_WIDTH,
  HATCH_STRIPE_WIDTH,
  HatchPatterns,
  hatchPatternId,
  lineStyleStrokeAttrs,
  lineStyleUnderlayAttrs,
} from './HatchPatterns';

describe('hatchPatternId', () => {
  it('returns different ids for different colors', () => {
    expect(hatchPatternId('#EF374B')).not.toBe(hatchPatternId('#0039A6'));
  });

  it('strips characters that would be illegal in an SVG id', () => {
    const id = hatchPatternId('#EF374B');
    expect(id).not.toContain('#');
    expect(id).toMatch(/^[A-Za-z][A-Za-z0-9_-]*$/);
  });

  it('returns different ids for the two hatch variants of the same color', () => {
    expect(hatchPatternId('#EF374B', 'hatched')).not.toBe(
      hatchPatternId('#EF374B', 'hatched-mirror'),
    );
  });

  it('mirror id also satisfies SVG-id charset rules', () => {
    expect(hatchPatternId('#EF374B', 'hatched-mirror')).toMatch(/^[A-Za-z][A-Za-z0-9_-]*$/);
  });
});

describe('<HatchPatterns>', () => {
  const renderSvg = (colors: string[], underlayColor?: string) =>
    render(
      <svg>
        <HatchPatterns colors={colors} underlayColor={underlayColor} />
      </svg>,
    );

  it('emits both hatch variants per provided color', () => {
    const { container } = renderSvg(['#EF374B', '#0039A6']);
    const patterns = container.querySelectorAll('pattern');
    expect(patterns.length).toBe(4);
    const ids = Array.from(patterns).map((p) => p.id);
    expect(ids).toContain(hatchPatternId('#EF374B', 'hatched'));
    expect(ids).toContain(hatchPatternId('#EF374B', 'hatched-mirror'));
    expect(ids).toContain(hatchPatternId('#0039A6', 'hatched'));
    expect(ids).toContain(hatchPatternId('#0039A6', 'hatched-mirror'));
  });

  it('emits no <pattern> when the color list is empty', () => {
    const { container } = renderSvg([]);
    expect(container.querySelectorAll('pattern').length).toBe(0);
  });

  it('rotates the +45 variant via patternTransform', () => {
    const { container } = renderSvg(['#EF374B']);
    const p = container.querySelector(`pattern#${hatchPatternId('#EF374B', 'hatched')}`);
    expect(p?.getAttribute('patternTransform')).toMatch(/rotate\(45/);
  });

  it('rotates the mirror variant via patternTransform with negative angle', () => {
    const { container } = renderSvg(['#EF374B']);
    const p = container.querySelector(`pattern#${hatchPatternId('#EF374B', 'hatched-mirror')}`);
    expect(p?.getAttribute('patternTransform')).toMatch(/rotate\(-45/);
  });

  it('uses userSpaceOnUse so stripes hold their angle as the line bends', () => {
    const { container } = renderSvg(['#EF374B']);
    const p = container.querySelector('pattern');
    expect(p?.getAttribute('patternUnits')).toBe('userSpaceOnUse');
  });

  it('paints the stripe rect at the locked-in width using the line color', () => {
    const { container } = renderSvg(['#EF374B']);
    const rects = container.querySelectorAll('pattern rect');
    const colorRect = Array.from(rects).find((r) => r.getAttribute('fill') === '#EF374B');
    expect(colorRect?.getAttribute('width')).toBe(String(HATCH_STRIPE_WIDTH));
  });

  it('fills the gap between stripes with opaque white so lines behind do not show through', () => {
    const { container } = renderSvg(['#EF374B']);
    const rects = container.querySelectorAll('pattern rect');
    const whiteRect = Array.from(rects).find((r) => r.getAttribute('fill') === '#fff');
    expect(whiteRect?.getAttribute('width')).toBe(String(HATCH_GAP_WIDTH));
    expect(whiteRect?.getAttribute('x')).toBe(String(HATCH_STRIPE_WIDTH));
  });

  it('fills the gap with the supplied underlayColor (dark mode → black, not stale white)', () => {
    const { container } = renderSvg(['#EF374B'], '#000000');
    const rects = Array.from(container.querySelectorAll('pattern rect'));
    // No white gap remains; the gap rect is the dark underlay at x = stripe width.
    expect(rects.some((r) => r.getAttribute('fill') === '#fff')).toBe(false);
    const gap = rects.find((r) => r.getAttribute('x') === String(HATCH_STRIPE_WIDTH));
    expect(gap?.getAttribute('fill')).toBe('#000000');
    expect(gap?.getAttribute('width')).toBe(String(HATCH_GAP_WIDTH));
  });

  it('tile width is stripe + gap clamped to >= 1', () => {
    const { container } = renderSvg(['#EF374B']);
    const p = container.querySelector('pattern');
    expect(Number(p?.getAttribute('width'))).toBe(
      Math.max(1, HATCH_STRIPE_WIDTH + HATCH_GAP_WIDTH),
    );
  });

  // The registry and the stroke that references it agree only because both go
  // through hatchPatternId. Recomputing the id on the expectation side would
  // assert that agreement against itself, so this reads the id OUT of the
  // painted `url(#…)` and looks it up in the DOM: a naming drift between the
  // two sides lands here as a dangling reference, which paints nothing.
  it.each(['hatched', 'hatched-mirror'] as const)(
    'the url a %s band paints with resolves to an emitted pattern',
    (style) => {
      const { container } = renderSvg(['#EF374B', '#0039A6']);
      const { stroke } = lineStyleStrokeAttrs(style, '#0039A6', 14);
      const id = /^url\(#(.+)\)$/.exec(stroke)?.[1];
      expect(id).toBeTruthy();
      expect(container.querySelector(`pattern#${id}`)).not.toBeNull();
    },
  );
});

describe('lineStyleStrokeAttrs', () => {
  it('solid: plain stroke, no dasharray, butt linecap', () => {
    const a = lineStyleStrokeAttrs('solid', '#EF374B', 14);
    expect(a).toEqual({
      stroke: '#EF374B',
      strokeDasharray: undefined,
      strokeLinecap: 'butt',
    });
  });

  it('dashed: emits a dasharray and uses butt linecap', () => {
    const a = lineStyleStrokeAttrs('dashed', '#EF374B', 14);
    expect(a.stroke).toBe('#EF374B');
    expect(a.strokeDasharray).toMatch(/^\d+ \d+$/);
    expect(a.strokeLinecap).toBe('butt');
  });

  it('dashed: the fine tick pattern does NOT scale with stroke width', () => {
    expect(lineStyleStrokeAttrs('dashed', '#EF374B', 14).strokeDasharray).toBe(
      lineStyleStrokeAttrs('dashed', '#EF374B', 28).strokeDasharray,
    );
  });

  it('hatched: stroke points at the hatch pattern url for this color', () => {
    const a = lineStyleStrokeAttrs('hatched', '#EF374B', 14);
    expect(a.stroke).toBe(`url(#${hatchPatternId('#EF374B', 'hatched')})`);
    expect(a.strokeDasharray).toBeUndefined();
    expect(a.strokeLinecap).toBe('butt');
  });

  it('hatched-mirror: stroke points at the mirrored hatch pattern url for this color', () => {
    const a = lineStyleStrokeAttrs('hatched-mirror', '#EF374B', 14);
    expect(a.stroke).toBe(`url(#${hatchPatternId('#EF374B', 'hatched-mirror')})`);
    expect(a.strokeDasharray).toBeUndefined();
    expect(a.strokeLinecap).toBe('butt');
  });

  it('dotted: zero-length round-capped dashes — circles of diameter = strokeWidth', () => {
    const a = lineStyleStrokeAttrs('dotted', '#EF374B', 14);
    expect(a.stroke).toBe('#EF374B');
    expect(a.strokeLinecap).toBe('round');
    const [on, off] = a.strokeDasharray!.split(' ').map(Number);
    expect(on).toBe(0);
    // Center-to-center spacing exceeds the dot diameter so the circles
    // never touch, and scales with the stroke width.
    expect(off).toBeGreaterThan(14);
    const wide = lineStyleStrokeAttrs('dotted', '#EF374B', 28);
    expect(Number(wide.strokeDasharray!.split(' ')[1])).toBe(off * 2);
  });

  it('dashed-open: width-proportional dashes, butt linecap', () => {
    const a = lineStyleStrokeAttrs('dashed-open', '#EF374B', 14);
    expect(a.stroke).toBe('#EF374B');
    expect(a.strokeLinecap).toBe('butt');
    const [on, off] = a.strokeDasharray!.split(' ').map(Number);
    expect(on).toBeGreaterThan(0);
    expect(off).toBeGreaterThan(0);
    const wide = lineStyleStrokeAttrs('dashed-open', '#EF374B', 28);
    const [wideOn, wideOff] = wide.strokeDasharray!.split(' ').map(Number);
    expect(wideOn).toBe(on * 2);
    expect(wideOff).toBe(off * 2);
  });
});

describe('lineStyleUnderlayAttrs', () => {
  it('returns null for solid (no underlay needed)', () => {
    expect(lineStyleUnderlayAttrs('solid')).toBeNull();
  });

  it('returns null for hatched (white is baked into the SVG pattern)', () => {
    expect(lineStyleUnderlayAttrs('hatched')).toBeNull();
  });

  it('returns null for hatched-mirror (same: white baked into the pattern)', () => {
    expect(lineStyleUnderlayAttrs('hatched-mirror')).toBeNull();
  });

  it('returns a white butt-capped underlay for dashed so gaps occlude lines behind', () => {
    expect(lineStyleUnderlayAttrs('dashed')).toEqual({
      stroke: '#fff',
      strokeLinecap: 'butt',
    });
  });

  it('honors a custom underlayColor for dashed (dark mode passes black)', () => {
    expect(lineStyleUnderlayAttrs('dashed', '#000000')).toEqual({
      stroke: '#000000',
      strokeLinecap: 'butt',
    });
  });

  it('returns null for the open styles — their gaps are intentionally transparent', () => {
    expect(lineStyleUnderlayAttrs('dotted')).toBeNull();
    expect(lineStyleUnderlayAttrs('dashed-open')).toBeNull();
  });
});
