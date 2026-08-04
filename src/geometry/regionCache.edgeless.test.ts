import { describe, it, expect } from 'vitest';
import { regionsFor, regionGeometrySig, type GeometrySlice } from '../geometry/regionCache';
import { buildBandGeometry, buildStopMarkers } from '../geometry/interlining';
import { buildOverlapRegions } from '../geometry/lineRegions';
import { makeLine, makeStation, makeStop } from '../test/fixtures';
import { useDoc } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';

/**
 * A just-created line, right after its FIRST station placement: 1 station,
 * 1 stop, 0 edges. Its stop marker is a `width` x `width` square, which
 * buildStopMarkers emits and buildLineBodies folds into the line's body — so
 * it DOES take part in the overlap arrangement even with no edges.
 *
 * L1: s1(0,0) -> s2(200,0), width 14 (an edged corridor).
 * L2: s3(100,0) only, edgeless, width = `w2`, sitting on top of L1.
 */
const geom = (w2: number): GeometrySlice => ({
  stations: {
    s1: makeStation({ id: 's1', x: 0, y: 0, stops: [makeStop('L1')] }),
    s2: makeStation({ id: 's2', x: 200, y: 0, stops: [makeStop('L1')] }),
    s3: makeStation({ id: 's3', x: 100, y: 0, stops: [makeStop('L2')] }),
  },
  lines: {
    L1: makeLine({ id: 'L1', stations: ['s1', 's2'], width: 14 }),
    L2: makeLine({ id: 'L2', stations: ['s3'], edges: [], width: w2 }),
  },
  lineCircles: {},
});

/** What regionsFor WOULD compute with no cache — the ground truth. */
const uncachedFaces = (g: GeometrySlice) => {
  const bands = buildBandGeometry(g.stations, g.lines);
  const markers = buildStopMarkers(g.stations, g.lines, [], bands);
  return buildOverlapRegions(bands, markers, []);
};

describe('regionGeometrySig: edgeless line with a stop', () => {
  it('sanity: the edgeless line really does produce an overlap face that grows with its width', () => {
    const narrow = uncachedFaces(geom(14));
    const wide = uncachedFaces(geom(28));
    expect(narrow).toHaveLength(1);
    expect(wide).toHaveLength(1);
    expect(narrow[0].lineIds).toEqual(['L1', 'L2']);
    // 14x14 square inside the 14-tall corridor vs a 28-wide one clipped to it.
    expect(narrow[0].area).toBeCloseTo(196, 0);
    expect(wide[0].area).toBeCloseTo(392, 0);
  });

  it('changes when an edgeless line width changes (its stop marker is real geometry)', () => {
    expect(regionGeometrySig(geom(28))).not.toBe(regionGeometrySig(geom(14)));
  });

  it('regionsFor does not serve a stale face after an edgeless line width edit', () => {
    regionsFor(geom(14)); // user placed the first stop; faces get cached
    const served = regionsFor(geom(28)); // user then sets width 14 -> 28
    const truth = uncachedFaces(geom(28));
    expect(served.faces).toHaveLength(1);
    expect(served.faces[0].area).toBeCloseTo(truth[0].area, 0);
    expect(served.faces[0].bbox.x0).toBeCloseTo(truth[0].bbox.x0, 0);
    expect(served.faces[0].bbox.x1).toBeCloseTo(truth[0].bbox.x1, 0);
  });

  it('the real setLineWidth store action invalidates the served face too', () => {
    const g = geom(14);
    useDoc.setState({
      ...useDoc.getState(),
      ...DEFAULT_DOC,
      stations: g.stations,
      lines: g.lines,
      lineOrder: ['L1', 'L2'],
    });
    // Render/reconcile has already cached the pre-edit faces.
    regionsFor({
      stations: useDoc.getState().stations,
      lines: useDoc.getState().lines,
      lineCircles: {},
    });
    useDoc.getState().setLineWidth('L2', 28);
    const s = useDoc.getState();
    expect(s.lines.L2.width).toBe(28); // the edit really landed
    const served = regionsFor({ stations: s.stations, lines: s.lines, lineCircles: {} });
    expect(served.faces[0].area).toBeCloseTo(392, 0);
  });
});
