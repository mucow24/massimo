import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { StationView } from './StationView';
import { useDoc, useSelection } from '../state/store';
import { useViewportStore } from '../state/viewportStore';
import { DEFAULT_DOC } from '../model/transforms';
import { makeLine, makeStation, makeStop } from '../test/fixtures';
import type { Line, Station } from '../model/types';

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useSelection.setState({ ...useSelection.getState(), editingStationId: null });
  useViewportStore.setState({ darkMode: false, zoom: 1, showWaypoints: false });
});

// StationSilhouette reads `lines` from the doc store (not a prop), so seed it.
function renderStroke(station: Station, lines: Record<string, Line>, showWaypoints: boolean) {
  useDoc.setState({ ...useDoc.getState(), lines });
  useViewportStore.setState({ showWaypoints });
  const { container } = render(
    <svg>
      <StationView station={station} lines={lines} zoom={1} onStartDrag={() => {}} layer="stroke" />
    </svg>,
  );
  return container.querySelector('path')!.getAttribute('d')!;
}

const waypoint = () =>
  makeStation({ id: 'wp', name: 'Junction', isWaypoint: true, stops: [makeStop('L1')] });
const wpLines = () => ({ L1: makeLine({ id: 'L1', stations: ['wp'] }) });

describe('StationSilhouette — waypoints under the Show-waypoints overlay', () => {
  it('grows the selection ring to include the name when the overlay is on', () => {
    const off = renderStroke(waypoint(), wpLines(), false);
    const on = renderStroke(waypoint(), wpLines(), true);
    // With the overlay on the label rect joins the silhouette, so the outline
    // path is a different (larger) shape than the dot-only ring.
    expect(on).not.toBe(off);
  });

  it('leaves a normal station ring unchanged by the overlay', () => {
    const station = makeStation({ id: 's1', stops: [makeStop('L1')] });
    const ln = { L1: makeLine({ id: 'L1', stations: ['s1'] }) };
    expect(renderStroke(station, ln, true)).toBe(renderStroke(station, ln, false));
  });
});
