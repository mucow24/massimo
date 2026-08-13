import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { LabelView } from './LabelView';
import { useDoc } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { measureTextLabel, _clearTextMeasureCache } from '../geometry/textMeasure';
import { makeTextLabel } from '../test/fixtures';
import { stubTextMetrics, whitespaceAwareMetrics } from '../test/textMetrics';
import type { TextLabel } from '../model/types';

// Fixed 10px glyphs so every line's ink width === length * 10 and justify
// offsets are exact.
const CHAR = 10;
stubTextMetrics(whitespaceAwareMetrics(CHAR, 10));

beforeEach(() => {
  _clearTextMeasureCache();
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.setState({ darkMode: false });
});

function lineTexts(container: HTMLElement, i: number) {
  return Array.from(container.querySelectorAll(`[data-label-line="${i}"] text`));
}
const renderLabel = (label: TextLabel) =>
  render(
    <svg>
      <LabelView label={label} selected={false} />
    </svg>,
  ).container;

describe('<LabelView /> — justify', () => {
  it('splits an interior narrower line into words flush to both box edges', () => {
    const label = makeTextLabel({
      id: 'g1',
      x: 0,
      y: 0,
      fontSize: 10,
      align: 'justify',
      text: 'aa bb\naaaa bbbb cccc',
    });
    const halfW = measureTextLabel(label).width / 2; // widest line = 14 * 10 = 140 → 70
    const c = renderLabel(label);

    const line0 = lineTexts(c, 0);
    expect(line0.map((t) => t.textContent)).toEqual(['aa', 'bb']);
    const x0 = parseFloat(line0[0].getAttribute('x')!);
    const xLast = parseFloat(line0[1].getAttribute('x')!);
    expect(x0).toBeCloseTo(-halfW, 5); // first ink flush left
    expect(xLast + CHAR * 2).toBeCloseTo(halfW, 5); // last word right edge flush right

    // The widest/last line is left as one run (never justified).
    const line1 = lineTexts(c, 1);
    expect(line1.map((t) => t.textContent)).toEqual(['aaaa bbbb cccc']);
  });

  it('does not justify a single-line label (it is its own last line)', () => {
    const c = renderLabel(
      makeTextLabel({ id: 'g1', fontSize: 10, align: 'justify', text: 'aa bb cc' }),
    );
    expect(lineTexts(c, 0).map((t) => t.textContent)).toEqual(['aa bb cc']);
  });

  it('draws one continuous underline across an underlined run on a justified line', () => {
    // '<u>aa bb</u>' on the narrower interior line: the words spread to both
    // edges, but the underline spans the whole run (spaces included), not one
    // segment per word.
    const label = makeTextLabel({
      id: 'g1',
      x: 0,
      y: 0,
      fontSize: 10,
      align: 'justify',
      text: '<u>aa bb</u>\naaaa bbbb cccc',
    });
    const halfW = measureTextLabel(label).width / 2; // widest line 140 → 70
    const c = renderLabel(label);
    const unders = c.querySelectorAll(
      '[data-label-line="0"] line[data-text-decoration="underline"]',
    );
    expect(unders).toHaveLength(1);
    expect(parseFloat(unders[0].getAttribute('x1')!)).toBeCloseTo(-halfW, 5);
    expect(parseFloat(unders[0].getAttribute('x2')!)).toBeCloseTo(halfW, 5);
  });

  it('keeps two separately-underlined words as two underlines on a justified line', () => {
    // '<u>aa</u> <u>bb</u>' — the space between them is NOT underlined, so the
    // two runs stay distinct (bridging them would underline the bare gap).
    const c = renderLabel(
      makeTextLabel({
        id: 'g1',
        fontSize: 10,
        align: 'justify',
        text: '<u>aa</u> <u>bb</u>\naaaa bbbb cccc',
      }),
    );
    expect(
      c.querySelectorAll('[data-label-line="0"] line[data-text-decoration="underline"]'),
    ).toHaveLength(2);
  });

  it('renders a <size> word on a justified interior line at its resolved size', () => {
    // Interior (narrower) line carries a resized word; it still justifies to both
    // edges, and the justify atom path must render that word at font-size 20 while
    // its neighbour stays at the base 10. (The fake canvas ignores size for
    // advance, so this pins the rendered size attribute, not the spread geometry.)
    const label = makeTextLabel({
      id: 'g1',
      x: 0,
      y: 0,
      fontSize: 10,
      align: 'justify',
      text: '<size=20>aa</size> bb\naaaa bbbb cccc',
    });
    const c = renderLabel(label);
    const line0 = lineTexts(c, 0);
    expect(line0.find((t) => t.textContent === 'aa')!.getAttribute('font-size')).toBe('20');
    expect(line0.find((t) => t.textContent === 'bb')!.getAttribute('font-size')).toBe('10');
  });

  it('wraps to a column and justifies interior wrapped lines', () => {
    const label = makeTextLabel({
      id: 'g1',
      x: 0,
      y: 0,
      fontSize: 10,
      align: 'justify',
      width: 60,
      text: 'aa bb ccccc',
    });
    const c = renderLabel(label);
    // Wrapped into ['aa bb', 'ccccc'].
    const line0 = lineTexts(c, 0);
    expect(line0.map((t) => t.textContent)).toEqual(['aa', 'bb']);
    expect(parseFloat(line0[0].getAttribute('x')!)).toBeCloseTo(-30, 5);
    expect(parseFloat(line0[1].getAttribute('x')!) + CHAR * 2).toBeCloseTo(30, 5);
    // Last wrapped line of the paragraph stays ragged (one run).
    expect(lineTexts(c, 1).map((t) => t.textContent)).toEqual(['ccccc']);
  });
});
