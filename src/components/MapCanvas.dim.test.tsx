import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import App from '../App';
import { useDoc } from '../state/store';
import { useSelection } from '../state/selection';
import { useViewportStore } from '../state/viewportStore';
import { DEFAULT_DOC } from '../model/transforms';
import type { Line, Station } from '../model/types';

// jsdom reports clientWidth/clientHeight as 0, which would collapse the canvas
// viewBox to 0×0 and make every geometry assertion vacuous. Give the canvas
// host a real size for the duration of these tests, restoring the original
// descriptors afterward.
const sizeProps = ['clientWidth', 'clientHeight'] as const;
const originals: Partial<Record<(typeof sizeProps)[number], PropertyDescriptor>> = {};
beforeEach(() => {
  for (const prop of sizeProps) {
    originals[prop] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
  }
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 600 });
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
  useViewportStore.setState({ x: 0, y: 0, zoom: 1 });
});
afterEach(() => {
  for (const prop of sizeProps) {
    const d = originals[prop];
    if (d) Object.defineProperty(HTMLElement.prototype, prop, d);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
  }
});

const label: Station['label'] = {
  row: 0,
  col: -1,
  rotation: 0,
  offset: 0,
  align: 'auto',
  valign: 'middle',
};

const seedLine = () => {
  const stops: Station['stops'] = [
    { lineId: 'L1', row: 0, col: 0, orientation: 'auto-horizontal' },
  ];
  const s1: Station = { id: 's1', name: 'S1', x: 0, y: 0, rotation: 0, stops, label };
  const s2: Station = { id: 's2', name: 'S2', x: 200, y: 0, rotation: 0, stops, label };
  const L1: Line = {
    id: 'L1',
    service: 'L1',
    name: 'L1 line',
    color: '#0039A6',
    stations: ['s1', 's2'],
  };
  act(() => {
    useDoc.setState({
      ...useDoc.getState(),
      stations: { s1, s2 },
      lines: { L1 },
      lineOrder: ['L1'],
    });
  });
};

const box = (el: Element) => ({
  x: Number(el.getAttribute('x')),
  y: Number(el.getAttribute('y')),
  w: Number(el.getAttribute('width')),
  h: Number(el.getAttribute('height')),
});

describe('MapCanvas — the line-highlight dim wash survives imperative-viewBox gestures', () => {
  // Regression: PR #109 made pan/zoom write the viewBox imperatively without a
  // re-render until the gesture settles. Full-viewport overlays must be drawn
  // overdrawn (one viewport-width in every direction, like the background rect)
  // or a zoom-out reveals the old, smaller dark bounds before the commit. The
  // dim wash was the one overlay still drawn at the exact (1×) committed viewBox.
  it('covers the same overdrawn extent as the background rect', () => {
    render(<App />);
    seedLine();
    act(() => {
      useSelection.getState().selectLine('L1');
    });

    // The committed (1×) viewBox React last rendered onto the map <svg> (the one
    // that owns the background rect — not some unrelated icon svg in the chrome).
    const svg = document.querySelector('[data-bg]')!.closest('svg')!;
    const [cx, cy, cw, ch] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    // Sanity: the size stub took, so the assertions below aren't vacuous.
    expect(cw).toBeGreaterThan(0);

    const dim = box(document.querySelector('[data-dim]')!);
    const bg = box(document.querySelector('[data-bg]')!);

    // The dim wash is overdrawn one viewport-width/height in every direction —
    // identical to the background fill, not the bare 1× committed viewBox.
    expect(dim).toEqual(bg);
    expect(dim).toEqual({ x: cx - cw, y: cy - ch, w: cw * 3, h: ch * 3 });
  });

  // The dim strength is theme-driven (ThemeColors.dim/dimOpacity): light mode
  // is deliberately softer so the rest of the map stays readable as context;
  // the black canvas keeps the stronger wash. This pins the WIRING — the
  // token values alone are pinned in theme.test.ts.
  it('dims softer in light mode than in dark (theme-driven, not hardcoded)', () => {
    render(<App />);
    seedLine();
    act(() => {
      useSelection.getState().selectLine('L1');
    });
    const dim = () => document.querySelector('[data-dim]')!;
    expect(dim().getAttribute('fill')).toBe('#000000');
    expect(Number(dim().getAttribute('fill-opacity'))).toBe(0.55);
    act(() => {
      useViewportStore.setState({ darkMode: true });
    });
    try {
      expect(Number(dim().getAttribute('fill-opacity'))).toBe(0.75);
    } finally {
      act(() => {
        useViewportStore.setState({ darkMode: false });
      });
    }
  });
});
