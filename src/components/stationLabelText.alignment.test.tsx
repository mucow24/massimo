import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type { Line } from '../model/types';
import { renderStationLabelText } from './stationLabelText';
import { _clearTextMeasureCache } from '../geometry/textMeasure';

// Same fake-canvas trick as LabelView.alignment: report ink that overhangs the
// pen box for hooked/tailed glyphs, so we can prove multi-line station labels
// flush by pen advance (even edge) rather than by raw ink (ragged). Tracking is
// set non-zero to route through the per-segment renderer (the only station path
// that positions each line explicitly; the plain <tspan> path already flushes by
// text-anchor).
const CHAR = 10;
function fakeMeasureText(s: string) {
  const advance = s.length * CHAR;
  const hasInk = s.trim().length > 0;
  const leftOver = hasInk && s.trimStart().startsWith('f') ? 3 : 0;
  const rightOver = hasInk && s.trimEnd().endsWith('j') ? 3 : 0;
  return {
    width: advance,
    actualBoundingBoxLeft: leftOver,
    actualBoundingBoxRight: hasInk ? advance + rightOver : 0,
  };
}

let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
beforeAll(() => {
  originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function () {
    return { font: '', measureText: fakeMeasureText } as unknown as CanvasRenderingContext2D;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
});
afterAll(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});
beforeEach(() => _clearTextMeasureCache());

// Render the per-segment station-label text and return the first <text> x of
// each rendered line (the line groups are the direct children of the outer g).
function lineXs(text: string, textAnchor: 'start' | 'middle' | 'end') {
  const node = renderStationLabelText({
    text,
    fontSize: CHAR,
    fontWeight: 400,
    tracking: 0.5, // ≠ 0 → per-segment path
    fill: '#000',
    textDecoration: 'none',
    anchorX: 0,
    anchorY: 0,
    textAnchor,
    baseline: 'central',
    firstLineDyPx: 0,
    firstLineCenterY: 0,
    rotationDeg: 0,
    lineByService: new Map<string, Line>(),
  });
  const { container } = render(<svg>{node}</svg>);
  const outer = container.querySelector('svg > g')!;
  return Array.from(outer.children).map((g) =>
    parseFloat(g.querySelector('text')!.getAttribute('x')!),
  );
}

describe('renderStationLabelText — per-segment path aligns by pen advance', () => {
  it('start-anchored: an f-hook line and a flush line share the same left pen', () => {
    const [x0, x1] = lineXs('fx\nEx', 'start');
    expect(x0).toBeCloseTo(x1, 5);
    expect(x0).toBeCloseTo(0, 5); // penStart = anchorX for start-anchor
  });

  it('end-anchored: a j-tail line and a flush line share the same right pen', () => {
    const [x0, x1] = lineXs('xj\nxy', 'end');
    expect(x0).toBeCloseTo(x1, 5);
    expect(x0).toBeCloseTo(-2 * CHAR, 5); // penStart = anchorX − advance
  });
});
