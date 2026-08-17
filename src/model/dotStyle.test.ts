import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DOT_STYLE,
  DOT_SHAPE_PRESETS,
  SERVICE_CODE_DOT_RADIUS,
  dotStylesEqual,
  isBlankDotStyle,
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
  strokeAlign: 'center',
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

  it("resolves a 'bw' fill against the LINE color — what actually sits behind the dot", () => {
    const s = style({ fill: 'bw' });
    expect(resolveDotRender(s, '#fccc0a', undefined, false)!.fill).toBe('#000');
    expect(resolveDotRender(s, '#0039a6', undefined, false)!.fill).toBe('#fff');
  });

  it("falls a 'bw' fill back to the canvas background when no line is in scope", () => {
    const s = style({ fill: 'bw' });
    expect(resolveDotRender(s, undefined, undefined, false)!.fill).toBe('#000');
    expect(resolveDotRender(s, undefined, undefined, true)!.fill).toBe('#fff');
  });

  it("stacks a 'bw' stroke on a 'bw' fill — the stroke inverts the fill it sits on", () => {
    // The fill goes white on a dark line, so its auto-contrast stroke goes black.
    const out = resolveDotRender(
      style({ fill: 'bw', strokeWidth: 2, strokeColor: 'bw' }),
      '#0039a6',
      undefined,
      false,
    )!;
    expect(out.fill).toBe('#fff');
    expect(out.stroke).toBe('#000');
  });

  it("resolves a 'bw' stroke to whichever of black/white is legible on the fill", () => {
    // Dark fills take a white stroke, light fills a black one — the same
    // auto-contrast rule the service code uses.
    expect(
      resolveDotRender(style({ strokeWidth: 2, strokeColor: 'bw' }), undefined, undefined, false)!
        .stroke,
    ).toBe('#fff');
    expect(
      resolveDotRender(
        style({ fill: W, strokeWidth: 2, strokeColor: 'bw' }),
        undefined,
        undefined,
        false,
      )!.stroke,
    ).toBe('#000');
    // A 'line' fill is judged against the resolved line color.
    expect(
      resolveDotRender(
        style({ fill: 'line', strokeWidth: 2, strokeColor: 'bw' }),
        '#fccc0a',
        undefined,
        false,
      )!.stroke,
    ).toBe('#000');
  });

  it("judges a 'bw' stroke on a TRANSPARENT fill against the line's band", () => {
    // 'none' means the band shows through (see DotFill), so the band is what
    // is actually behind the stroke — not the canvas. An open dot on a navy
    // line needs a white ring; black would vanish into the band.
    const s = style({ fill: 'none', strokeWidth: 2, strokeColor: 'bw' });
    expect(resolveDotRender(s, '#0039a6', undefined, false)!.stroke).toBe('#fff');
    expect(resolveDotRender(s, '#fccc0a', undefined, false)!.stroke).toBe('#000');
  });

  it("falls a transparent fill's 'bw' stroke back to the canvas with no line in scope", () => {
    const s = style({ fill: 'none', strokeWidth: 2, strokeColor: 'bw' });
    expect(resolveDotRender(s, undefined, undefined, false)!.stroke).toBe('#000');
    expect(resolveDotRender(s, undefined, undefined, true)!.stroke).toBe('#fff');
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

  // Also the no-override pin: passing the size argument as an explicit
  // `undefined` is the same call as omitting it, as this test does.
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

  it('a dash renders only its fill — stroke and service code are dropped (matches DashGlyph)', () => {
    // Even with a stroke + service code set, a dash resolves to fill-only, so the
    // preview (StopGlyph) can't promise a stroke/code the canvas (DashGlyph) — which
    // reads only params.fill and takes its outline from the line — never renders.
    const s = style({
      shape: 'dash',
      fill: 'line',
      strokeWidth: 3,
      strokeColor: K,
      showServiceCode: true,
    });
    const out = resolveDotRender(s, '#e6002d', 'A', false)!;
    expect(out.fill).toBe('#e6002d'); // fill DOES apply
    expect(out.stroke).toBeUndefined(); // dot-style stroke is inert for a dash
    expect(out.strokeWidth).toBeUndefined();
    expect(out.code).toBeUndefined(); // no service code on a tick
  });

  describe('size override', () => {
    it('halves an explicit diameter into r', () => {
      expect(resolveDotRender(style(), undefined, undefined, false, 9)!.r).toBe(4.5);
      expect(resolveDotRender(style(), undefined, undefined, false, 16)!.r).toBe(8);
    });

    it('applies the explicit size to service-code discs too, keeping the code', () => {
      const withCode = style({ showServiceCode: true });
      const out = resolveDotRender(withCode, undefined, 'A', false, 8)!;
      expect(out.r).toBe(4);
      expect(out.code).toEqual({ text: 'A', color: '#fff' });
    });

    it('size 0 resolves to r 0 (invisible but present)', () => {
      expect(resolveDotRender(style(), undefined, undefined, false, 0)!.r).toBe(0);
    });

    it('an invisible style stays null regardless of size', () => {
      const s = style({ fill: 'none', strokeWidth: 0 });
      expect(resolveDotRender(s, undefined, undefined, false, 12)).toBeNull();
    });
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

    it("judges a 'none' fill's code against the line's band — the band shows through", () => {
      const s = style({ fill: 'none', showServiceCode: true });
      expect(resolveDotRender(s, '#0039a6', 'A', false)!.code!.color).toBe('#fff');
      expect(resolveDotRender(s, '#fccc0a', 'A', false)!.code!.color).toBe('#000');
    });

    it("falls a 'none' fill's code back to the canvas with no line in scope", () => {
      const s = style({ fill: 'none', showServiceCode: true });
      expect(resolveDotRender(s, undefined, 'A', false)!.code!.color).toBe('#000');
      expect(resolveDotRender(s, undefined, 'A', true)!.code!.color).toBe('#fff');
    });

    it('omits code params when showServiceCode is false', () => {
      expect(resolveDotRender(style(), undefined, 'A', false)!.code).toBeUndefined();
    });

    it('honors an explicit serviceCodeColor day/night pair, overriding auto-contrast', () => {
      // Black fill would auto-contrast to white; the explicit pair wins.
      const s = style({
        showServiceCode: true,
        serviceCodeColor: { day: '#ff0000', night: '#00ff00' },
      });
      expect(resolveDotRender(s, undefined, 'A', false)!.code!.color).toBe('#ff0000');
      expect(resolveDotRender(s, undefined, 'A', true)!.code!.color).toBe('#00ff00');
    });

    it('falls back to auto-contrast when serviceCodeColor is absent', () => {
      // White fill auto-contrasts to black (unchanged legacy behavior).
      const s = style({ fill: W, showServiceCode: true });
      expect(resolveDotRender(s, undefined, 'A', false)!.code!.color).toBe('#000');
    });

    it("paints the code in the line's color for a 'line' serviceCodeColor", () => {
      // The 'line' sentinel wins over auto-contrast and is theme-agnostic — it's
      // whatever line color the caller passes (like a 'line' fill/stroke).
      const s = style({ fill: W, showServiceCode: true, serviceCodeColor: 'line' });
      expect(resolveDotRender(s, '#e6002d', 'A', false)!.code!.color).toBe('#e6002d');
      expect(resolveDotRender(s, '#e6002d', 'A', true)!.code!.color).toBe('#e6002d');
    });

    it("a 'line' serviceCodeColor falls back to black without a line in scope", () => {
      const s = style({ showServiceCode: true, serviceCodeColor: 'line' });
      expect(resolveDotRender(s, undefined, 'A', false)!.code!.color).toBe('#000');
    });

    it('paints only the first letter when serviceCodeFirstLetterOnly is set', () => {
      // The local/express case: "6" and "6X" share one dot look on the map.
      const s = style({ showServiceCode: true, serviceCodeFirstLetterOnly: true });
      const out = resolveDotRender(s, undefined, '6X', false)!;
      expect(out.code!.text).toBe('6');
      // Still a code disc — the truncation is text-only, not a size change.
      expect(out.r).toBe(SERVICE_CODE_DOT_RADIUS);
    });

    it('paints the whole code without the flag', () => {
      const s = style({ showServiceCode: true });
      expect(resolveDotRender(s, undefined, '6X', false)!.code!.text).toBe('6X');
    });
  });
});

