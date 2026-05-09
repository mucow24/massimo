import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import {
  HATCH_GAP_WIDTH,
  HATCH_STRIPE_WIDTH,
  HatchPatterns,
  hatchPatternId,
  lineStyleStrokeAttrs,
} from './HatchPatterns';

describe('hatchPatternId', () => {
  it('returns the same id for the same color', () => {
    expect(hatchPatternId('#EF374B')).toBe(hatchPatternId('#EF374B'));
  });

  it('returns different ids for different colors', () => {
    expect(hatchPatternId('#EF374B')).not.toBe(hatchPatternId('#0039A6'));
  });

  it('strips characters that would be illegal in an SVG id', () => {
    const id = hatchPatternId('#EF374B');
    expect(id).not.toContain('#');
    expect(id).toMatch(/^[A-Za-z][A-Za-z0-9_-]*$/);
  });
});

describe('<HatchPatterns>', () => {
  const renderSvg = (colors: string[]) =>
    render(
      <svg>
        <HatchPatterns colors={colors} />
      </svg>,
    );

  it('emits one <pattern> per provided color', () => {
    const { container } = renderSvg(['#EF374B', '#0039A6']);
    const patterns = container.querySelectorAll('pattern');
    expect(patterns.length).toBe(2);
    const ids = Array.from(patterns).map((p) => p.id);
    expect(ids).toContain(hatchPatternId('#EF374B'));
    expect(ids).toContain(hatchPatternId('#0039A6'));
  });

  it('emits no <pattern> when the color list is empty', () => {
    const { container } = renderSvg([]);
    expect(container.querySelectorAll('pattern').length).toBe(0);
  });

  it('rotates stripes 45° via patternTransform', () => {
    const { container } = renderSvg(['#EF374B']);
    const p = container.querySelector('pattern');
    expect(p?.getAttribute('patternTransform')).toMatch(/rotate\(45/);
  });

  it('uses userSpaceOnUse so stripes hold their angle as the line bends', () => {
    const { container } = renderSvg(['#EF374B']);
    const p = container.querySelector('pattern');
    expect(p?.getAttribute('patternUnits')).toBe('userSpaceOnUse');
  });

  it('paints the stripe rect at the locked-in width using the line color', () => {
    const { container } = renderSvg(['#EF374B']);
    const rect = container.querySelector('pattern rect');
    expect(rect?.getAttribute('width')).toBe(String(HATCH_STRIPE_WIDTH));
    expect(rect?.getAttribute('fill')).toBe('#EF374B');
  });

  it('tile width is stripe + gap clamped to >= 1', () => {
    const { container } = renderSvg(['#EF374B']);
    const p = container.querySelector('pattern');
    expect(Number(p?.getAttribute('width'))).toBe(
      Math.max(1, HATCH_STRIPE_WIDTH + HATCH_GAP_WIDTH),
    );
  });
});

describe('lineStyleStrokeAttrs', () => {
  it('solid: plain stroke, no dasharray, square linecap', () => {
    const a = lineStyleStrokeAttrs('solid', '#EF374B');
    expect(a).toEqual({
      stroke: '#EF374B',
      strokeDasharray: undefined,
      strokeLinecap: 'square',
    });
  });

  it('dashed: emits a dasharray and switches linecap to butt', () => {
    const a = lineStyleStrokeAttrs('dashed', '#EF374B');
    expect(a.stroke).toBe('#EF374B');
    expect(a.strokeDasharray).toMatch(/^\d+ \d+$/);
    expect(a.strokeLinecap).toBe('butt');
  });

  it('hatched: stroke points at the hatch pattern url for this color', () => {
    const a = lineStyleStrokeAttrs('hatched', '#EF374B');
    expect(a.stroke).toBe(`url(#${hatchPatternId('#EF374B')})`);
    expect(a.strokeDasharray).toBeUndefined();
    expect(a.strokeLinecap).toBe('square');
  });
});
