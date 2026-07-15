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
  useDoc.setState({ darkMode: false });
  useViewportStore.setState({ showWaypoints: false });
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

describe('StationLabel — waypoints show the WP lozenge in place of the name', () => {
  it('paints nothing for a waypoint while the overlay is off', () => {
    useViewportStore.setState({ showWaypoints: false });
    const svg = renderLabel(waypoint(), lines());
    expect(svg.querySelector('[data-waypoint-lozenge]')).toBeNull();
    expect(svg.textContent).not.toContain('Junction');
  });

  it('paints ONLY the WP lozenge — not the station name — while the overlay is on', () => {
    useViewportStore.setState({ showWaypoints: true });
    const svg = renderLabel(waypoint(), lines());
    const lozenge = svg.querySelector('[data-waypoint-lozenge]')!;
    expect(lozenge).toBeTruthy();
    expect(lozenge.textContent).toContain('WP');
    // The name is replaced by the lozenge, not shown alongside it.
    expect(svg.textContent).not.toContain('Junction');
  });

  it('shows the lozenge (no name) in the highlight pass (line selected → above dim)', () => {
    useViewportStore.setState({ showWaypoints: true });
    const svg = renderLabel(waypoint(), lines(), 'highlight-label');
    expect(svg.querySelector('[data-waypoint-lozenge]')).toBeTruthy();
    expect(svg.textContent).not.toContain('Junction');
  });

  it('shows the lozenge (no name) in the starter pass (append mode)', () => {
    useViewportStore.setState({ showWaypoints: true });
    const svg = renderLabel(waypoint(), lines(), 'starter-label');
    expect(svg.querySelector('[data-waypoint-lozenge]')).toBeTruthy();
    expect(svg.textContent).not.toContain('Junction');
  });

  it('stays hidden in the highlight + starter passes while the overlay is off', () => {
    useViewportStore.setState({ showWaypoints: false });
    for (const layer of ['highlight-label', 'starter-label'] as const) {
      const svg = renderLabel(waypoint(), lines(), layer);
      expect(svg.querySelector('[data-waypoint-lozenge]')).toBeNull();
      expect(svg.textContent).not.toContain('Junction');
    }
  });

  it('a normal (non-waypoint) station still paints its name, no lozenge', () => {
    useViewportStore.setState({ showWaypoints: true });
    const station = makeStation({ id: 's1', name: 'Central', stops: [makeStop('L1')] });
    const svg = renderLabel(station, { L1: makeLine({ id: 'L1', stations: ['s1'] }) });
    expect(svg.textContent).toContain('Central');
    expect(svg.querySelector('[data-waypoint-lozenge]')).toBeNull();
  });

  // The lozenge is a reveal-overlay artifact, not map content: it must never
  // bake into an export. buildExportSvg strips any [data-export-exclude]
  // subtree, so the lozenge has to live inside one — in every label pass.
  it('tags the WP lozenge for export exclusion in every label pass (never bakes into an export)', () => {
    useViewportStore.setState({ showWaypoints: true });
    for (const layer of ['label', 'highlight-label', 'starter-label'] as const) {
      const svg = renderLabel(waypoint(), lines(), layer);
      const lozenge = svg.querySelector('[data-waypoint-lozenge]')!;
      expect(lozenge).toBeTruthy();
      expect(lozenge.closest('[data-export-exclude]')).not.toBeNull();
    }
  });

  it('does NOT export-exclude an ordinary station name', () => {
    useViewportStore.setState({ showWaypoints: true });
    const station = makeStation({ id: 's1', name: 'Central', stops: [makeStop('L1')] });
    const svg = renderLabel(station, { L1: makeLine({ id: 'L1', stations: ['s1'] }) });
    expect(svg.querySelector('[data-export-exclude]')).toBeNull();
  });

  // The station still has a name; double-click still opens the inline rename
  // editor (the lozenge stands in for the name, and behaves like one).
  it('mounts the inline rename editor for a revealed waypoint being edited', () => {
    useViewportStore.setState({ showWaypoints: true });
    useSelection.setState({ ...useSelection.getState(), editingStationId: 'wp' });
    const svg = renderLabel(waypoint(), lines());
    expect(svg.querySelector('textarea')).toBeTruthy();
  });
});
