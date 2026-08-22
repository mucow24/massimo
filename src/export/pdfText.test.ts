import { describe, it, expect, afterEach } from 'vitest';
import { normalizeTextBaselines, shiftTextY } from './pdfText';

const SVG_NS = 'http://www.w3.org/2000/svg';

function makeText(
  attrs: Record<string, string>,
  tspans: Record<string, string>[] = [],
): SVGTextElement {
  const t = document.createElementNS(SVG_NS, 'text');
  for (const [k, v] of Object.entries(attrs)) t.setAttribute(k, v);
  for (const ts of tspans) {
    const s = document.createElementNS(SVG_NS, 'tspan');
    for (const [k, v] of Object.entries(ts)) s.setAttribute(k, v);
    t.appendChild(s);
  }
  return t as SVGTextElement;
}

describe('shiftTextY', () => {
  it('adds the delta to the text y attribute', () => {
    const t = makeText({ y: '10' });
    shiftTextY(t, 5);
    expect(t.getAttribute('y')).toBe('15');
  });

  it('treats a missing y as 0', () => {
    const t = makeText({});
    shiftTextY(t, 4);
    expect(t.getAttribute('y')).toBe('4');
  });

  it('shifts tspans with an absolute y, leaving relative-dy tspans alone', () => {
    const t = makeText({ y: '0' }, [{ y: '20' }, { dy: '12' }]);
    shiftTextY(t, 3);
    const spans = t.querySelectorAll('tspan');
    expect(spans[0].getAttribute('y')).toBe('23');
    expect(spans[1].getAttribute('y')).toBeNull();
    expect(spans[1].getAttribute('dy')).toBe('12'); // relative offset untouched
  });

  it('is a no-op when the delta is 0', () => {
    const t = makeText({}); // no y attribute
    shiftTextY(t, 0);
    expect(t.getAttribute('y')).toBeNull();
  });

  it('handles negative and fractional deltas', () => {
    const t = makeText({ y: '10' });
    shiftTextY(t, -2.5);
    expect(t.getAttribute('y')).toBe('7.5');
  });
});

// ---------- normalizeTextBaselines ----------

// How far a run's ink top sits ABOVE its `y`, per baseline mode. Only the
// differences matter: the pass measures a box, forces `alphabetic`, measures
// again, and shifts by the delta.
const ASCENT_ABOVE_Y: Record<string, number> = {
  alphabetic: 8,
  central: 5,
  hanging: 0,
  'text-before-edge': 0,
  'text-after-edge': 10,
};

/**
 * jsdom lays nothing out, so `getBBox` is missing entirely — and this pass is
 * ONLY meaningful against a box that MOVES when the baseline mode changes.
 * `stubGetBBox` hands back one fixed box, so this file models the browser
 * instead: the ink top is `y` minus the mode's ascent, which is exactly the
 * relationship the pass exists to cancel out. Per-element escapes ride on data
 * attributes: `data-empty` for an unmeasurable run, `data-throw` for the
 * measure that raises (`first`, or `alphabetic` for the second one only).
 *
 * Patched onto `SVGElement`, not `SVGGraphicsElement`: jsdom implements no SVG
 * interface below `SVGElement`, so a `<text>` node never reaches the narrower
 * prototype `stubGetBBox` uses.
 */
function stubBaselineAwareBBox(): () => void {
  const proto = (globalThis as unknown as { SVGElement: { prototype: Record<string, unknown> } })
    .SVGElement.prototype;
  const had = Object.prototype.hasOwnProperty.call(proto, 'getBBox');
  const prev = proto.getBBox;
  proto.getBBox = function (this: SVGTextElement) {
    const mode = this.getAttribute('dominant-baseline') ?? 'alphabetic';
    const thrown = this.getAttribute('data-throw');
    if (thrown === 'first' || (thrown === 'alphabetic' && mode === 'alphabetic')) {
      throw new Error('not rendered');
    }
    const height = this.hasAttribute('data-empty') ? 0 : 10;
    const y = parseFloat(this.getAttribute('y') ?? '0') || 0;
    return { x: 0, y: y - (ASCENT_ABOVE_Y[mode] ?? 0), width: 20, height };
  };
  return () => {
    if (had) proto.getBBox = prev;
    else delete proto.getBBox;
  };
}

