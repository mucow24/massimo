import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyMirrorSync,
  computeMirrorHoles,
  diffMirror,
  packHoles,
  unpackHoles,
  type RegionMirror,
} from './regionFrame';
import { regionsFor, resetRegionCache, type GeometrySlice } from '../geometry/regionCache';
import {
  buildExclusionHoles,
  mintAnchors,
  resetExclusionHoleCache,
  resolveRegionWinners,
} from '../geometry/lineRegions';
import { buildBandGeometry, buildStopMarkers } from '../geometry/interlining';
import { buildRegionsIncremental } from '../geometry/regionIncremental';
import { lineStrokeRailWidth, lineStrokeWidthOf } from '../model/lineStroke';
import { lineWidthOf } from '../model/lineWidth';
import { makeLine, makeStation, makeStop } from '../test/fixtures';
import type { Line, LineId, RegionAssignment, Station } from '../model/types';
import type { Ring } from '../geometry/clip';

const station = (id: string, x: number, y: number, lineIds: string[]): Station =>
  makeStation({ id, x, y, stops: lineIds.map((l) => makeStop(l)) });

/** l1 horizontal, l2 vertical crossing it at x=200 — one overlap face. */
const crossMirror = (): RegionMirror => {
  const stations: Record<string, Station> = {};
  for (const s of [
    station('s1', 0, 0, ['l1']),
    station('s2', 400, 0, ['l1']),
    station('s3', 200, -50, ['l2']),
    station('s4', 200, 50, ['l2']),
  ]) {
    stations[s.id] = s;
  }
  // Casing (strokeWidth) makes railWOf nonzero, so the parity tests exercise
  // the rail-width input to the hole dilation — with the default 0 a broken
  // railWOf would be invisible here.
  const lines: Record<string, Line> = {
    l1: makeLine({ id: 'l1', stations: ['s1', 's2'], strokeWidth: 4 }),
    l2: makeLine({ id: 'l2', stations: ['s3', 's4'], strokeWidth: 4 }),
  };
  return {
    stations,
    lines,
    lineCircles: {},
    lineOrder: ['l1', 'l2'],
    regionAssignments: {},
  };
};

/** An assignment putting l2 on top of the (only) overlap face — an override
 *  relative to lineOrder ['l1','l2'], so exclusion holes must exist. */
const assignL2OnTop = (mirror: RegionMirror): RegionAssignment => {
  const { bands, faces } = regionsFor({
    stations: mirror.stations,
    lines: mirror.lines,
    lineCircles: mirror.lineCircles,
  });
  expect(faces.length).toBeGreaterThan(0);
  return { id: 'r1', lineId: 'l2', lines: faces[0].lineIds, anchors: mintAnchors(faces[0], bands) };
};

/**
 * The synchronous path, cache-free and seed-free: exactly what MapCanvas's
 * chain produces for this geometry, with no cross-frame state involved. The
 * worker path must equal this byte for byte.
 */
const referenceHoles = (mirror: RegionMirror): Map<LineId, Ring[]> => {
  const g: GeometrySlice = {
    stations: mirror.stations,
    lines: mirror.lines,
    lineCircles: mirror.lineCircles,
  };
  const bands = buildBandGeometry(g.stations, g.lines, g.lineCircles);
  const markers = buildStopMarkers(g.stations, g.lines, [], bands, g.lineCircles);
  const built = buildRegionsIncremental(bands, markers, null);
  const winners = resolveRegionWinners(
    built.faces,
    mirror.regionAssignments,
    bands,
    mirror.lineOrder,
  );
  const railWOf = (lineId: LineId) => {
    const line = mirror.lines[lineId];
    return line ? lineStrokeRailWidth(lineStrokeWidthOf(line), lineWidthOf(line)) : 0;
  };
  return buildExclusionHoles(
    built.faces,
    winners,
    mirror.lineOrder,
    bands,
    markers,
    railWOf,
    built.slivers,
  );
};

beforeEach(() => {
  resetRegionCache();
  resetExclusionHoleCache();
});

