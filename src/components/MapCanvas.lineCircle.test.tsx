import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import App from '../App';
import { useDoc } from '../state/store';
import { useSelection } from '../state/selection';
import { useViewportStore } from '../state/viewportStore';
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
