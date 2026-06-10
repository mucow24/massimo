import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DOT_STYLE,
  DOT_SHAPE_PRESETS,
  SERVICE_CODE_DOT_RADIUS,
  dotStylesEqual,
  resolveDotRender,
} from './dotStyle';
import { STOP_DOT_RADIUS } from '../geometry/orientation';
import type { DotShape, DotStyle } from './types';

// Day/night pairs used across the preset table.
const K = { day: '#000000', night: '#000000' };
const W = { day: '#ffffff', night: '#ffffff' };

const style = (overrides: Partial<DotStyle> = {}): DotStyle => ({
  shape: 'circle',
  fill: K,
  strokeWidth: 0,
  strokeColor: W,
  showServiceCode: false,
  ...overrides,
});

describe('resolveDotRender', () => {
  it('picks the day side of a fill pair in light mode and the night side in dark mode', () => {
    const s = style({ fill: { day: '#112233', night: '#445566' } });
    expect(resolveDotRender(s, undefined, undefined, false)!.fill).toBe('#112233');
    expect(resolveDotRender(s, undefined, undefined, true)!.fill).toBe('#445566');
  });

  it('picks the day/night side of a stroke pair when strokeWidth > 0', () => {
    const s = style({ strokeWidth: 2, strokeColor: { day: '#aabbcc', night: '#ddeeff' } });
    const day = resolveDotRender(s, undefined, undefined, false)!;
    expect(day.stroke).toBe('#aabbcc');
    expect(day.strokeWidth).toBe(2);
    expect(resolveDotRender(s, undefined, undefined, true)!.stroke).toBe('#ddeeff');
  });

  it("resolves a 'line' fill to the line's color, falling back to black without one", () => {
    const s = style({ fill: 'line' });
    expect(resolveDotRender(s, '#e6002d', undefined, false)!.fill).toBe('#e6002d');
    expect(resolveDotRender(s, undefined, undefined, false)!.fill).toBe('#000');
  });

  it("resolves a 'line' stroke to the line's color", () => {
    const s = style({ strokeWidth: 1.5, strokeColor: 'line' });
    expect(resolveDotRender(s, '#e6002d', undefined, false)!.stroke).toBe('#e6002d');
  });

  it("passes a 'none' fill through as the SVG keyword", () => {
    const s = style({ fill: 'none', strokeWidth: 1.5, strokeColor: K });
    expect(resolveDotRender(s, undefined, undefined, false)!.fill).toBe('none');
  });

  it('omits stroke params entirely at strokeWidth 0', () => {
    const out = resolveDotRender(style(), undefined, undefined, false)!;
    expect(out.stroke).toBeUndefined();
    expect(out.strokeWidth).toBeUndefined();
  });

  it('returns null for an invisible style (no fill, no stroke, no code)', () => {
    const s = style({ fill: 'none', strokeWidth: 0 });
    expect(resolveDotRender(s, undefined, undefined, false)).toBeNull();
  });

  it('a code-only style (no fill, no stroke, showServiceCode) still renders', () => {
    const s = style({ fill: 'none', strokeWidth: 0, showServiceCode: true });
    const out = resolveDotRender(s, undefined, 'A', false);
    expect(out).not.toBeNull();
    expect(out!.code).toEqual({ text: 'A', color: '#000' });
  });

  it('uses the standard dot radius without a code and the larger disc with one', () => {
    expect(resolveDotRender(style(), undefined, undefined, false)!.r).toBeCloseTo(
      STOP_DOT_RADIUS,
      5,
    );
    const withCode = style({ showServiceCode: true });
    expect(resolveDotRender(withCode, undefined, 'A', false)!.r).toBe(SERVICE_CODE_DOT_RADIUS);
  });

  it('passes the base shape through', () => {
    expect(resolveDotRender(style({ shape: 'x' }), undefined, undefined, false)!.shape).toBe('x');
    expect(resolveDotRender(style({ shape: 'square' }), undefined, undefined, false)!.shape).toBe(
      'square',
    );
  });

  describe('service code', () => {
    it("falls back to '?' when the caller has no line in scope", () => {
      const out = resolveDotRender(style({ showServiceCode: true }), undefined, undefined, false)!;
      expect(out.code!.text).toBe('?');
    });

    it('renders white on a black fill and black on a white fill', () => {
      const onBlack = resolveDotRender(style({ showServiceCode: true }), undefined, 'A', false)!;
      expect(onBlack.code!.color).toBe('#fff');
      const onWhite = resolveDotRender(
        style({ fill: W, showServiceCode: true }),
        undefined,
        'A',
        false,
      )!;
      expect(onWhite.code!.color).toBe('#000');
    });

    it("judges legibility against the line's color for a 'line' fill", () => {
      const s = style({ fill: 'line', showServiceCode: true });
      expect(resolveDotRender(s, '#ffdd00', 'A', false)!.code!.color).toBe('#000');
      expect(resolveDotRender(s, '#0039a6', 'A', false)!.code!.color).toBe('#fff');
    });

    it("judges legibility against the canvas background for a 'none' fill", () => {
      const s = style({ fill: 'none', showServiceCode: true });
      expect(resolveDotRender(s, undefined, 'A', false)!.code!.color).toBe('#000');
      expect(resolveDotRender(s, undefined, 'A', true)!.code!.color).toBe('#fff');
    });

    it('omits code params when showServiceCode is false', () => {
      expect(resolveDotRender(style(), undefined, 'A', false)!.code).toBeUndefined();
    });
  });
});

