import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import App from '../App';
import { useDoc } from '../state/store';
import { useSelection } from '../state/selection';
import { useViewportStore } from '../state/viewportStore';
import { useSnapPrefs } from '../state/snapPrefs';
import { DEFAULT_SNAP_MODES } from '../geometry/snap';
import { DEFAULT_DOC } from '../model/transforms';
import { deleteUnlockedSelection } from '../state/selectionOps';
import { makeLineCircle, makeStation, makeStop } from '../test/fixtures';

// jsdom reports clientWidth/clientHeight as 0, which collapses the viewBox to
// 0×0. Give the canvas a real size for the duration (mirrors the hit-proxy
// suite).
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
  useSelection.getState().clearAllSelections();
  useSelection.getState().setUiMode({ kind: 'idle' });
  useViewportStore.setState({ x: 0, y: 0, zoom: 1 });
  // Cardinal ticks are a snap pref, so a test that flips it must not leak into
  // the popover / deletion suites below.
  useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES } });
});
afterEach(() => {
  for (const prop of sizeProps) {
    const d = originals[prop];
    if (d) Object.defineProperty(HTMLElement.prototype, prop, d);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
  }
});

function seedCircle() {
  act(() => {
    useDoc.setState({
      ...useDoc.getState(),
      lineCircles: { c1: makeLineCircle({ id: 'c1', x: 100, y: 100, radius: 70 }) },
      stations: {
        s1: makeStation({
          id: 's1',
          x: 170,
          y: 100,
          circleId: 'c1',
          stops: [makeStop('l1', { viaCircle: true })],
        }),
      },
    });
  });
}

describe('MapCanvas — line-circle guide rendering', () => {
  it('renders the dashed guide ring inside an export-excluded subtree', () => {
    render(<App />);
    seedCircle();
    const g = document.querySelector('[data-line-circle="c1"]');
    expect(g).not.toBeNull();
    // The guide never prints: some ancestor carries data-export-exclude.
    expect(g!.closest('[data-export-exclude]')).not.toBeNull();
    // The visible ring is a dashed circle at the stored geometry.
    const ring = g!.querySelector('circle[stroke-dasharray]');
    expect(ring).not.toBeNull();
    expect(ring!.getAttribute('cx')).toBe('100');
    expect(ring!.getAttribute('cy')).toBe('100');
    expect(ring!.getAttribute('r')).toBe('70');
  });

  it('shows the resize knob only while selected', () => {
    render(<App />);
    seedCircle();
    expect(document.querySelector('[data-line-circle-knob="c1"]')).toBeNull();
    act(() => useSelection.getState().selectLineCircle('c1'));
    expect(document.querySelector('[data-line-circle-knob="c1"]')).not.toBeNull();
  });

  it('paints the eight cardinal ticks only while the snap mode is on', () => {
    render(<App />);
    seedCircle();
    expect(document.querySelector('[data-line-circle-cardinals="c1"]')).toBeNull();
    act(() => useSnapPrefs.getState().setMode('circle', true));
    const ticks = document.querySelector('[data-line-circle-cardinals="c1"]');
    expect(ticks).not.toBeNull();
    expect(ticks!.querySelectorAll('line')).toHaveLength(8);
    // Scaffolding, like the ring it marks: never printed.
    expect(ticks!.closest('[data-export-exclude]')).not.toBeNull();
    act(() => useSnapPrefs.getState().setMode('circle', false));
    expect(document.querySelector('[data-line-circle-cardinals="c1"]')).toBeNull();
  });

  it('straddles the rim at due east and due south', () => {
    render(<App />);
    seedCircle();
    act(() => useSnapPrefs.getState().setMode('circle', true));
    const lines = Array.from(document.querySelectorAll('[data-line-circle-cardinals="c1"] line'));
    const at = (x: number, y: number) =>
      lines.find(
        (l) =>
          Math.abs(Number(l.getAttribute('x1')) - x) < 1e-6 &&
          Math.abs(Number(l.getAttribute('y1')) - y) < 1e-6,
      );
    // Circle (100,100) r70, zoom 1, tick half-length 4: the east tick runs
    // 166→174 along y=100, the south tick 166→174 along x=100.
    expect(at(166, 100)).toBeDefined();
    expect(Number(at(166, 100)!.getAttribute('x2'))).toBeCloseTo(174, 6);
    const south = lines.find((l) => Math.abs(Number(l.getAttribute('y1')) - 166) < 1e-6);
    expect(south).toBeDefined();
    expect(Number(south!.getAttribute('y2'))).toBeCloseTo(174, 6);
  });
});

describe('line-circle popover', () => {
  it('a sole selected circle opens the tiny popover; lock disables the diameter', () => {
    render(<App />);
    seedCircle();
    act(() => useSelection.getState().selectLineCircle('c1'));
    const spin = document.querySelector<HTMLInputElement>(
      '.line-circle-popover input[type="number"]',
    );
    expect(spin).not.toBeNull();
    // Diameter, not radius (the field formats to the 0.5 step, e.g. "140.0").
    expect(Number(spin!.value)).toBe(140);
    act(() => useDoc.getState().setLineCircleLocked('c1', true));
    expect(
      document.querySelector<HTMLInputElement>('.line-circle-popover input[type="number"]')!
        .disabled,
    ).toBe(true);
  });

  it('does not open for a circle co-selected with another item', () => {
    render(<App />);
    seedCircle();
    act(() => {
      useSelection.getState().selectLineCircle('c1');
      useSelection.getState().addStationsToSelection(['s1']);
    });
    expect(document.querySelector('.line-circle-popover')).toBeNull();
  });
});

describe('line-circle deletion via the selection ops', () => {
  it('Delete unbinds the stations and removes the guide, one undo restores both', () => {
    render(<App />);
    seedCircle();
    act(() => useSelection.getState().selectLineCircle('c1'));
    let deleted = false;
    act(() => {
      deleted = deleteUnlockedSelection();
    });
    expect(deleted).toBe(true);
    let s = useDoc.getState();
    expect(s.lineCircles.c1).toBeUndefined();
    // The station survives IN PLACE, just unbound.
    expect(s.stations.s1).toMatchObject({ x: 170, y: 100 });
    expect('circleId' in s.stations.s1).toBe(false);
    act(() => useDoc.temporal.getState().undo());
    s = useDoc.getState();
    expect(s.lineCircles.c1).toBeDefined();
    expect(s.stations.s1.circleId).toBe('c1');
  });

  it('a locked circle resists Delete', () => {
    render(<App />);
    seedCircle();
    act(() => {
      useDoc.getState().setLineCircleLocked('c1', true);
      useSelection.getState().selectLineCircle('c1');
    });
    let deleted = true;
    act(() => {
      deleted = deleteUnlockedSelection();
    });
    expect(deleted).toBe(false);
    expect(useDoc.getState().lineCircles.c1).toBeDefined();
  });
});
