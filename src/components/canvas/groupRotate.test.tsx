import { describe, it, expect, beforeEach, vi } from 'vitest';
import { rotateItemOnContextMenu } from './groupRotate';
import { useDoc, useSelection } from '../../state/store';
import { DEFAULT_DOC } from '../../model/transforms';
import { makeDoc, makeStation } from '../../test/fixtures';

// Reset both stores; clear every selection id list so each test sets exactly
// what it needs.
const blankSelection = () =>
  useSelection.setState({
    selectedStationIds: [],
    selectedRouteBulletIds: [],
    selectedLabelIds: [],
    selectedPolygonIds: [],
  });

beforeEach(() => {
  localStorage.clear();
  useDoc.setState({ ...DEFAULT_DOC });
  blankSelection();
});

describe('rotateItemOnContextMenu', () => {
  it('group-rotates the whole selection (not rotateSingle) when the pivot is in a multi-selection', () => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({ id: 'a', x: 0, y: 0, rotation: 0 }),
          makeStation({ id: 'b', x: 100, y: 0, rotation: 0 }),
        ],
      }),
    });
    useSelection.setState({ selectedStationIds: ['a', 'b'] });

    const rotateSingle = vi.fn();
    rotateItemOnContextMenu({ type: 'station', id: 'a' }, rotateSingle);

    expect(rotateSingle).not.toHaveBeenCalled();
    const doc = useDoc.getState();
    // Group rotation steps every member's own rotation by one (0 -> 1).
    expect(doc.stations.a.rotation).toBe(1);
    expect(doc.stations.b.rotation).toBe(1);
    // The non-pivot b orbits 45° CW about the pivot a at (0,0): from (100,0)
    // it moves up-and-right onto the diagonal.
    expect(doc.stations.b.x).toBeCloseTo(100 * Math.cos(Math.PI / 4), 6);
    expect(doc.stations.b.y).toBeCloseTo(100 * Math.sin(Math.PI / 4), 6);
    // The pivot a stays put.
    expect(doc.stations.a.x).toBe(0);
    expect(doc.stations.a.y).toBe(0);
  });

  it('rotates just the clicked item (rotateSingle) when nothing is selected', () => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({ stations: [makeStation({ id: 'a', rotation: 0 })] }),
    });
    blankSelection();

    const rotateSingle = vi.fn();
    rotateItemOnContextMenu({ type: 'station', id: 'a' }, rotateSingle);

    expect(rotateSingle).toHaveBeenCalledTimes(1);
    // Doc untouched — the single-item path delegates entirely to rotateSingle.
    expect(useDoc.getState().stations.a.rotation).toBe(0);
  });

  it('rotates just the clicked item when the pivot is NOT part of the multi-selection', () => {
    // Two stations selected, but the right-clicked pivot `a` is not among them
    // — this is the "co-selected item left behind" guard.
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({ id: 'a', rotation: 0 }),
          makeStation({ id: 'b', rotation: 0 }),
          makeStation({ id: 'c', rotation: 0 }),
        ],
      }),
    });
    useSelection.setState({ selectedStationIds: ['b', 'c'] });

    const rotateSingle = vi.fn();
    rotateItemOnContextMenu({ type: 'station', id: 'a' }, rotateSingle);

    expect(rotateSingle).toHaveBeenCalledTimes(1);
    // b and c are NOT group-rotated (the pivot wasn't in the selection).
    const doc = useDoc.getState();
    expect(doc.stations.b.rotation).toBe(0);
    expect(doc.stations.c.rotation).toBe(0);
  });
});
