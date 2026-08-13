import { describe, it, expect, beforeEach } from 'vitest';
import { alignTargets, liveAlignTargets, textLabelAlignPoints } from './snapTargets';
import { stopPosWorld } from '../../geometry/interlining';
import { svgImageCorners } from '../../geometry/svgImage';
import { measureTextLabel } from '../../geometry/textMeasure';
import { textLabelAlignCorners } from '../../geometry/stationBoundary';
import { STOP_SIZE } from '../../geometry/orientation';
import { useDoc } from '../../state/store';
import { useViewportStore } from '../../state/viewportStore';
import {
  makeDoc,
  makePolygon,
  makeRouteBullet,
  makeStation,
  makeStop,
  makeSvgImage,
  makeTextLabel,
} from '../../test/fixtures';

describe('textLabelAlignPoints', () => {
  it('emits the four alignment-box corners plus its center for an unrotated label', () => {
    const label = makeTextLabel({ id: 't0', x: 50, y: 40 });
    const m = measureTextLabel(label);
    expect(m.width).toBeGreaterThan(0); // guard: measurement must be live in tests
    const corners = textLabelAlignCorners(label);
    const pts = textLabelAlignPoints(label);
    expect(pts).toHaveLength(5);
    expect(pts.slice(0, 4)).toEqual(corners);
    // The 5th point is the ALIGNMENT box's center — midway between TL and BR
    // (not label.y: the box sits off-center in the leaded line box).
    expect(pts[4].x).toBeCloseTo((corners[0].x + corners[2].x) / 2, 6);
    expect(pts[4].y).toBeCloseTo((corners[0].y + corners[2].y) / 2, 6);
  });

  it('rotates with the label (rotation 2 = 90° clockwise)', () => {
    const label = makeTextLabel({ id: 't0', x: 50, y: 40, rotation: 2 });
    const corners = textLabelAlignCorners(label);
    const pts = textLabelAlignPoints(label);
    expect(pts.slice(0, 4)).toEqual(corners);
    expect(pts[4].x).toBeCloseTo((corners[0].x + corners[2].x) / 2, 6);
    expect(pts[4].y).toBeCloseTo((corners[0].y + corners[2].y) / 2, 6);
  });
});

