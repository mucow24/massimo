import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import App from '../App';
import { useDoc, useSelection } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { makePolygon } from '../test/fixtures';

// Probe: shift-clicking a station while a polygon's vertex handles are armed.
//
// Real gesture path (no DOM needed — these are the exact store actions the
// canvas handlers call):
//   click polygon body  -> MapCanvas.onPolygonClick   -> selection.selectPolygon
//   click vertex handle -> MapCanvas.onVertexClick    -> selection.selectVertices
//   shift-click station -> useStationInteraction:205  -> selection.toggleStationSelection
beforeEach(() => {
  localStorage.clear();
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
  useSelection.setState({
    ...useSelection.getState(),
    spaceHeld: false,
    uiMode: { kind: 'idle' },
    selectedStationIds: [],
    selectedRouteBulletIds: [],
    selectedLabelIds: [],
    selectedPolygonIds: [],
    selectedSvgImageIds: [],
    selectedVertices: null,
  });
});

// A pentagon, so a vertex delete stays above the 3-vertex floor and therefore
// actually mutates the doc (proving the vertex branch ran).
const seedPentagon = (locked = false) => {
  useDoc.setState({
    ...useDoc.getState(),
    polygons: {
      p0: makePolygon({
        id: 'p0',
        locked,
        vertices: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 5, y: 15 },
          { x: 0, y: 10 },
        ],
      }),
    },
    backgroundOrder: ['p0'],
  });
};

describe('station shift-click vs. an armed polygon-vertex selection', () => {
  it('shift-adding a station drops the now-stale vertex handles (as a polygon-list change does)', () => {
    const sel = useSelection.getState();
    sel.selectPolygon('p0');
    sel.selectVertices({ polygonId: 'p0', indices: [1] });
    useSelection.getState().toggleStationSelection('S1' as never);

    // The selection is no longer a single polygon's edit session, so the vertex
    // set is stale — exactly the rule togglePolygonSelection already enforces
    // ("a polygon-list change drops the active vertex selection").
    expect(useSelection.getState().selectedVertices).toBeNull();
  });

  it('Delete on a station+polygon multi-selection deletes both, not a vertex', () => {
    render(<App />);
    seedPentagon();
    const stationId = useDoc.getState().addStation(200, 200);

    // Build the state through the real gesture actions.
    useSelection.getState().selectPolygon('p0');
    useSelection.getState().selectVertices({ polygonId: 'p0', indices: [1] });
    useSelection.getState().toggleStationSelection(stationId);

    // Sanity: this really is a two-item multi-selection (the SelectionPopover's
    // "2 items" state, whose "Delete all" button removes both).
    expect(useSelection.getState().selectedStationIds).toEqual([stationId]);
    expect(useSelection.getState().selectedPolygonIds).toEqual(['p0']);

    fireEvent.keyDown(window, { key: 'Delete' });

    const doc = useDoc.getState();
    // Polygon first: the received value doubles as proof of which branch ran —
    // a surviving polygon with 4 (not 5) vertices means Delete amputated it.
    expect(doc.polygons['p0']).toBeUndefined();
    expect(doc.stations[stationId]).toBeUndefined();
  });

  it('Arrow nudge on a station+LOCKED-polygon multi-selection still moves the station', () => {
    render(<App />);
    seedPentagon(true);
    const stationId = useDoc.getState().addStation(200, 200);
    const x0 = useDoc.getState().stations[stationId].x;

    useSelection.getState().selectPolygon('p0');
    useSelection.getState().selectVertices({ polygonId: 'p0', indices: [1] });
    useSelection.getState().toggleStationSelection(stationId);

    fireEvent.keyDown(window, { key: 'ArrowRight' });

    expect(useDoc.getState().stations[stationId].x).toBe(x0 + 1);
  });
});
