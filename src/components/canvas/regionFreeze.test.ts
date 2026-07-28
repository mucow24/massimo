import { describe, it, expect } from 'vitest';
import { captureUnits, dirtyBoxesSince, retainFaceHoles } from './regionFreeze';
import type { FaceHoles, RegionFace, RegionSliver } from '../../geometry/lineRegions';
import { buildBandGeometry, buildStopMarkers } from '../../geometry/interlining';
import { makeLine, makeStation, makeStop } from '../../test/fixtures';

const box = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });

const face = (b: ReturnType<typeof box>): RegionFace =>
  ({ key: '', lineIds: [], face: [], bbox: b, area: 0, spans: new Map() }) as RegionFace;

const sliver = (b: ReturnType<typeof box>): RegionSliver =>
  ({ lineIds: [], face: [], bbox: b }) as RegionSliver;

const entry = (faceIndex: number, b: ReturnType<typeof box>, reach = 1): FaceHoles => ({
  faceIndex,
  bbox: b,
  reach,
  holes: new Map([['L', []]]),
});

describe('dirtyBoxesSince', () => {
  const geomFor = (x3: number) => {
    const stations = {
      a: makeStation({ id: 'a', x: 0, y: 0, stops: [makeStop('L')] }),
      b: makeStation({ id: 'b', x: 200, y: 0, stops: [makeStop('L')] }),
      c: makeStation({ id: 'c', x: x3, y: 200, stops: [makeStop('M')] }),
      d: makeStation({ id: 'd', x: x3, y: 400, stops: [makeStop('M')] }),
    };
    const lines = {
      L: makeLine({ id: 'L', stations: ['a', 'b'] }),
      M: makeLine({ id: 'M', stations: ['c', 'd'] }),
    };
    const bands = buildBandGeometry(stations, lines);
    const markers = buildStopMarkers(stations, lines, [], bands);
    return { bands, markers };
  };

  it('is empty when nothing moved', () => {
    const g = geomFor(100);
    const frozen = captureUnits(g.bands, g.markers);
    expect(dirtyBoxesSince(frozen, g.bands, g.markers)).toEqual([]);
  });

  it('a moved corridor contributes both its old and new footprint', () => {
    const g0 = geomFor(100);
    const frozen = captureUnits(g0.bands, g0.markers);
    const g1 = geomFor(130);
    const dirty = dirtyBoxesSince(frozen, g1.bands, g1.markers);
    expect(dirty.length).toBeGreaterThan(0);
    // Old (x≈100) and new (x≈130) territory both covered.
    expect(dirty.some((d) => d.x0 <= 100 && d.x1 >= 100)).toBe(true);
    expect(dirty.some((d) => d.x0 <= 130 && d.x1 >= 130)).toBe(true);
    // The untouched line's corridor (y=0 horizontal) is NOT dirty.
    expect(dirty.every((d) => d.y1 >= 100)).toBe(true);
  });
});

describe('retainFaceHoles', () => {
  const faces = [face(box(0, 0, 20, 20)), face(box(500, 0, 520, 20)), face(box(540, 0, 560, 20))];
  const entries = [entry(0, box(0, 0, 20, 20)), entry(1, box(500, 0, 520, 20))];

  it('returns the same array by identity when nothing is dirty', () => {
    const out = retainFaceHoles(entries, faces, [], []);
    expect(out).toBe(entries);
  });

  it('drops an entry whose own neighborhood is dirty, keeps the far one', () => {
    const out = retainFaceHoles(entries, faces, [], [box(15, 15, 30, 30)]);
    expect(out.map((e) => e.faceIndex)).toEqual([1]);
  });

  it('drops an entry when a shield-range NEIGHBOR face moved, even though the entry itself did not', () => {
    // Dirty box overlaps faces[2] (x 540-560) but is far from entry 1's own
    // padded neighborhood only via the neighbor: entry 1 (bbox to x=520,
    // reach 1 -> own pad ~8) does not reach x=541; faces[2] is within
    // shield range (3*reach = 3 > gap 20? no — gap is 20). Use a closer
    // neighbor: rebuild with faces[2] at x 522.
    const nearFaces = [faces[0], faces[1], face(box(522, 0, 542, 20))];
    const dirty = [box(535, 5, 545, 15)]; // touches only the neighbor face
    const out = retainFaceHoles(entries, nearFaces, [], dirty);
    expect(out.map((e) => e.faceIndex)).toEqual([0]);
  });

  it('drops an entry when an absorbable sliver near it moved', () => {
    // Sliver sits exactly at absorb range of entry 1 (gap 6 = 3x reach);
    // the dirty box touches ONLY the sliver — outside entry 1's own pad
    // (8), so a drop can come only through the sliver dependency.
    const slivers = [sliver(box(526, 0, 534, 10))];
    const dirty = [box(530, 2, 533, 8)];
    const out = retainFaceHoles(entries, faces, slivers, dirty);
    expect(out.map((e) => e.faceIndex)).toEqual([0]);
  });

  it('keeps everything when the dirt is far from entries, neighbors and slivers', () => {
    const out = retainFaceHoles(
      entries,
      faces,
      [sliver(box(700, 0, 710, 10))],
      [box(900, 900, 910, 910)],
    );
    expect(out).toHaveLength(2);
  });
});
