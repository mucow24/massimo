import { beforeEach, describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import App from '../App';
import { useDoc } from '../state/store';
import { useSelection } from '../state/selection';
import { DEFAULT_DOC } from '../model/transforms';
import type { Line, Station } from '../model/types';
import { makeLine } from '../test/fixtures';

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
});

const label: Station['label'] = {
  row: 0,
  col: -1,
  rotation: 0,
  offset: 0,
  align: 'auto',
  valign: 'middle',
};

// Legacy interlined pair: L1 and L2 horizontal through the same two stations,
// stops one row apart (tangent at the default width).
const seedInterlinedPair = () => {
  const stops: Station['stops'] = [
    { lineId: 'L1', row: 0, col: 0, orientation: 'auto-horizontal' },
    { lineId: 'L2', row: 1, col: 0, orientation: 'auto-horizontal' },
  ];
  const s1: Station = { id: 's1', name: 'S1', x: 0, y: 0, rotation: 0, stops, label };
  const s2: Station = { id: 's2', name: 'S2', x: 200, y: 0, rotation: 0, stops, label };
  const mkLine = (id: string, color: string): Line =>
    makeLine({
      id,
      service: id,
      name: `${id} line`,
      color,
      stations: ['s1', 's2'],
    });
  act(() => {
    useDoc.setState({
      ...useDoc.getState(),
      stations: { s1, s2 },
      lines: { L1: mkLine('L1', '#0039A6'), L2: mkLine('L2', '#EE352E') },
      lineOrder: ['L1', 'L2'],
    });
  });
};

const stripeEls = () => Array.from(document.querySelectorAll('[data-band-stripe]'));
const distinctBandKeys = () =>
  new Set(stripeEls().map((el) => el.getAttribute('data-band-key'))).size;
const stripeD = (lineId: string) =>
  document.querySelector(`[data-band-stripe][data-line-id="${lineId}"]`)?.getAttribute('d');
const stripeStroke = (lineId: string) =>
  document.querySelector(`[data-band-stripe][data-line-id="${lineId}"]`)?.getAttribute('stroke');

describe('MapCanvas — width edits rebuild band geometry', () => {
  // Width is GEOMETRY (it moves the baked stripe paths and changes band
  // merging), unlike color/style which are render-time. The bandsGeometry
  // memo is keyed on linesGeometrySig — if that signature omits width, a
  // width edit silently never repaints the canvas until some unrelated
  // geometry edit happens. This is the regression this file pins.
  it('a width edit re-merges bands live (no reload, no unrelated edit)', () => {
    render(<App />);
    seedInterlinedPair();

    // Starts merged: two stripes sharing one band key.
    expect(stripeEls()).toHaveLength(2);
    expect(distinctBandKeys()).toBe(1);
    const dBefore = stripeD('L1');
    expect(dBefore).toBeTruthy();

    // Widening L2 breaks the 14-unit tangency (now needs 21) → the band must
    // SPLIT into two singletons. (Pre-fix, linesGeometrySig omitted width and
    // the canvas kept painting the stale merged band — this assertion is the
    // regression catch.)
    act(() => {
      useDoc.getState().setLineWidth('L2', 28);
    });
    expect(distinctBandKeys()).toBe(2);

    // …and L1's painted path is byte-identical through the split: offsets are
    // mean-centered tangency positions, so every stripe lands exactly on its
    // stop regardless of band membership. A straight corridor's paths never
    // move under width edits — only grouping and stroke widths do.
    expect(stripeD('L1')).toBe(dBefore);
  });

  it('a COLOR edit repaints the stripe live but never moves band geometry (E5d)', () => {
    // Inverse of the width-rebuild test: color is PRESENTATION (resolved live
    // from the lines map at render time), not geometry. A color edit must
    // repaint the stripe's stroke while the baked paths AND band merging stay
    // byte-identical — the geometry memo (keyed on the color-free
    // linesGeometrySig) must NOT rebuild.
    render(<App />);
    seedInterlinedPair();

    // Starts merged; L1 paints in its seed color.
    expect(distinctBandKeys()).toBe(1);
    const dBefore = stripeD('L1');
    expect(dBefore).toBeTruthy();
    expect(stripeStroke('L1')).toBe('#0039A6');

    act(() => {
      useDoc.getState().updateLine('L1', { color: '#00aa55' });
    });

    // The new color paints immediately (live presentation repaint).
    expect(stripeStroke('L1')).toBe('#00aa55');
    // …and geometry is untouched: same band-key count, byte-identical path.
    expect(distinctBandKeys()).toBe(1);
    expect(stripeD('L1')).toBe(dBefore);
    // The interlined neighbor's geometry is likewise undisturbed.
    expect(stripeStroke('L2')).toBe('#EE352E');
  });

  it('the line-highlight overlay strokes the selected line at its own width', () => {
    render(<App />);
    seedInterlinedPair();
    act(() => {
      useDoc.getState().setLineWidth('L2', 28);
    });

    const count28 = () =>
      Array.from(document.querySelectorAll('path')).filter(
        (p) => p.getAttribute('stroke-width') === '28',
      ).length;
    const before = count28(); // the band stripe alone
    expect(before).toBeGreaterThanOrEqual(1);

    // Selecting the line mounts HighlightedLineLayer, which repaints the
    // line's stripes on top — those copies must carry the per-stripe width,
    // not the legacy hardcoded 14.
    act(() => {
      useSelection.getState().selectLine('L2');
    });
    expect(count28()).toBeGreaterThan(before);
  });
});
