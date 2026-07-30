import { describe, it, expect, beforeEach, vi } from 'vitest';
import { rotateItemOnContextMenu } from './groupRotate';
import { useDoc, useSelection } from '../../state/store';
import { DEFAULT_DOC } from '../../model/transforms';
import {
  makeDoc,
  makeLineCircle,
  makePolygon,
  makeStation,
  makeStop,
  makeSvgImage,
} from '../../test/fixtures';

// Reset both stores; clear every selection id list so each test sets exactly
// what it needs.
const blankSelection = () =>
  useSelection.setState({
    selectedStationIds: [],
    selectedRouteBulletIds: [],
    selectedLabelIds: [],
    selectedPolygonIds: [],
    selectedSvgImageIds: [],
    selectedLineCircleIds: [],
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

  it('includes a co-selected svg image in the group rotation (no longer left behind)', () => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [makeStation({ id: 'a', x: 0, y: 0, rotation: 0 })],
        svgImages: [makeSvgImage({ id: 'i0', x: 100, y: 0, rotation: 0 })],
      }),
    });
    useSelection.setState({ selectedStationIds: ['a'], selectedSvgImageIds: ['i0'] });

    const rotateSingle = vi.fn();
    rotateItemOnContextMenu({ type: 'station', id: 'a' }, rotateSingle);

    expect(rotateSingle).not.toHaveBeenCalled();
    const doc = useDoc.getState();
    // The svg image orbits 45° CW about the pivot and bumps its rotation by 45.
    expect(doc.svgImages.i0.x).toBeCloseTo(100 * Math.cos(Math.PI / 4), 6);
    expect(doc.svgImages.i0.y).toBeCloseTo(100 * Math.sin(Math.PI / 4), 6);
    expect(doc.svgImages.i0.rotation).toBe(45);
  });

  it('group-rotates when the pivot itself is the svg image', () => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [makeStation({ id: 'a', x: 100, y: 0, rotation: 0 })],
        svgImages: [makeSvgImage({ id: 'i0', x: 0, y: 0, rotation: 10 })],
      }),
    });
    useSelection.setState({ selectedStationIds: ['a'], selectedSvgImageIds: ['i0'] });

    const rotateSingle = vi.fn();
    rotateItemOnContextMenu({ type: 'svgImage', id: 'i0' }, rotateSingle);

    expect(rotateSingle).not.toHaveBeenCalled();
    const doc = useDoc.getState();
    // Pivot image stays put; its rotation steps 10 → 55. The station orbits it.
    expect(doc.svgImages.i0).toMatchObject({ x: 0, y: 0, rotation: 55 });
    expect(doc.stations.a.x).toBeCloseTo(100 * Math.cos(Math.PI / 4), 6);
  });

  it('group-rotates when the pivot is a line circle (its ring carries bound stations)', () => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({ id: 'a', x: 100, y: 0, rotation: 0 }),
          // Bound to c1, on its east point.
          makeStation({
            id: 's1',
            x: 70,
            y: 0,
            rotation: 0,
            circleId: 'c1',
            stops: [makeStop('l1', { viaCircle: true })],
          }),
        ],
        lineCircles: [makeLineCircle({ id: 'c1', x: 0, y: 0, radius: 70 })],
      }),
    });
    useSelection.setState({ selectedStationIds: ['a'], selectedLineCircleIds: ['c1'] });

    const rotateSingle = vi.fn();
    rotateItemOnContextMenu({ type: 'lineCircle', id: 'c1' }, rotateSingle);

    // A circle counts toward the multi-selection, so this is the group path.
    expect(rotateSingle).not.toHaveBeenCalled();
    const doc = useDoc.getState();
    // Pivot ring holds its center; the co-selected station orbits it.
    expect(doc.lineCircles.c1).toMatchObject({ x: 0, y: 0, radius: 70 });
    expect(doc.stations.a.x).toBeCloseTo(100 / Math.SQRT2, 6);
    expect(doc.stations.a.y).toBeCloseTo(100 / Math.SQRT2, 6);
    // The ring's own passenger swings 45° round the rim (it is not selected —
    // it rides because its circle is).
    expect(doc.stations.s1.x).toBeCloseTo(70 / Math.SQRT2, 6);
    expect(doc.stations.s1.y).toBeCloseTo(70 / Math.SQRT2, 6);
  });

  it('does not rotate a locked line circle right-clicked on its own', () => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({
            id: 's1',
            x: 70,
            y: 0,
            rotation: 0,
            circleId: 'c1',
            stops: [makeStop('l1', { viaCircle: true })],
          }),
        ],
        lineCircles: [makeLineCircle({ id: 'c1', x: 0, y: 0, radius: 70, locked: true })],
      }),
    });
    blankSelection();

    const rotateSingle = vi.fn();
    rotateItemOnContextMenu({ type: 'lineCircle', id: 'c1' }, rotateSingle);

    expect(rotateSingle).not.toHaveBeenCalled();
    expect(useDoc.getState().stations.s1).toMatchObject({ x: 70, y: 0, rotation: 0 });
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

  it('does not rotate a locked item right-clicked on its own (rotateSingle suppressed)', () => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({ polygons: [makePolygon({ id: 'p0', locked: true })] }),
    });
    blankSelection();

    const rotateSingle = vi.fn();
    rotateItemOnContextMenu({ type: 'polygon', id: 'p0' }, rotateSingle);

    // A locked item can't be rotated: neither the group path nor rotateSingle fire.
    expect(rotateSingle).not.toHaveBeenCalled();
    const doc = useDoc.getState();
    expect(doc.polygons.p0.vertices).toEqual(makePolygon({ id: 'p0' }).vertices);
  });

  it('does not rotate the group when the right-clicked pivot is locked', () => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [makeStation({ id: 'a', x: 100, y: 0, rotation: 0 })],
        polygons: [makePolygon({ id: 'p0', locked: true })],
      }),
    });
    useSelection.setState({ selectedStationIds: ['a'], selectedPolygonIds: ['p0'] });

    const rotateSingle = vi.fn();
    rotateItemOnContextMenu({ type: 'polygon', id: 'p0' }, rotateSingle);

    expect(rotateSingle).not.toHaveBeenCalled();
    // Neither the locked pivot nor the co-selected station moves.
    const doc = useDoc.getState();
    expect(doc.stations.a).toMatchObject({ x: 100, y: 0, rotation: 0 });
  });

  it('skips a locked co-selected member while rotating the rest of the group', () => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({ id: 'a', x: 0, y: 0, rotation: 0 }),
          makeStation({ id: 'b', x: 100, y: 0, rotation: 0 }),
        ],
        polygons: [makePolygon({ id: 'p0', locked: true })],
      }),
    });
    useSelection.setState({
      selectedStationIds: ['a', 'b'],
      selectedPolygonIds: ['p0'],
    });

    const rotateSingle = vi.fn();
    rotateItemOnContextMenu({ type: 'station', id: 'a' }, rotateSingle);

    expect(rotateSingle).not.toHaveBeenCalled();
    const doc = useDoc.getState();
    // Unlocked members rotate as usual...
    expect(doc.stations.b.rotation).toBe(1);
    expect(doc.stations.b.x).toBeCloseTo(100 * Math.cos(Math.PI / 4), 6);
    // ...but the locked polygon is left untouched.
    expect(doc.polygons.p0.vertices).toEqual(makePolygon({ id: 'p0' }).vertices);
  });
});
