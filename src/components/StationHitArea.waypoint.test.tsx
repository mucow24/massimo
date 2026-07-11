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
  useViewportStore.setState({ darkMode: false, showWaypoints: false });
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
});