describe('dotStylesEqual', () => {
  it('treats structurally identical styles as equal', () => {
    expect(dotStylesEqual(style(), style())).toBe(true);
    const a = style({
      fill: 'line',
      strokeWidth: 2,
      strokeColor: { day: '#ff0000', night: '#00ff00' },
    });
    const b = style({
      fill: 'line',
      strokeWidth: 2,
      strokeColor: { day: '#ff0000', night: '#00ff00' },
    });
    expect(dotStylesEqual(a, b)).toBe(true);
  });

  it('distinguishes a color pair from a sentinel', () => {
    expect(dotStylesEqual(style({ fill: 'line' }), style({ fill: K }))).toBe(false);
    expect(dotStylesEqual(style({ fill: 'none' }), style({ fill: 'line' }))).toBe(false);
  });

  it('compares the nested day/night sides', () => {
    expect(
      dotStylesEqual(style({ fill: { day: '#000000', night: '#ffffff' } }), style({ fill: K })),
    ).toBe(false);
  });

  it('compares every scalar field', () => {
    expect(dotStylesEqual(style(), style({ shape: 'diamond' }))).toBe(false);
    expect(dotStylesEqual(style(), style({ strokeWidth: 1 }))).toBe(false);
    expect(dotStylesEqual(style(), style({ showServiceCode: true }))).toBe(false);
  });
});

describe('DOT_SHAPE_PRESETS', () => {
  it('re-implements every legacy DotShape, pinned field-for-field', () => {
    const expected: Record<DotShape, DotStyle> = {
      'filled-black': style(),
      'open-black': style({ fill: 'none', strokeWidth: 1.5, strokeColor: K }),
      'filled-black-white-stroke': style({ strokeWidth: 2, strokeColor: W }),
      'filled-white': style({ fill: W, strokeColor: K }),
      'open-white': style({ fill: 'none', strokeWidth: 1.5, strokeColor: W }),
      'filled-white-black-stroke': style({ fill: W, strokeWidth: 2, strokeColor: K }),
      'filled-line-color': style({ fill: 'line' }),
      'filled-black-service-code': style({ showServiceCode: true }),
      'filled-black-diamond': style({ shape: 'diamond' }),
      'filled-white-diamond': style({ shape: 'diamond', fill: W, strokeColor: K }),
      none: style({ fill: 'none', strokeColor: K }),
    };
    expect(DOT_SHAPE_PRESETS).toEqual(expected);
  });

  it('uses the filled-black preset as THE default style', () => {
    expect(DEFAULT_DOT_STYLE).toBe(DOT_SHAPE_PRESETS['filled-black']);
  });

  it("the 'none' preset is invisible — it resolves to null", () => {
    expect(resolveDotRender(DOT_SHAPE_PRESETS['none'], '#0039a6', 'A', false)).toBeNull();
  });

  it('matches the legacy filled-black-service-code render: r=6 black disc, white code', () => {
    const out = resolveDotRender(
      DOT_SHAPE_PRESETS['filled-black-service-code'],
      '#0039a6',
      'A',
      false,
    )!;
    expect(out.r).toBe(SERVICE_CODE_DOT_RADIUS);
    expect(out.fill).toBe('#000000');
    expect(out.code).toEqual({ text: 'A', color: '#fff' });
  });

  it('every preset is theme-blind: identical render in light and dark mode', () => {
    for (const id of Object.keys(DOT_SHAPE_PRESETS) as DotShape[]) {
      const p = DOT_SHAPE_PRESETS[id];
      expect(resolveDotRender(p, '#0039a6', 'A', false)).toEqual(
        resolveDotRender(p, '#0039a6', 'A', true),
      );
    }
  });
});
