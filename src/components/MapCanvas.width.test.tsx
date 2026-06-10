import { beforeEach, describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import App from '../App';
import { useDoc } from '../state/store';
import { useSelection } from '../state/selection';
import { DEFAULT_DOC } from '../model/transforms';
import type { Line, Station } from '../model/types';

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
  const mkLine = (id: string, color: string): Line => ({
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
