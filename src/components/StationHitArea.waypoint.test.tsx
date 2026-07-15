import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { StationView } from './StationView';
import { useDoc, useSelection } from '../state/store';
import { useViewportStore } from '../state/viewportStore';
import { DEFAULT_DOC } from '../model/transforms';
import { makeLine, makeStation, makeStop } from '../test/fixtures';
import type { Line, Station } from '../model/types';

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useSelection.setState({
    ...useSelection.getState(),
    hoveredStationId: null,
    selectedStationIds: [],
    editingStationId: null,
    uiMode: { kind: 'idle' },
    toolMode: 'arrow',
    spaceHeld: false,
  });
  useDoc.setState({ darkMode: false });
  useViewportStore.setState({ showWaypoints: false });
});

function renderHitArea(station: Station, lines: Record<string, Line>) {
  const { container } = render(
    <svg>
      <StationView station={station} lines={lines} zoom={1} onStartDrag={vi.fn()} layer="bg" />
    </svg>,
  );
  return container.querySelector('svg')!;
}

const waypoint = () =>
  makeStation({ id: 'wp', name: 'Junction', isWaypoint: true, stops: [makeStop('L1')] });
const lines = () => ({ L1: makeLine({ id: 'L1', stations: ['wp'] }) });

describe('StationHitArea — waypoints under the Show-waypoints overlay', () => {
  it('has only the cells hit rect while the overlay is off (name not clickable)', () => {
    useViewportStore.setState({ showWaypoints: false });
    const svg = renderHitArea(waypoint(), lines());
    expect(svg.querySelectorAll('rect').length).toBe(1);
  });

  it('adds the label hit rect while the overlay is on (name is clickable)', () => {
    useViewportStore.setState({ showWaypoints: true });
    const svg = renderHitArea(waypoint(), lines());
    expect(svg.querySelectorAll('rect').length).toBe(2);
  });

  it('a normal station always has both rects regardless of the overlay', () => {
    const station = makeStation({ id: 's1', stops: [makeStop('L1')] });
    const ln = { L1: makeLine({ id: 'L1', stations: ['s1'] }) };
    useViewportStore.setState({ showWaypoints: false });
    expect(renderHitArea(station, ln).querySelectorAll('rect').length).toBe(2);
    useViewportStore.setState({ showWaypoints: true });
    expect(renderHitArea(station, ln).querySelectorAll('rect').length).toBe(2);
  });

  // A revealed waypoint's hit footprint widens to wrap its lozenge. The rects
  // are transparent but getBBox-visible, so if they survived into an export the
  // frame would grow around a waypoint that must not appear at all — exclude
  // the whole hit area from exports.
  it('export-excludes the whole hit area for a revealed waypoint', () => {
    useViewportStore.setState({ showWaypoints: true });
    const svg = renderHitArea(waypoint(), lines());
    const g = svg.querySelector('[data-station-id="wp"]')!;
    expect(g).toBeTruthy();
    expect(g.closest('[data-export-exclude]')).not.toBeNull();
  });

  it('does NOT export-exclude a hidden waypoint or a normal station hit area', () => {
    useViewportStore.setState({ showWaypoints: false });
    expect(
      renderHitArea(waypoint(), lines())
        .querySelector('[data-station-id="wp"]')!
        .closest('[data-export-exclude]'),
    ).toBeNull();
    useViewportStore.setState({ showWaypoints: true });
    const normal = makeStation({ id: 's1', stops: [makeStop('L1')] });
    expect(
      renderHitArea(normal, { L1: makeLine({ id: 'L1', stations: ['s1'] }) })
        .querySelector('[data-station-id="s1"]')!
        .closest('[data-export-exclude]'),
    ).toBeNull();
  });
});