describe('alignTargets', () => {
  it('emits stop centers for stop-bearing stations and the anchor for stopless ones', () => {
    const bare = makeStation({ id: 'a', x: 12, y: -7 });
    const withStop = makeStation({ id: 'b', x: 100, y: 50, stops: [makeStop('L1')] });
    const out = alignTargets(makeDoc({ stations: [bare, withStop] }));
    expect(out).toContainEqual({ x: 12, y: -7 });
    expect(out).toContainEqual(stopPosWorld(withStop.stops[0], withStop, {}));
    expect(out).toHaveLength(2);
  });

  it('emits each hosted transfer anchor cell alongside the stop centres', () => {
    const st = makeStation({
      id: 'a',
      x: 100,
      y: 50,
      stops: [makeStop('L1')],
      transferAnchors: [{ id: 'an0', row: 0, col: 2 }],
    });
    const out = alignTargets(makeDoc({ stations: [st] }));
    expect(out).toContainEqual(stopPosWorld(st.stops[0], st, {}));
    expect(out).toContainEqual({ x: 100 + 2 * STOP_SIZE, y: 50 });
    expect(out).toHaveLength(2);
  });

  it('rotates a hosted anchor with its station (rotation 2 = 90° clockwise)', () => {
    const st = makeStation({
      id: 'a',
      x: 100,
      y: 50,
      rotation: 2,
      transferAnchors: [{ id: 'an0', row: 0, col: 2 }],
    });
    // Stopless: the station's own point, then the anchor cell two cells along
    // +x locally, which 90° CW in the y-down frame swings onto +y.
    const out = alignTargets(makeDoc({ stations: [st] }));
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ x: 100, y: 50 });
    expect(out[1].x).toBeCloseTo(100, 6);
    expect(out[1].y).toBeCloseTo(50 + 2 * STOP_SIZE, 6);
  });

  it("drops a station's hosted anchors with the station itself", () => {
    const st = makeStation({
      id: 's0',
      stops: [makeStop('L1')],
      transferAnchors: [{ id: 'an0', row: 0, col: 2 }],
    });
    expect(alignTargets(makeDoc({ stations: [st] }), { stationIds: new Set(['s0']) })).toEqual([]);
  });

  it('emits every polygon vertex', () => {
    const p0 = makePolygon({
      id: 'p0',
      vertices: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    });
    const out = alignTargets(makeDoc({ polygons: [p0] }));
    expect(out).toContainEqual({ x: 0, y: 0 });
    expect(out).toContainEqual({ x: 10, y: 0 });
    expect(out).toHaveLength(2);
  });

  it('emits all four rotated corners of every svg image', () => {
    const img = makeSvgImage({ id: 'i0', x: 200, y: 100, rotation: 30 });
    expect(alignTargets(makeDoc({ svgImages: [img] }))).toEqual(svgImageCorners(img));
  });

  it('emits the five label points per text label', () => {
    const label = makeTextLabel({ id: 't0', x: 50, y: 40 });
    expect(alignTargets(makeDoc({ textLabels: [label] }))).toEqual(textLabelAlignPoints(label));
  });

  it('emits route bullet centers', () => {
    const out = alignTargets(
      makeDoc({ routeBullets: [makeRouteBullet({ id: 'b0', x: 7, y: 8 })] }),
    );
    expect(out).toEqual([{ x: 7, y: 8 }]);
  });

  it('excludes items per kind so dragged/co-selected items never self-target', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 's0', x: 1, y: 1 }), makeStation({ id: 's1', x: 2, y: 2 })],
      polygons: [
        makePolygon({ id: 'p0', vertices: [{ x: 3, y: 3 }] }),
        makePolygon({ id: 'p1', vertices: [{ x: 4, y: 4 }] }),
      ],
      svgImages: [makeSvgImage({ id: 'i0' })],
      textLabels: [makeTextLabel({ id: 't0', x: 60, y: 60 })],
      routeBullets: [makeRouteBullet({ id: 'b0', x: 5, y: 5 })],
    });
    const out = alignTargets(doc, {
      stationIds: new Set(['s0']),
      polygonIds: new Set(['p1']),
      svgImageIds: new Set(['i0']),
      labelIds: new Set(['t0']),
      bulletIds: new Set(['b0']),
    });
    expect(out).toEqual([
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ]);
  });
});

describe('liveAlignTargets — the lines/stations toggle', () => {
  const station = makeStation({ id: 'a', x: 300, y: 300, stops: [makeStop('L1')] });
  const polygon = makePolygon({
    id: 'p1',
    vertices: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ],
  });

  beforeEach(() => {
    useDoc.setState({
      ...useDoc.getState(),
      ...makeDoc({ stations: [station], polygons: [polygon] }),
    });
    useViewportStore.setState({ showNetwork: true });
  });

  it('offers station stops as targets while the network is shown', () => {
    const out = liveAlignTargets();
    expect(out).toContainEqual(stopPosWorld(station.stops[0], station, {}));
    expect(out).toContainEqual({ x: 10, y: 10 });
  });

  it('drops station targets while the network is hidden, keeping the background art', () => {
    // Dragging a polygon shouldn't align it against — or draw a guide line to —
    // a station that isn't on the canvas. The art the toggle exposes still
    // snaps to itself, so only the station points go.
    useViewportStore.setState({ showNetwork: false });
    const out = liveAlignTargets();
    expect(out).not.toContainEqual(stopPosWorld(station.stops[0], station, {}));
    expect(out).toEqual(polygon.vertices);
  });

  it('honours exclusions the same as alignTargets', () => {
    expect(liveAlignTargets({ polygonIds: new Set(['p1']) })).toEqual(
      alignTargets(useDoc.getState(), { polygonIds: new Set(['p1']) }),
    );
  });
});

