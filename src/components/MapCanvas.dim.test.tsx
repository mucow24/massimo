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
  // Selection leaks across tests (no store reset in this file); clear the
  // bits that drive a dim wash so each test starts from a true idle.
  useSelection.setState({
    selectedLineId: null,
    selectedStationIds: [],
    selectedStopLineId: null,
    labelSelected: false,
    uiMode: { kind: 'idle' },
  });
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

  // The dim reads its strength from the theme (ThemeColors.dim/dimOpacity),
  // now one standardized value for both modes. This pins the WIRING — the
  // token value itself is pinned in theme.test.ts.
  it('dims from the theme token, the same standardized strength in both modes', () => {
    render(<App />);
    seedLine();
    act(() => {
      useSelection.getState().selectLine('L1');
    });
    const dim = () => document.querySelector('[data-dim]')!;
    expect(dim().getAttribute('fill')).toBe('#000000');
    expect(Number(dim().getAttribute('fill-opacity'))).toBe(0.7);
    act(() => {
      useViewportStore.setState({ darkMode: true });
    });
    try {
      // Standardized: the black canvas gets the same wash, not a stronger one.
      expect(Number(dim().getAttribute('fill-opacity'))).toBe(0.7);
    } finally {
      act(() => {
        useViewportStore.setState({ darkMode: false });
      });
    }
  });
});

describe('MapCanvas — the station-layout editor focuses the edited station with a dim', () => {
  it('has no dim wash in idle mode', () => {
    render(<App />);
    seedLine();
    expect(document.querySelector('[data-dim]')).toBeNull();
  });

  it('dims the map (theme-driven, overdrawn like the bg) and lifts the edited station above it', () => {
    render(<App />);
    seedLine();
    act(() => {
      useSelection.getState().startEditingStationLayout('s1');
    });

    const dimEl = document.querySelector('[data-dim]');
    expect(dimEl).not.toBeNull();
    // Same theme token + overdrawn extent as the line-highlight dim, so an
    // imperative-viewBox pan can't reveal a bare strip before the commit.
    expect(dimEl!.getAttribute('fill')).toBe('#000000');
    expect(Number(dimEl!.getAttribute('fill-opacity'))).toBe(0.7);
    expect(box(dimEl!)).toEqual(box(document.querySelector('[data-bg]')!));

    // The edited station's dot is MOVED above the dim (skipped in the base
    // pass) so it stays at full strength — its true dot color, which the arrow
    // legibility relies on. Moved, not duplicated: still exactly one hit-seam,
    // so E2E dot locators stay unambiguous during layout editing.
    const s1Dots = [...document.querySelectorAll('[data-stop-station="s1"]')];
    expect(s1Dots).toHaveLength(1);
    const aboveDim = dimEl!.compareDocumentPosition(s1Dots[0]) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(aboveDim).toBeTruthy();
  });

  it("fades route bullets in the edited station's label under the dim, like every other label", () => {
    render(<App />);
    seedLine();
    act(() => {
      // Give s1's name an inline route bullet (|L1| → filled circle for L1).
      useDoc.setState((s) => ({
        stations: { ...s.stations, s1: { ...s.stations.s1, name: 'S1 |L1|' } },
      }));
      useSelection.getState().startEditingStationLayout('s1');
    });
    const dimEl = document.querySelector('[data-dim]')!;
    const bullets = [...document.querySelectorAll('[data-inline-bullet="L1"]')];
    // Exactly one, painted BEFORE the dim so the wash fades it. The label (name
    // + inline bullets) is NOT lifted above the dim — only the dots + editor
    // chrome are. No silent special-casing of the bullets.
    expect(bullets).toHaveLength(1);
    const beforeDim = dimEl.compareDocumentPosition(bullets[0]) & Node.DOCUMENT_POSITION_PRECEDING;
    expect(beforeDim).toBeTruthy();
  });

  it("paints the edited station's selection border white, above the dim", () => {
    render(<App />);
    seedLine();
    act(() => {
      useSelection.getState().startEditingStationLayout('s1');
    });
    const dimEl = document.querySelector('[data-dim]')!;
    // The dimmed themed (black) border is skipped in the base stroke pass; the
    // only copy is the white focus border above the dim.
    const strokes = [...document.querySelectorAll('[data-station-stroke="s1"]')];
    expect(strokes).toHaveLength(1);
    expect(strokes[0].querySelector('path')!.getAttribute('stroke')).toBe('#ffffff');
    const aboveDim = dimEl.compareDocumentPosition(strokes[0]) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(aboveDim).toBeTruthy();
  });

  it('paints routing-warning markers below the edited station, never over its dots/arrows', () => {
    render(<App />);
    seedLine();
    act(() => {
      useSelection.getState().startEditingStationLayout('s1');
    });
    // The edited station's dot is painted AFTER the warnings group, so a "!"
    // marker can never occlude the dot or its direction arrow (the click target).
    const warnings = document.querySelector('[data-band-warnings]')!;
    const dot = document.querySelector('[data-stop-station="s1"]')!;
    const dotAfterWarnings =
      warnings.compareDocumentPosition(dot) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(dotAfterWarnings).toBeTruthy();
  });
});
