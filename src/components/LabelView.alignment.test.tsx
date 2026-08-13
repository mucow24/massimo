import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { LabelView } from './LabelView';
import { useDoc } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { measureTextLabel, _clearTextMeasureCache } from '../geometry/textMeasure';
import { makeTextLabel } from '../test/fixtures';
import { inkOverhangMetrics, stubTextMetrics } from '../test/textMetrics';
import type { TextLabel } from '../model/types';

// The ink-overhang stub is exactly the situation the bug was about: lines whose
// first (or last) glyph overhangs the pen box by a different amount must STILL
// flush to a common, even edge.
const CHAR = 10;
stubTextMetrics(inkOverhangMetrics(CHAR, 10));

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

// Local x of the first <text> on a rendered line.
const lineX = (c: HTMLElement, i: number) =>
  parseFloat(c.querySelector(`[data-label-line="${i}"] text`)!.getAttribute('x')!);

describe('<LabelView /> — even edges regardless of per-line ink overhang', () => {
  it('left-aligns lines by pen origin, not by leftmost ink (f-hook does not indent)', () => {
    // Line 0 begins with an ink-overhanging 'f'; line 1 with a flush 'E'.
    const label = makeTextLabel({
      id: 'g1',
      x: 0,
      y: 0,
      fontSize: CHAR,
      align: 'left',
      text: 'fx\nEx',
    });
    const halfW = measureTextLabel(label).width / 2;
    const c = renderLabel(label);
    // Both lines flush to the SAME left edge (the box's left), so the visible
    // 'f' and 'E' columns line up — no letter-shape-dependent raggedness.
    expect(lineX(c, 0)).toBeCloseTo(-halfW, 5);
    expect(lineX(c, 1)).toBeCloseTo(-halfW, 5);
  });

  it('right-aligns lines by pen advance, not by rightmost ink (j-tail does not jut)', () => {
    const label = makeTextLabel({
      id: 'g1',
      x: 0,
      y: 0,
      fontSize: CHAR,
      align: 'right',
      text: 'xj\nxy',
    });
    const halfW = measureTextLabel(label).width / 2;
    const c = renderLabel(label);
    // Right-aligned lines share the same right edge: pen x = halfW − advance.
    // Both words advance 2*CHAR, so both start at the same x.
    expect(lineX(c, 0)).toBeCloseTo(lineX(c, 1), 5);
    expect(lineX(c, 0)).toBeCloseTo(halfW - 2 * CHAR, 5);
  });

  it('centers lines by pen advance, not by ink midpoint', () => {
    const label = makeTextLabel({
      id: 'g1',
      x: 0,
      y: 0,
      fontSize: CHAR,
      align: 'center',
      text: 'fx\nEx',
    });
    const c = renderLabel(label);
    // Equal advances ⇒ identical centered pen x, independent of the f-hook.
    expect(lineX(c, 0)).toBeCloseTo(lineX(c, 1), 5);
    expect(lineX(c, 0)).toBeCloseTo(-CHAR, 5); // −advance/2 = −(2*CHAR)/2
  });

  it('justifies an interior f-hook line from the box left edge (pen, not ink)', () => {
    // Line 0 'fx yy' is interior (justified); line 1 is the wider, ragged last
    // line. The justified line's first word must start at the box left edge,
    // NOT -halfW + bearingLeft — that was the ragged-edge bug for justify.
    const label = makeTextLabel({
      id: 'g1',
      x: 0,
      y: 0,
      fontSize: CHAR,
      align: 'justify',
      text: 'fx yy\nzzzzzzzz',
    });
    const halfW = measureTextLabel(label).width / 2;
    const c = renderLabel(label);
    const line0 = Array.from(c.querySelectorAll('[data-label-line="0"] text'));
    expect(line0.map((t) => t.textContent)).toEqual(['fx', 'yy']);
    const x0 = parseFloat(line0[0].getAttribute('x')!);
    const xLast = parseFloat(line0[1].getAttribute('x')!);
    expect(x0).toBeCloseTo(-halfW, 5); // first word pen at the left edge (not -halfW+3)
    expect(xLast + 2 * CHAR).toBeCloseTo(halfW, 5); // last word advance-right flush right
  });
});
