import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { StationView } from './StationView';
import { useDoc, useSelection } from '../state/store';
import { useViewportStore } from '../state/viewportStore';
import { DEFAULT_DOC } from '../model/transforms';
import { makeLine, makeStation, makeStop } from '../test/fixtures';
import type { Line, Station } from '../model/types';

type LabelLayer = 'label' | 'highlight-label' | 'starter-label';

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useSelection.setState({
    ...useSelection.getState(),
    hoveredStationId: null,
    selectedStationIds: [],
    selectedLineId: null,
    editingStationId: null,
    uiMode: { kind: 'idle' },
  });
  useViewportStore.setState({ darkMode: false, showWaypoints: false });
});

function renderLabel(station: Station, lines: Record<string, Line>, layer: LabelLayer = 'label') {
  const { container } = render(
    <svg>
      <StationView station={station} lines={lines} zoom={1} onStartDrag={vi.fn()} layer={layer} />
    </svg>,
  );
  return container.querySelector('svg')!;
}

const waypoint = () =>
  makeStation({
    id: 'wp',
    name: 'Junction',
    isWaypoint: true,
    stops: [makeStop('L1', { row: 0, col: 0 })],
  });
const lines = () => ({ L1: makeLine({ id: 'L1', stations: ['wp'] }) });

describe('StationLabel — waypoints under the Show-waypoints overlay', () => {
  it('paints nothing for a waypoint while the overlay is off', () => {
    useViewportStore.setState({ showWaypoints: false });
    const svg = renderLabel(waypoint(), lines());
    expect(svg.querySelector('[data-waypoint-lozenge]')).toBeNull();
    expect(svg.textContent).not.toContain('Junction');
  });

  it('paints the name with a leading "WP" lozenge while the overlay is on', () => {
    useViewportStore.setState({ showWaypoints: true });
    const svg = renderLabel(waypoint(), lines());
    const lozenge = svg.querySelector('[data-waypoint-lozenge]')!;
    expect(lozenge).toBeTruthy();
    expect(lozenge.textContent).toContain('WP');
    // The station name is re-enabled alongside the lozenge.
    expect(svg.textContent).toContain('Junction');
  });

  it('places the lozenge to the left of the name (before it in reading order)', () => {
    useViewportStore.setState({ showWaypoints: true });
    const svg = renderLabel(waypoint(), lines());
    const lozengeRect = svg.querySelector('[data-waypoint-lozenge] rect')!;
    // The lozenge's right edge is the pill's x + width; the name's <text> anchors
    // at anchorX which is at/after the label's left edge. The pill sits left of it.
    const lozengeRight =
      Number(lozengeRect.getAttribute('x')) + Number(lozengeRect.getAttribute('width'));
    const nameText = Array.from(svg.querySelectorAll('text')).find((t) =>
      (t.textContent ?? '').includes('Junction'),
    )!;
    expect(nameText).toBeTruthy();
    expect(lozengeRight).toBeLessThanOrEqual(Number(nameText.getAttribute('x')));
  });

  // Ask #2: a revealed waypoint behaves like a normal station in every label
  // pass, so its name survives the dim (line selected) and append-mode reveals.
  it('paints the name + lozenge in the highlight pass (line selected → above dim)', () => {
    useViewportStore.setState({ showWaypoints: true });
    const svg = renderLabel(waypoint(), lines(), 'highlight-label');
    expect(svg.querySelector('[data-waypoint-lozenge]')).toBeTruthy();
    expect(svg.textContent).toContain('Junction');
  });

  it('paints the name + lozenge in the starter pass (append mode)', () => {
    useViewportStore.setState({ showWaypoints: true });
    const svg = renderLabel(waypoint(), lines(), 'starter-label');
    expect(svg.querySelector('[data-waypoint-lozenge]')).toBeTruthy();
    expect(svg.textContent).toContain('Junction');
  });

  it('stays hidden in the highlight + starter passes while the overlay is off', () => {
    useViewportStore.setState({ showWaypoints: false });
    for (const layer of ['highlight-label', 'starter-label'] as const) {
      const svg = renderLabel(waypoint(), lines(), layer);
      expect(svg.querySelector('[data-waypoint-lozenge]')).toBeNull();
      expect(svg.textContent).not.toContain('Junction');
    }
  });

  // Ask #1: the revealed name is a first-class label — it enters inline rename
  // like any station (the paint-only version deliberately couldn't).
  it('mounts the inline rename editor for a revealed waypoint being edited', () => {
    useViewportStore.setState({ showWaypoints: true });
    useSelection.setState({ ...useSelection.getState(), editingStationId: 'wp' });
    const svg = renderLabel(waypoint(), lines());
    expect(svg.querySelector('textarea')).toBeTruthy();
  });
});
