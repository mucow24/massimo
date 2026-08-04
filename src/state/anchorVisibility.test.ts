import { describe, it, expect, beforeEach } from 'vitest';
import { useSelection } from './store';
import { clearedSelections } from './selection';
import { revealedAnchorStations } from './anchorVisibility';
import { makeStation } from '../test/fixtures';
import type { Station, StationId } from '../model/types';

beforeEach(() => {
  useSelection.setState({
    ...clearedSelections(),
    uiMode: { kind: 'idle' },
    hoveredCanvasItem: null,
    toolMode: 'arrow',
    spaceHeld: false,
  });
});

const stations: Record<string, Station> = {
  s1: makeStation({ id: 's1', transferAnchors: [{ id: 'h1', row: 0, col: 1 }] }),
  s2: makeStation({ id: 's2', transferAnchors: [{ id: 'h2', row: 0, col: 1 }] }),
};

const revealed = () => Object.keys(revealedAnchorStations(stations, useSelection.getState()));

describe('revealedAnchorStations', () => {
  it('reveals nothing when no station is hovered or selected', () => {
    expect(revealed()).toEqual([]);
  });

  it('reveals the selected stations', () => {
    useSelection.setState({ selectedStationIds: ['s1'] as StationId[] });
    expect(revealed()).toEqual(['s1']);
  });

  it('reveals the hovered station', () => {
    useSelection.setState({ hoveredCanvasItem: { kind: 'station', id: 's2' } });
    expect(revealed()).toEqual(['s2']);
  });

  it('unions the selected and hovered halves', () => {
    // The point of the feature: looking at one station shows what IT carries.
    // A second station's anchors staying hidden is the whole contract.
    useSelection.setState({
      selectedStationIds: ['s1'] as StationId[],
      hoveredCanvasItem: { kind: 'station', id: 's2' },
    });
    expect(revealed().sort()).toEqual(['s1', 's2']);
  });

  it('ignores a hover on a non-station item', () => {
    useSelection.setState({ hoveredCanvasItem: { kind: 'polygon', id: 's1' } });
    expect(revealed()).toEqual([]);
  });

  it('drops the hover half while panning, but keeps the selected half', () => {
    // Rides on hoveredChrome, so the reveal appears and disappears with every
    // other piece of mouseover chrome instead of inventing its own gate.
    useSelection.setState({
      selectedStationIds: ['s1'] as StationId[],
      hoveredCanvasItem: { kind: 'station', id: 's2' },
      toolMode: 'hand',
    });
    expect(revealed()).toEqual(['s1']);
  });

  it('reveals nothing outside idle mode', () => {
    // creating-transfer and placing-anchor already reveal EVERY anchor, and the
    // layout editor draws its own grab rings for the station being edited — a
    // second, differently-shaped copy underneath would only be noise.
    useSelection.setState({
      selectedStationIds: ['s1'] as StationId[],
      uiMode: { kind: 'editing-station-layout', stationId: 's1' as StationId },
    });
    expect(revealed()).toEqual([]);
  });

  it('skips an id that no longer resolves in the doc', () => {
    useSelection.setState({ selectedStationIds: ['gone'] as StationId[] });
    expect(revealed()).toEqual([]);
  });
});
