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
const casingEls = (lineId: string) =>
  Array.from(document.querySelectorAll(`[data-band-casing][data-line-id="${lineId}"]`));
const markerCasingEls = (lineId: string) =>
  Array.from(document.querySelectorAll(`[data-marker-casing][data-line-id="${lineId}"]`));

describe('MapCanvas — stroke edits repaint without a geometry rebuild', () => {
  // Stroke is PRESENTATION (unlike width): it must repaint through the live
  // lines map while the band geometry — paths, band keys, merging — stays
  // byte-identical. This is the inverse of the width regression test.
  it('a stroke edit adds the rails live and leaves band geometry untouched', () => {
    render(<App />);
    seedInterlinedPair();

    expect(distinctBandKeys()).toBe(1);
    expect(casingEls('L1')).toHaveLength(0);
    const dBefore = stripeD('L1');
    expect(dBefore).toBeTruthy();

    act(() => {
      useDoc.getState().setLineStrokeWidth('L1', 4);
    });

    // Rails appear: two 4-wide paths inside the body in the default white,
    // plus two marker rails per stop (2 stops).
    const rails = casingEls('L1');
    expect(rails).toHaveLength(2);
    for (const c of rails) {
      expect(c.getAttribute('stroke-width')).toBe('4');
      expect(c.getAttribute('stroke')).toBe('#ffffff');
    }
    // The rails flank the body centerline on distinct offset paths. Both
    // stations of a two-stop line are termini: 2 side rails + 1 end cap
    // per marker.
    expect(rails[0].getAttribute('d')).not.toBe(rails[1].getAttribute('d'));
    expect(markerCasingEls('L1')).toHaveLength(6);
    // The bare line is untouched.
    expect(casingEls('L2')).toHaveLength(0);
    expect(markerCasingEls('L2')).toHaveLength(0);

    // …and geometry didn't rebuild: same band key count, byte-identical path.
    expect(distinctBandKeys()).toBe(1);
    expect(stripeD('L1')).toBe(dBefore);

    // Color edit repaints the rails in place.
    act(() => {
      useDoc.getState().setLineStrokeColor('L1', '#ff0000');
    });
    expect(casingEls('L1')[0].getAttribute('stroke')).toBe('#ff0000');

    // Half-step widths render as-is.
    act(() => {
      useDoc.getState().setLineStrokeWidth('L1', 1.5);
    });
    expect(casingEls('L1')[0].getAttribute('stroke-width')).toBe('1.5');

    // Back to 0 removes every rail.
    act(() => {
      useDoc.getState().setLineStrokeWidth('L1', 0);
    });
    expect(casingEls('L1')).toHaveLength(0);
    expect(markerCasingEls('L1')).toHaveLength(0);
  });

  it('the rails paint immediately after their own body — never on a neighbor', () => {
    render(<App />);
    seedInterlinedPair();
    act(() => {
      useDoc.getState().setLineStrokeWidth('L1', 3);
    });

    const order = Array.from(
      document.querySelectorAll('[data-band-stripe], [data-band-casing]'),
    ).map(
      (el) =>
        (el.hasAttribute('data-band-casing') ? 'casing:' : 'stripe:') +
        el.getAttribute('data-line-id'),
    );
    // Inside rails ride their own body: L2 (back) paints, then L1's body
    // immediately followed by L1's rails. No cross-line interleaving.
    expect(order).toEqual(['stripe:L2', 'stripe:L1', 'casing:L1', 'casing:L1']);
  });

  it('the line-highlight overlay repaints the selected line’s rails above the dim', () => {
    render(<App />);
    seedInterlinedPair();
    act(() => {
      useDoc.getState().setLineStrokeWidth('L1', 4);
    });
    // Band rails carry data attrs only in the main pass; count the highlight
    // copies via marker rails (StopMarker emits them in both layers) and via
    // 4-wide white paths for the stripes.
    expect(markerCasingEls('L1')).toHaveLength(6);
    const railPathCount = () =>
      Array.from(document.querySelectorAll('path')).filter(
        (p) => p.getAttribute('stroke-width') === '4' && p.getAttribute('stroke') === '#ffffff',
      ).length;
    const before = railPathCount();
    expect(before).toBe(2);

    act(() => {
      useSelection.getState().selectLine('L1');
    });
    expect(railPathCount()).toBe(4);
    // Highlight copies: s1 repaints rails + cap (3), but s2 — the arrow
    // tip — suppresses its cap (2): the cased arrowhead is the line's end.
    expect(markerCasingEls('L1')).toHaveLength(11);

    // The terminus arrowhead is cased too: an underlay copy fattened by
    // 2× the stroke width (10 + 2*4 = 18) in the stroke color.
    const arrowCasing = Array.from(document.querySelectorAll('path')).filter(
      (p) => p.getAttribute('stroke-width') === '18' && p.getAttribute('stroke') === '#ffffff',
    );
    expect(arrowCasing.length).toBe(1);
  });
});