describe('diffMirror / applyMirrorSync', () => {
  it('returns null when nothing the pipeline reads has changed', () => {
    const m = crossMirror();
    expect(diffMirror(m, { ...m })).toBeNull();
  });

  it('carries ONLY the changed records, and apply reconstructs the slice', () => {
    const prev = crossMirror();
    const moved = { ...prev.stations.s1, x: 10, y: 20 };
    const cur: RegionMirror = { ...prev, stations: { ...prev.stations, s1: moved } };

    const sync = diffMirror(cur, prev);
    expect(sync).not.toBeNull();
    // The payload is the one changed record — not the whole collection.
    expect(Object.keys(sync!.stations!)).toEqual(['s1']);
    expect(sync!.lines).toBeUndefined();
    expect(sync!.lineOrder).toBeUndefined();

    expect(applyMirrorSync(prev, sync!)).toEqual(cur);
  });

  it('expresses deletions, and a null prev sends everything', () => {
    const prev = crossMirror();
    const { s4: _, ...rest } = prev.stations;
    const cur: RegionMirror = { ...prev, stations: rest };
    const sync = diffMirror(cur, prev);
    expect(sync!.removed?.stations).toEqual(['s4']);
    expect(applyMirrorSync(prev, sync!)).toEqual(cur);

    const cold = diffMirror(cur, null);
    expect(cold!.stations).toBe(cur.stations);
    expect(cold!.lineOrder).toBe(cur.lineOrder);
  });

  it('sees a record change no matter who changed it (the ring-capture shape)', () => {
    // A capture rewrites circleId + stops on the station AND the circle's
    // bound set — three records across two collections in one write. The diff
    // must carry all of them without knowing a capture happened.
    const prev = crossMirror();
    const captured = {
      ...prev.stations.s3,
      circleId: 'c1',
      stops: prev.stations.s3.stops.map((c) => ({ ...c, viaCircle: true })),
    };
    const cur: RegionMirror = {
      ...prev,
      stations: { ...prev.stations, s3: captured },
      lineCircles: { c1: { id: 'c1', x: 200, y: 0, radius: 40 } },
    };
    const sync = diffMirror(cur, prev)!;
    expect(Object.keys(sync.stations!)).toEqual(['s3']);
    expect(Object.keys(sync.lineCircles!)).toEqual(['c1']);
    expect(applyMirrorSync(prev, sync)).toEqual(cur);
  });
});

describe('packHoles / unpackHoles', () => {
  it('round-trips exactly, preserving line order and ring boundaries', () => {
    const holes = new Map<LineId, Ring[]>([
      [
        'l1',
        [
          [
            { x: 0.1, y: -2.30000000000004 },
            { x: 5, y: 6 },
            { x: 7.25, y: 8 },
          ],
          [
            { x: 100, y: 200 },
            { x: 300, y: 400 },
          ],
        ],
      ],
      ['l2', [[{ x: -1e-9, y: 12345.6789 }]]],
    ]);
    const unpacked = unpackHoles(packHoles(holes));
    expect(unpacked).toEqual(holes);
    expect([...unpacked.keys()]).toEqual(['l1', 'l2']);
  });

  it('an empty map round-trips', () => {
    expect(unpackHoles(packHoles(new Map()))).toEqual(new Map());
  });
});

describe('computeMirrorHoles — parity with the synchronous path', () => {
  it('cold: equals the cache-free reference, and the holes are real', () => {
    const mirror = crossMirror();
    mirror.regionAssignments = { r1: assignL2OnTop(mirror) };
    const expected = referenceHoles(mirror);
    // A fixture yielding no holes would make this test vacuous.
    expect(expected.size).toBeGreaterThan(0);

    resetRegionCache();
    resetExclusionHoleCache();
    const holes = unpackHoles(packHoles(computeMirrorHoles(mirror)));
    expect(holes).toEqual(expected);
  });

  it('across a drag: every frame equals the reference for that geometry', () => {
    let mirror = crossMirror();
    mirror.regionAssignments = { r1: assignL2OnTop(mirror) };
    resetRegionCache();
    resetExclusionHoleCache();

    // Warm start (the pre-drag state), then three frames arriving as diffs —
    // the worker's cross-frame caches (incremental seed, hole cache) are live
    // between frames, and every frame must still be a pure function of its
    // snapshot.
    computeMirrorHoles(mirror);
    for (const dx of [4, 9, 15]) {
      const prev = mirror;
      const moved = { ...prev.stations.s3, x: 200 + dx };
      const cur = { ...prev, stations: { ...prev.stations, s3: moved } };
      const sync = diffMirror(cur, prev)!;
      mirror = applyMirrorSync(mirror, sync);

      const holes = unpackHoles(packHoles(computeMirrorHoles(mirror)));
      expect(holes).toEqual(referenceHoles(mirror));
      expect(holes.size).toBeGreaterThan(0);
    }
  });
});