function makeSvg(texts: SVGTextElement[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  for (const t of texts) svg.appendChild(t);
  return svg;
}

const inkTop = (t: SVGTextElement): number => t.getBBox().y;

describe('normalizeTextBaselines', () => {
  let restore: (() => void) | null = null;
  afterEach(() => {
    restore?.();
    restore = null;
  });

  it('leaves every run painting where it painted, on the alphabetic baseline', () => {
    restore = stubBaselineAwareBBox();
    const central = makeText({ y: '100', 'dominant-baseline': 'central' });
    const hanging = makeText({ y: '40', 'dominant-baseline': 'hanging' });
    const before = [inkTop(central), inkTop(hanging)];

    normalizeTextBaselines(makeSvg([central, hanging]));

    // The whole contract: same ink, expressed on the baseline svg2pdf assumes.
    expect(central.getAttribute('dominant-baseline')).toBe('alphabetic');
    expect(hanging.getAttribute('dominant-baseline')).toBe('alphabetic');
    expect([inkTop(central), inkTop(hanging)]).toEqual(before);
    // …which for these two modes means moving `y` DOWN the page, not standing still.
    expect(Number(central.getAttribute('y'))).toBe(103);
    expect(Number(hanging.getAttribute('y'))).toBe(48);
  });

  it('shifts a run that carries its position on tspans', () => {
    restore = stubBaselineAwareBBox();
    const t = makeText({ y: '100', 'dominant-baseline': 'central' }, [{ y: '100' }, { dy: '14' }]);

    normalizeTextBaselines(makeSvg([t]));

    const spans = t.querySelectorAll('tspan');
    expect(spans[0].getAttribute('y')).toBe('103'); // absolute: rides the shift
    expect(spans[1].getAttribute('dy')).toBe('14'); // relative: untouched
  });

  it('drops alignment-baseline, which would otherwise re-displace the run', () => {
    restore = stubBaselineAwareBBox();
    const t = makeText({ y: '50', 'dominant-baseline': 'central', 'alignment-baseline': 'middle' });

    normalizeTextBaselines(makeSvg([t]));

    expect(t.hasAttribute('alignment-baseline')).toBe(false);
  });

  it('leaves a run already on the alphabetic baseline exactly as it was', () => {
    restore = stubBaselineAwareBBox();
    const plain = makeText({ y: '30' }); // no dominant-baseline at all
    const explicit = makeText({ y: '70', 'dominant-baseline': 'alphabetic' });

    normalizeTextBaselines(makeSvg([plain, explicit]));

    expect(plain.getAttribute('y')).toBe('30');
    expect(explicit.getAttribute('y')).toBe('70');
  });

  it('skips an unmeasurable run without touching its baseline', () => {
    restore = stubBaselineAwareBBox();
    // Zero-height (an empty run) and a getBBox that raises are the two ways a
    // measurement can fail. Both bail BEFORE the attribute rewrite, so the run
    // is left exactly as authored rather than half-converted.
    const empty = makeText({ y: '10', 'dominant-baseline': 'central', 'data-empty': '' });
    const unrendered = makeText({ y: '20', 'dominant-baseline': 'central', 'data-throw': 'first' });

    normalizeTextBaselines(makeSvg([empty, unrendered]));

    expect(empty.getAttribute('y')).toBe('10');
    expect(empty.getAttribute('dominant-baseline')).toBe('central');
    expect(unrendered.getAttribute('y')).toBe('20');
    expect(unrendered.getAttribute('dominant-baseline')).toBe('central');
  });

  it('does not guess a shift when only the second measurement fails', () => {
    restore = stubBaselineAwareBBox();
    const t = makeText({ y: '60', 'dominant-baseline': 'central', 'data-throw': 'alphabetic' });

    normalizeTextBaselines(makeSvg([t]));

    // The baseline swap has already landed; without a second measurement there
    // is no delta to apply, and a guessed one would misplace the outlines.
    expect(t.getAttribute('dominant-baseline')).toBe('alphabetic');
    expect(t.getAttribute('y')).toBe('60');
  });

  it('normalizes every run in the tree, however deeply nested', () => {
    restore = stubBaselineAwareBBox();
    const nested = makeText({ y: '90', 'dominant-baseline': 'central' });
    const g = document.createElementNS(SVG_NS, 'g');
    g.appendChild(nested);
    const svg = makeSvg([]);
    svg.appendChild(g);

    normalizeTextBaselines(svg);

    expect(nested.getAttribute('y')).toBe('93');
  });
});
