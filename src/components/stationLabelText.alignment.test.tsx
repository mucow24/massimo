import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type { Line } from '../model/types';
import { renderStationLabelText } from './stationLabelText';
import { BASELINE_FRACTION, _clearTextMeasureCache } from '../geometry/textMeasure';

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

function renderStation(
  text: string,
  textAnchor: 'start' | 'middle' | 'end',
  textDecoration: 'underline' | 'none' = 'none',
) {
  const node = renderStationLabelText({
    text,
    fontSize: CHAR,
    fontWeight: 400,
    tracking: 0.5, // ≠ 0 → per-segment path
    fill: '#000',
    textDecoration,
    anchorX: 0,
    anchorY: 0,
    textAnchor,
    baseline: 'central',
    firstLineDyPx: 0,
    firstLineCenterY: 0,
    rotationDeg: 0,
    lineByService: new Map<string, Line>(),
  });
  return render(<svg>{node}</svg>).container;
}

// First <text> x of a given rendered line, addressed by data-label-line (robust
// to empty lines, which emit no group).
const lineX = (c: HTMLElement, i: number) =>
  parseFloat(c.querySelector(`[data-label-line="${i}"] text`)!.getAttribute('x')!);

describe('renderStationLabelText — per-segment path aligns by pen advance', () => {
  it('start-anchored: an f-hook line and a flush line share the same left pen', () => {
    const c = renderStation('fx\nEx', 'start');
    expect(lineX(c, 0)).toBeCloseTo(lineX(c, 1), 5);
    expect(lineX(c, 0)).toBeCloseTo(0, 5); // penStart = anchorX for start-anchor
  });

  it('middle-anchored: both lines share the centered pen', () => {
    const c = renderStation('fx\nEx', 'middle');
    expect(lineX(c, 0)).toBeCloseTo(lineX(c, 1), 5);
    expect(lineX(c, 0)).toBeCloseTo(-CHAR, 5); // penStart = anchorX − advance/2 = −(2*CHAR)/2
  });

  it('end-anchored: a j-tail line and a flush line share the same right pen', () => {
    const c = renderStation('xj\nxy', 'end');
    expect(lineX(c, 0)).toBeCloseTo(lineX(c, 1), 5);
    expect(lineX(c, 0)).toBeCloseTo(-2 * CHAR, 5); // penStart = anchorX − advance
  });

  it('hover underline hugs the ink: x1 = penStart − bearingLeft (not penStart)', () => {
    // 'f' overhangs the pen box 3px left, so its ink starts at penStart − 3.
    // The underline must start there (not at the pen), i.e. x1 = −3, and span
    // the ink width (23 = 3 overhang + 20 advance) to x2 = 20.
    const c = renderStation('fx', 'start', 'underline');
    const line = c.querySelector('[data-label-line="0"] line')!;
    expect(line).not.toBeNull();
    expect(parseFloat(line.getAttribute('x1')!)).toBeCloseTo(-3, 5);
    expect(parseFloat(line.getAttribute('x2')!)).toBeCloseTo(20, 5);
  });
});

describe('renderStationLabelText — inline <size> tags', () => {
  // Tracking 0 here: <size=…> must route through the per-segment path on its
  // own (it's a formatting token), not only when tracking forces it.
  const renderSize = (text: string) => {
    const node = renderStationLabelText({
      text,
      fontSize: 10,
      fontWeight: 400,
      fill: '#000',
      textDecoration: 'none',
      anchorX: 0,
      anchorY: 0,
      textAnchor: 'middle',
      baseline: 'central',
      firstLineDyPx: 0,
      firstLineCenterY: 0,
      rotationDeg: 0,
      lineByService: new Map<string, Line>(),
    });
    return render(<svg>{node}</svg>).container;
  };
  const textByContent = (c: HTMLElement, content: string) =>
    Array.from(c.querySelectorAll('text')).find((t) => t.textContent === content)!;

  it('renders a <size=N> run at that size and the rest at the base size', () => {
    const c = renderSize('<size=40>big</size> base');
    expect(textByContent(c, 'big').getAttribute('font-size')).toBe('40');
    expect(textByContent(c, ' base').getAttribute('font-size')).toBe('10');
  });

  it('sits differently-sized runs on one shared baseline', () => {
    const c = renderSize('<size=6>a</size><size=40>b</size>');
    // central-anchored runs: the text baseline is y + (BASELINE_FRACTION − 0.5)·size.
    const F = BASELINE_FRACTION - 0.5;
    const baseline = (content: string, size: number) =>
      parseFloat(textByContent(c, content).getAttribute('y')!) + F * size;
    expect(baseline('a', 6)).toBeCloseTo(baseline('b', 40), 5);
  });
});
