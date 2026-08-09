import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { LabelView } from './LabelView';
import { renderStationLabelText } from './stationLabelText';
import { useDoc } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { makeTextLabel } from '../test/fixtures';

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC, darkMode: false });
});

const FONT_SIZE = 20;

/**
 * The rule's offset from the baseline it hangs off, and its weight — the whole
 * of what a decoration's geometry IS. Measured against the run's own `<text>`
 * y (which IS the shared alphabetic baseline both renderers place runs on), so
 * the numbers are comparable across two renderers that sit their labels at
 * completely different y.
 */
function decorationGeometry(c: HTMLElement) {
  const runY = parseFloat(c.querySelector('text')!.getAttribute('y')!);
  const read = (kind: 'underline' | 'strike') => {
    const el = c.querySelector(`line[data-text-decoration="${kind}"]`)!;
    return {
      dy: parseFloat(el.getAttribute('y1')!) - runY,
      thickness: parseFloat(el.getAttribute('stroke-width')!),
    };
  };
  return { underline: read('underline'), strike: read('strike') };
}

const renderFreeLabel = () =>
  render(
    <svg>
      <LabelView
        label={makeTextLabel({ id: 'g1', text: '<u>u</u><s>s</s>', fontSize: FONT_SIZE })}
        selected={false}
      />
    </svg>,
  ).container;

const renderStationName = () =>
  render(
    <svg>
      {renderStationLabelText({
        text: '<u>u</u><s>s</s>',
        fontSize: FONT_SIZE,
        fontWeight: 400,
        fill: '#111111',
        textDecoration: 'none',
        anchorX: 0,
        anchorY: 0,
        textAnchor: 'start',
        firstLineCenterY: 0,
        rotationDeg: 0,
        lineByService: new Map(),
      })}
    </svg>,
  ).container;

// The two renderers that paint label text — LabelView (free text labels) and
// renderStationLabelText (station names) — must draw an inline <u>/<s> rule
// identically: same drop below (or rise above) the run's baseline, same weight.
// A `<u>` reads the same wherever it is typed, and the PDF export walks both
// renderers' emitted <line>s with one rule.
describe('inline <u>/<s> rule geometry', () => {
  it('is identical between the free-label and station-name renderers', () => {
    const station = decorationGeometry(renderStationName());
    const free = decorationGeometry(renderFreeLabel());
    // Close-to rather than equal: each renderer reaches its baseline by its own
    // arithmetic, so the two land ~1e-15 apart. Nine places is far tighter than
    // any change to the ratios themselves could hide in.
    expect(station.underline.dy).toBeCloseTo(free.underline.dy, 9);
    expect(station.strike.dy).toBeCloseTo(free.strike.dy, 9);
    expect(station.underline.thickness).toBeCloseTo(free.underline.thickness, 9);
    expect(station.strike.thickness).toBeCloseTo(free.strike.thickness, 9);
  });

  it('hangs the underline below and the strike above the run baseline, scaled by run size', () => {
    const g = decorationGeometry(renderFreeLabel());
    expect(g.underline.dy).toBeCloseTo(FONT_SIZE * 0.1, 6);
    expect(g.strike.dy).toBeCloseTo(-FONT_SIZE * 0.28, 6);
    expect(g.underline.thickness).toBeCloseTo(FONT_SIZE * 0.07, 6);
    expect(g.strike.thickness).toBeCloseTo(FONT_SIZE * 0.07, 6);
  });
});
