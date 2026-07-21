import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import App from '../App';
import { useDoc } from '../state/store';
import { useSelection } from '../state/selection';
import { useViewportStore } from '../state/viewportStore';
import { DEFAULT_DOC } from '../model/transforms';
import type { Line, Station } from '../model/types';
import { makeLine } from '../test/fixtures';

// jsdom reports clientWidth/clientHeight as 0, which would collapse the canvas
// viewBox to 0×0. Give the canvas host a real size for these tests.
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
  useSelection.setState({
    selectedLineId: null,
    selectedStationIds: [],
    selectedStopLineId: null,
    labelSelected: false,
    uiMode: { kind: 'idle' },
    toolMode: 'arrow',
    spaceHeld: false,
    hoveredCanvasItem: null,
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

const seed = () => {
  const s1: Station = {
    id: 's1',
    name: 'S1',
    x: 0,
    y: 0,
    rotation: 0,
    stops: [
      { lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' },
      { lineId: 'L2', row: 0, col: 1, orientation: 'auto-ne-sw' },
    ],
    label,
  };
  const s2: Station = {
    id: 's2',
    name: 'S2',
    x: 200,
    y: 0,
    rotation: 0,
    stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-horizontal' }],
    label,
  };
  const L1: Line = makeLine({
    id: 'L1',
    service: '1',
    name: '1 line',
    color: '#0039A6',
    stations: ['s1', 's2'],
  });
  const L2: Line = makeLine({
    id: 'L2',
    service: '2',
    name: '2 line',
    color: '#ee352e',
    stations: ['s1'],
  });
  act(() => {
    useDoc.setState({
      ...useDoc.getState(),
      stations: { s1, s2 },
      lines: { L1, L2 },
      lineOrder: ['L1', 'L2'],
    });
  });
};

const hoverStation = (id: string) =>
  act(() => {
    useSelection.getState().setHoveredCanvasItem({ kind: 'station', id });
  });

describe('MapCanvas — mouseover orientation arrows on stop dots', () => {
  it('renders no arrows while nothing is hovered', () => {
    render(<App />);
    seed();
    expect(document.querySelector('[data-station-arrows]')).toBeNull();
  });

  it('hovering a station paints one orientation glyph per stop, and only for that station', () => {
    render(<App />);
    seed();
    hoverStation('s1');
    const group = document.querySelector('[data-station-arrows="s1"]');
    expect(group).not.toBeNull();
    const glyphs = [...group!.querySelectorAll('text')].map((t) => t.textContent);
    expect(glyphs).toEqual(['↕', '⤢']);
    // Only the hovered station gets arrows.
    expect(document.querySelectorAll('[data-station-arrows]')).toHaveLength(1);
  });

  it('clearing the hover removes the arrows', () => {
    render(<App />);
    seed();
    hoverStation('s1');
    expect(document.querySelector('[data-station-arrows]')).not.toBeNull();
    act(() => {
      useSelection.getState().setHoveredCanvasItem(null);
    });
    expect(document.querySelector('[data-station-arrows]')).toBeNull();
  });

  it('suppressed for an already-selected station, like the rest of the hover preview', () => {
    render(<App />);
    seed();
    act(() => {
      useSelection.setState({ selectedStationIds: ['s1'] });
    });
    hoverStation('s1');
    expect(document.querySelector('[data-station-arrows]')).toBeNull();
  });

  it('paints the arrows above the routing-warning markers', () => {
    render(<App />);
    seed();
    hoverStation('s1');
    // Same reason the layout editor lifts its dots + arrows above the
    // warnings: a ⚠ frame appears exactly where you're looking when things
    // go wrong, and it must never cover the orientation badges.
    const warnings = document.querySelector('[data-band-warnings]')!;
    const arrows = document.querySelector('[data-station-arrows="s1"]')!;
    const arrowsAfterWarnings =
      warnings.compareDocumentPosition(arrows) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(arrowsAfterWarnings).toBeTruthy();
  });

  it('arrows are hover chrome: excluded from export and inert to the pointer', () => {
    render(<App />);
    seed();
    hoverStation('s1');
    const group = document.querySelector('[data-station-arrows="s1"]')!;
    expect(group.closest('[data-export-exclude]')).not.toBeNull();
    expect(group.getAttribute('pointer-events')).toBe('none');
  });
});
