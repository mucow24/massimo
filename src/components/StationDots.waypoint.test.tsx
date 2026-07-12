import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { StationView } from './StationView';
import { useDoc, useSelection } from '../state/store';
import { useViewportStore } from '../state/viewportStore';
import { DEFAULT_DOC } from '../model/transforms';
import { makeLine, makeStation, makeStop } from '../test/fixtures';
import { DOT_SHAPE_PRESETS } from '../model/dotStyle';
import type { Line, Station } from '../model/types';

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useSelection.setState({
    ...useSelection.getState(),
    hoveredStationId: null,
    hoveredLineStop: null,
    selectedStationIds: [],
    selectedLineId: null,
    editingStationId: null,
    uiMode: { kind: 'idle' },
  });
  useViewportStore.setState({ darkMode: false, showWaypoints: false });
});

function renderDots(station: Station, lines: Record<string, Line>) {
  const { container } = render(
    <svg>
      <StationView station={station} lines={lines} zoom={1} onStartDrag={vi.fn()} layer="dots" />
    </svg>,
  );
  return container.querySelector('svg')!;
}

// A waypoint whose only stop carries a bright per-stop style, so a "black stroke,
// white fill" render is unambiguously the overlay override — not the stored style.
const waypoint = () =>
  makeStation({
    id: 'wp',
    isWaypoint: true,
    stops: [makeStop('L1', { row: 0, col: 0, dotStyle: DOT_SHAPE_PRESETS['filled-black'] })],
  });
const lines = () => ({ L1: makeLine({ id: 'L1', stations: ['wp'] }) });

describe('StationDots — waypoints under the Show-waypoints overlay', () => {
  it('renders no stop dots for a waypoint while the overlay is off', () => {
    useViewportStore.setState({ showWaypoints: false });
    const svg = renderDots(waypoint(), lines());
    expect(svg.querySelectorAll('[data-stop-station="wp"]').length).toBe(0);
    expect(svg.querySelectorAll('[data-stop-stroke="wp"]').length).toBe(0);
  });

  it('reveals the waypoint stop as a black-stroke / white-fill dot while the overlay is on', () => {
    useViewportStore.setState({ showWaypoints: true });
    const svg = renderDots(waypoint(), lines());
    // Fill pass: one canonical seam per dot, white body.
    const fill = svg.querySelector('[data-stop-station="wp"][data-stop-shape="circle"]')!;
    expect(fill).toBeTruthy();
    expect(fill.getAttribute('fill')).toBe('#ffffff');
    // Stroke pass: a black silhouette beneath it.
    const stroke = svg.querySelector('[data-stop-stroke="wp"]')!;
    expect(stroke).toBeTruthy();
    expect(stroke.getAttribute('fill')).toBe('#000000');
  });

  it('forces the overlay style even when the stop stores a different dotStyle (non-destructive)', () => {
    // The stop's stored style is filled-black (no stroke). The overlay must
    // override it at render time without depending on / mutating the stored value.
    useViewportStore.setState({ showWaypoints: true });
    const svg = renderDots(waypoint(), lines());
    expect(
      svg.querySelector('[data-stop-station="wp"][data-stop-shape="circle"]')!.getAttribute('fill'),
    ).toBe('#ffffff');
    expect(svg.querySelectorAll('[data-stop-stroke="wp"]').length).toBe(1);
  });

  it('leaves ordinary (non-waypoint) stations untouched by the overlay', () => {
    useViewportStore.setState({ showWaypoints: true });
    const station = makeStation({
      id: 's1',
      stops: [makeStop('L1', { row: 0, col: 0 })], // tracks the default filled-black
    });
    const svg = renderDots(station, { L1: makeLine({ id: 'L1', stations: ['s1'] }) });
    const dot = svg.querySelector('[data-stop-station="s1"][data-stop-shape="circle"]')!;
    expect(dot.getAttribute('fill')).toBe('#000000');
    expect(svg.querySelectorAll('[data-stop-stroke="s1"]').length).toBe(0);
  });

  // Show-waypoints is a view aid, never a formal map edit — a revealed
  // waypoint's dots must be stripped from every export. buildExportSvg removes
  // any [data-export-exclude] subtree, so the dots have to sit inside one.
  it('tags a revealed waypoint dot for export exclusion (never bakes into PNG/SVG/PDF)', () => {
    useViewportStore.setState({ showWaypoints: true });
    const svg = renderDots(waypoint(), lines());
    const dot = svg.querySelector('[data-stop-station="wp"]')!;
    expect(dot).toBeTruthy();
    expect(dot.closest('[data-export-exclude]')).not.toBeNull();
  });

  it('does NOT export-exclude an ordinary station dot', () => {
    useViewportStore.setState({ showWaypoints: true });
    const station = makeStation({ id: 's1', stops: [makeStop('L1', { row: 0, col: 0 })] });
    const svg = renderDots(station, { L1: makeLine({ id: 'L1', stations: ['s1'] }) });
    expect(
      svg.querySelector('[data-stop-station="s1"]')!.closest('[data-export-exclude]'),
    ).toBeNull();
  });
});
