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
  it('a stroke edit adds the casing live and leaves band geometry untouched', () => {
    render(<App />);
    seedInterlinedPair();

    expect(distinctBandKeys()).toBe(1);
    expect(casingEls('L1')).toHaveLength(0);
    const dBefore = stripeD('L1');
    expect(dBefore).toBeTruthy();

    act(() => {
      useDoc.getState().setLineStrokeWidth('L1', 4);
    });

    // One casing silhouette appears (body 14 + railW 4 = 18 wide, default
    // white), plus the marker casings (both stops are termini: 3 each = 6).
    const casing = casingEls('L1');
    expect(casing).toHaveLength(1);
    expect(casing[0].getAttribute('stroke-width')).toBe('18');
    expect(casing[0].getAttribute('stroke')).toBe('#ffffff');
    expect(markerCasingEls('L1')).toHaveLength(6);
    // The bare line is untouched.
    expect(casingEls('L2')).toHaveLength(0);
    expect(markerCasingEls('L2')).toHaveLength(0);

    // …and geometry didn't rebuild: same band key count, byte-identical body
    // path (only its stroke-WIDTH insets — the `d` is stroke-independent).
    expect(distinctBandKeys()).toBe(1);
    expect(stripeD('L1')).toBe(dBefore);

    // Color edit repaints the casing in place.
    act(() => {
      useDoc.getState().setLineStrokeColor('L1', '#ff0000');
    });
    expect(casingEls('L1')[0].getAttribute('stroke')).toBe('#ff0000');

    // Half-step widths render as-is (14 + 1.5 = 15.5).
    act(() => {
      useDoc.getState().setLineStrokeWidth('L1', 1.5);
    });
    expect(casingEls('L1')[0].getAttribute('stroke-width')).toBe('15.5');

    // Back to 0 removes the casing.
    act(() => {
      useDoc.getState().setLineStrokeWidth('L1', 0);
    });
    expect(casingEls('L1')).toHaveLength(0);
    expect(markerCasingEls('L1')).toHaveLength(0);
  });

  it('the casing silhouette paints just before its own body — never on a neighbor', () => {
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
    // L2 (back, no casing) body; then L1's casing silhouette immediately
    // followed by L1's body — the silhouette (priority + ε) sits just behind
    // its own body, never between another line's body and casing.
    expect(order).toEqual(['stripe:L2', 'casing:L1', 'stripe:L1']);
  });

  it('the line-highlight overlay repaints the selected line’s casing above the dim', () => {
    render(<App />);
    seedInterlinedPair();
    act(() => {
      useDoc.getState().setLineStrokeWidth('L1', 4);
    });
    // Overlay silhouettes carry no data attrs; count them by signature — an
    // 18-wide white OPEN band path (the terminus arrow casing is also 18 wide
    // but a closed 'Z' triangle, so exclude those).
    const bandSilhouettes = () =>
      Array.from(document.querySelectorAll('path')).filter(
        (p) =>
          p.getAttribute('stroke-width') === '18' &&
          p.getAttribute('stroke') === '#ffffff' &&
          !p.getAttribute('d')?.includes('Z'),
      ).length;
    expect(markerCasingEls('L1')).toHaveLength(6);
    expect(bandSilhouettes()).toBe(1); // main layer only

    act(() => {
      useSelection.getState().selectLine('L1');
    });
    expect(bandSilhouettes()).toBe(2); // main + overlay copy
    // Highlight copies: s1 repaints rails + cap (3), but s2 — the arrow
    // tip (the display-tail terminus) — suppresses its cap (2): the cased
    // arrowhead is the line's end.
    expect(markerCasingEls('L1')).toHaveLength(11);

    // The terminus arrowhead is cased too: an underlay copy fattened by 2× the
    // stroke width (10 + 2*4 = 18) in the stroke color — a closed triangle.
    const arrowCasing = Array.from(document.querySelectorAll('path')).filter(
      (p) =>
        p.getAttribute('stroke-width') === '18' &&
        p.getAttribute('stroke') === '#ffffff' &&
        p.getAttribute('d')?.includes('Z'),
    );
    expect(arrowCasing.length).toBe(1);
  });
});