describe('isBlankDotStyle', () => {
  it('is blank only when nothing paints: no fill, no stroke, no code', () => {
    expect(isBlankDotStyle(style({ fill: 'none' }))).toBe(true);
    expect(isBlankDotStyle(style())).toBe(false);
    expect(isBlankDotStyle(style({ fill: 'none', strokeWidth: 1.5 }))).toBe(false);
    expect(isBlankDotStyle(style({ fill: 'none', showServiceCode: true }))).toBe(false);
  });

  it('reads a dash by its FILL alone — its stroke and code are inert', () => {
    // resolveDotRender enforces "of the style fields only `fill` applies" for a
    // dash; blankness has to read the same rule or the two disagree about the
    // same style. A transparent-filled dash paints nothing whatever its
    // (inert) stroke and code say.
    const dash = (o: Partial<DotStyle> = {}) => style({ shape: 'dash', fill: 'none', ...o });
    expect(isBlankDotStyle(dash())).toBe(true);
    expect(isBlankDotStyle(dash({ strokeWidth: 2 }))).toBe(true);
    expect(isBlankDotStyle(dash({ showServiceCode: true }))).toBe(true);
    // A dash that HAS a fill paints, stroke and code notwithstanding.
    expect(isBlankDotStyle(style({ shape: 'dash', fill: 'line' }))).toBe(false);
  });

  it('the DASH preset paints — only a hand-cleared fill blanks a tick', () => {
    expect(isBlankDotStyle(DOT_SHAPE_PRESETS['dash'])).toBe(false);
    expect(isBlankDotStyle({ ...DOT_SHAPE_PRESETS['dash'], fill: 'none' })).toBe(true);
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

  // The swatch refs fold into their color comparisons: a link is part of what
  // makes two styles the same, compared by value (never object identity), and
  // absent ≡ absent so every preset and legacy style stays equal to itself.
  it('folds the swatch refs into the color comparisons', () => {
    const ref = { palette: 'grays', swatch: 'Border' };
    const linked = style({ fill: { day: '#333333', night: '#bbbbbb' }, fillRef: ref });
    expect(dotStylesEqual(linked, style({ fill: { day: '#333333', night: '#bbbbbb' } }))).toBe(
      false,
    );
    expect(
      dotStylesEqual(
        linked,
        style({ fill: { day: '#333333', night: '#bbbbbb' }, fillRef: { ...ref } }),
      ),
    ).toBe(true);
    expect(
      dotStylesEqual(
        style({ strokeColorRef: ref, strokeColor: { day: '#333333', night: '#bbbbbb' } }),
        style({ strokeColor: { day: '#333333', night: '#bbbbbb' } }),
      ),
    ).toBe(false);
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

  it('compares strokeAlign', () => {
    // Two styles that differ only in stroke alignment are NOT equal — otherwise
    // editing the alignment would be a silent no-op in updateStyleProps.
    expect(dotStylesEqual(style(), style({ strokeAlign: 'inside' }))).toBe(false);
    expect(
      dotStylesEqual(style({ strokeAlign: 'inside' }), style({ strokeAlign: 'outside' })),
    ).toBe(false);
    expect(dotStylesEqual(style({ strokeAlign: 'inside' }), style({ strokeAlign: 'inside' }))).toBe(
      true,
    );
  });

  it('treats an ABSENT strokeAlign as center (legacy value-match)', () => {
    // A raw pre-strokeAlign dot style must still value-match its canonical center
    // form — this is what lets the migration bakes (bakeStopDotLibrary /
    // bakeLineDotDefaults) tag legacy dots against the factory presets, which now
    // carry strokeAlign, BEFORE the v<21 backfill fills the field.
    const { strokeAlign: _drop, ...noAlign } = style({ strokeWidth: 2 });
    expect(dotStylesEqual(noAlign as DotStyle, style({ strokeWidth: 2 }))).toBe(true);
    expect(
      dotStylesEqual(noAlign as DotStyle, style({ strokeWidth: 2, strokeAlign: 'inside' })),
    ).toBe(false);
  });

  it('compares serviceCodeColor (present vs absent, and both sides)', () => {
    expect(dotStylesEqual(style({ serviceCodeColor: K }), style())).toBe(false);
    expect(dotStylesEqual(style({ serviceCodeColor: K }), style({ serviceCodeColor: W }))).toBe(
      false,
    );
    expect(
      dotStylesEqual(style({ serviceCodeColor: K }), style({ serviceCodeColor: { ...K } })),
    ).toBe(true);
    expect(dotStylesEqual(style(), style())).toBe(true);
  });

  it('compares serviceCodeFirstLetterOnly, reading absent as off', () => {
    expect(dotStylesEqual(style({ serviceCodeFirstLetterOnly: true }), style())).toBe(false);
    expect(
      dotStylesEqual(
        style({ serviceCodeFirstLetterOnly: true }),
        style({ serviceCodeFirstLetterOnly: true }),
      ),
    ).toBe(true);
    // A raw `false` must value-match an absent field, so the migration bakes
    // still recognize legacy dots against the factory presets (as strokeAlign).
    expect(dotStylesEqual(style({ serviceCodeFirstLetterOnly: false }), style())).toBe(true);
  });

  it("distinguishes a 'line' serviceCodeColor from a pair and from absent", () => {
    expect(
      dotStylesEqual(style({ serviceCodeColor: 'line' }), style({ serviceCodeColor: K })),
    ).toBe(false);
    expect(dotStylesEqual(style({ serviceCodeColor: 'line' }), style())).toBe(false);
    expect(
      dotStylesEqual(style({ serviceCodeColor: 'line' }), style({ serviceCodeColor: 'line' })),
    ).toBe(true);
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
      'filled-line-color-white-stroke': style({ fill: 'line', strokeWidth: 2, strokeColor: W }),
      'filled-line-color-black-stroke': style({ fill: 'line', strokeWidth: 2, strokeColor: K }),
      'filled-black-service-code': style({ showServiceCode: true }),
      'filled-black-diamond': style({ shape: 'diamond' }),
      'filled-white-diamond': style({ shape: 'diamond', fill: W, strokeColor: K }),
      'filled-black-x': style({ shape: 'x' }),
      'filled-white-x': style({ shape: 'x', fill: W, strokeColor: K }),
      dash: style({ shape: 'dash', fill: 'line', strokeColor: 'line' }),
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