describe('liveAlignTargets — the per-kind View toggles', () => {
  // One of each snapping kind, at points nothing else occupies, so a missing
  // gate shows up as a specific leftover rather than a count.
  const station = makeStation({ id: 'a', x: 300, y: 300, stops: [makeStop('L1')] });
  const polygon = makePolygon({
    id: 'p1',
    vertices: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ],
  });
  const bullet = makeRouteBullet({ id: 'b1', x: 700, y: 700 });
  const label = makeTextLabel({ id: 'g1', x: 900, y: 900 });
  const image = makeSvgImage({ id: 'i1', x: 1200, y: 1200 });

  beforeEach(() => {
    useDoc.setState({
      ...useDoc.getState(),
      ...makeDoc({
        stations: [station],
        polygons: [polygon],
        routeBullets: [bullet],
        textLabels: [label],
        svgImages: [image],
      }),
    });
    useViewportStore.setState({
      showNetwork: true,
      showAnchors: false,
      showPolygons: true,
      showRouteBullets: true,
      showTextLabels: true,
      showSvgImages: true,
    });
  });

  it('offers every visible kind as a target', () => {
    const out = liveAlignTargets();
    expect(out).toContainEqual({ x: 10, y: 10 }); // polygon vertex
    expect(out).toContainEqual({ x: 700, y: 700 }); // bullet centre
    expect(out).toContainEqual(textLabelAlignPoints(label)[4]); // label centre
    expect(out).toContainEqual(svgImageCorners(image)[0]);
  });

  it.each([
    ['showPolygons' as const, { x: 10, y: 10 }],
    ['showRouteBullets' as const, { x: 700, y: 700 }],
    ['showTextLabels' as const, textLabelAlignPoints(label)[4]],
  ])('drops %s targets while that kind is hidden', (flag, point) => {
    // The pool is geometric, straight off the doc, so hiding a kind doesn't
    // remove it by itself — snapping to one draws a guide pointing at bare
    // canvas.
    useViewportStore.setState({ [flag]: false });
    expect(liveAlignTargets()).not.toContainEqual(point);
    // The other kinds stay: a gate wired too broadly shows up here.
    expect(liveAlignTargets()).toContainEqual(stopPosWorld(station.stops[0], station, {}));
  });

  it('drops image corners while images are hidden', () => {
    expect(liveAlignTargets()).toContainEqual(svgImageCorners(image)[0]); // precondition
    useViewportStore.setState({ showSvgImages: false });
    expect(liveAlignTargets()).not.toContainEqual(svgImageCorners(image)[0]);
  });
});

describe('liveAlignTargets — the anchor toggle', () => {
  const station = makeStation({
    id: 'a',
    x: 300,
    y: 300,
    stops: [makeStop('L1')],
    transferAnchors: [{ id: 'an0', row: 0, col: 2 }],
  });
  const hosted = { x: 300 + 2 * STOP_SIZE, y: 300 };
  const free = { x: -40, y: -40 };

  beforeEach(() => {
    useDoc.setState({
      ...useDoc.getState(),
      ...makeDoc({ stations: [station], transferAnchors: [{ id: 'free0', ...free }] }),
    });
    useViewportStore.setState({ showNetwork: true, showAnchors: true });
  });

  it('offers hosted and free anchors as targets while anchors are shown', () => {
    const out = liveAlignTargets();
    expect(out).toContainEqual(hosted);
    expect(out).toContainEqual(free);
  });

  it('drops both while anchors are hidden, keeping the station stops', () => {
    // Same rule, and the same reason, as the network toggle above: a guide to
    // an anchor that isn't on the canvas is a guide pointing at bare canvas.
    // Only the anchor points go — the station's stops are still visible.
    useViewportStore.setState({ showAnchors: false });
    expect(liveAlignTargets()).toEqual([stopPosWorld(station.stops[0], station, {})]);
  });
});
