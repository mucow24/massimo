import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { LabelView } from '../components/LabelView';
import { useDoc } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { measureTextLabel, _clearTextMeasureCache } from '../geometry/textMeasure';
import { inlineBulletDiameter } from '../geometry/labelTokens';
import { makeTextLabel } from '../test/fixtures';
import type { TextLabel } from '../model/types';

/**
 * the measured box is sized by INK (`boxWidth = max(inkWidth)`,
 * textMeasure.ts:491) but each line's pen origin is derived from the pen
 * ADVANCE (`lineCursorX`, LabelView.tsx:55-60). The advance carries one
 * trailing letter-spacing step past the last glyph (that is how CSS/Chromium
 * letter-spacing works, and the measurer models it on purpose — see the
 * `d + letterSpacingPx` bullet advance and `approximateLineWidth`). Runs are
 * drawn with textAnchor="start" at an explicit x, so that trailing step would
 * be dead space if alignment measured ink. Alignment uses the ADVANCE on both
 * sides (alignAdvance), so the trailing step cancels and a right/center-aligned
 * line's tracked glyphs stay inside their own measured bbox — which is what the
 * assertions below pin.
 */

// ---------------------------------------------------------------------------
// Chromium-faithful measureText stub (used ONLY by the text-run cases below).
// Per-character advance CHAR, no side bearings, letter-spacing added AFTER
// every character (including the last) — exactly the model textMeasure.ts
// documents at lines 205-210 and 325-328.
const CHAR = 10;
let spacingPx = 0;
const fakeCtx = {
  font: '',
  get letterSpacing() {
    return `${spacingPx}px`;
  },
  set letterSpacing(v: string) {
    spacingPx = parseFloat(v) || 0;
  },
  measureText(s: string) {
    const n = s.length;
    if (n === 0) return { width: 0, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 };
    return {
      // Pen advance: one spacing step after EVERY character, last one included.
      width: n * (CHAR + spacingPx),
      // Ink: starts at the pen origin, stops at the last glyph — the trailing
      // spacing step is not ink.
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: n * CHAR + (n - 1) * spacingPx,
    };
  },
};

let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
beforeAll(() => {
  originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function () {
    return fakeCtx as unknown as CanvasRenderingContext2D;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
});
afterAll(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});
beforeEach(() => {
  _clearTextMeasureCache();
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.setState({ darkMode: false });
});

const renderLabel = (label: TextLabel) =>
  render(
    <svg>
      <LabelView label={label} selected={false} />
    </svg>,
  ).container;

const lineX = (c: HTMLElement, i: number) =>
  parseFloat(c.querySelector(`[data-label-line="${i}"] text`)!.getAttribute('x')!);

// Local x of the rendered inline bullet's CENTER (InlineBullet wraps itself in
// translate(cx cy)).
const bulletCx = (c: HTMLElement) => {
  const t = c.querySelector('[data-inline-bullet]')!.getAttribute('transform')!;
  return parseFloat(/translate\(\s*(-?[\d.]+)/.exec(t)![1]);
};

describe('tracked label: drawn ink vs the measured bbox it is selected/hit by', () => {
  // ---- Canvas-free proof -------------------------------------------------
  // An inline bullet needs NO canvas: its advance is `diameter + letterSpacing`
  // and its ink extent is exactly `diameter` (textMeasure.ts:324-329, 351).
  // So this case is independent of any measureText stub.
  it('right-aligned tracked bullet line: bullet sits inside the box it is measured as', () => {
    const label = makeTextLabel({
      id: 'g1',
      x: 0,
      y: 0,
      fontSize: 24,
      align: 'right',
      tracking: 0.5, // TEXT_LABEL_TRACKING_MAX → letterSpacing = 12
      text: '|A|',
    });
    const m = measureTextLabel(label);
    const d = inlineBulletDiameter(24);
    // Sanity: the box is exactly the bullet's ink — measured with no canvas.
    expect(m.width).toBeCloseTo(d, 10);

    const halfW = m.width / 2;
    const c = renderLabel(label);
    const inkRight = bulletCx(c) + d / 2;
    const inkLeft = bulletCx(c) - d / 2;
    // The glyph ink must live inside the bbox that sizes the dashed selection
    // ring, the hit rect, and the exported AABB. Right-aligned ⇒ its right edge
    // IS the box's right edge.
    expect(inkRight).toBeCloseTo(halfW, 5);
    expect(inkLeft).toBeCloseTo(-halfW, 5);
  });

  it('CONTROL — untracked bullet line is flush (isolates tracking as the cause)', () => {
    const label = makeTextLabel({
      id: 'g1',
      x: 0,
      y: 0,
      fontSize: 24,
      align: 'right',
      text: '|A|',
    });
    const m = measureTextLabel(label);
    const d = inlineBulletDiameter(24);
    const halfW = m.width / 2;
    const c = renderLabel(label);
    expect(bulletCx(c) + d / 2).toBeCloseTo(halfW, 5);
  });

  // ---- Real text runs ----------------------------------------------------
  it('right-aligned tracked text: rightmost ink lands on the box right edge', () => {
    const label = makeTextLabel({
      id: 'g1',
      x: 0,
      y: 0,
      fontSize: 24,
      align: 'right',
      tracking: 0.5,
      text: 'abc',
    });
    const m = measureTextLabel(label);
    const halfW = m.width / 2;
    const c = renderLabel(label);
    // bearingRight is the measurer's OWN "cursor → rightmost ink" distance, so
    // this adds no assumption beyond the stub already used to measure.
    const inkRight = lineX(c, 0) + m.lines[0].bearingRight;
    expect(inkRight).toBeCloseTo(halfW, 5);
  });

  it('center-aligned tracked text: ink midpoint lands on the box midpoint', () => {
    const label = makeTextLabel({
      id: 'g1',
      x: 0,
      y: 0,
      fontSize: 24,
      align: 'center',
      tracking: 0.5,
      text: 'abc',
    });
    const m = measureTextLabel(label);
    const c = renderLabel(label);
    const x = lineX(c, 0);
    const inkMid = x + (-m.lines[0].bearingLeft + m.lines[0].bearingRight) / 2;
    expect(inkMid).toBeCloseTo(0, 5);
  });
});
