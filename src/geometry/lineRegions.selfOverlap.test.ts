import { describe, it, expect } from 'vitest';
import { buildBands, buildStopMarkers } from './interlining';
import { buildOverlapRegions, clipperQuant, type RegionFace } from './lineRegions';
import { buildRegionsIncremental } from './regionIncremental';
import { faceArea } from './clip';
import { makeDoc, makeLine, makeStation, makeStop } from '../test/fixtures';
import type { MapDoc } from '../model/types';

// ---------------------------------------------------------------------------
// Self-overlap faces: where a line's ARMS overlap (a branch mouth, a station
// self-crossing), the arrangement now carries real clickable faces, covered by
// per-arm cover ids — exactly the faces the two-line workaround (model the
// branch as a separate line) has always produced. The golden claim: the real
// branch and the workaround yield THE SAME face geometry.
// ---------------------------------------------------------------------------

const hStop = (id: string) => makeStop(id, { orientation: 'auto-horizontal' });
const vStop = (id: string) => makeStop(id, { orientation: 'auto-vertical' });

/** Trunk a—j—c with a branch j—d, as ONE line. */
const branchDoc = () =>
  makeDoc({
    stations: [
      makeStation({ id: 'j', x: 0, y: 0, stops: [hStop('l1')] }),
      makeStation({ id: 'a', x: -120, y: 0, stops: [hStop('l1')] }),
      makeStation({ id: 'c', x: 120, y: 0, stops: [hStop('l1')] }),
      makeStation({ id: 'd', x: 120, y: -120, stops: [vStop('l1')] }),
    ],
    lines: [makeLine({ id: 'l1', color: '#c00', edges: ['a|j', 'c|j', 'd|j'] })],
  });

/** The SAME shape as two lines: trunk l1, branch lb, stop cells coincident. */
const workaroundDoc = () =>
  makeDoc({
    stations: [
      makeStation({ id: 'j', x: 0, y: 0, stops: [hStop('l1'), hStop('lb')] }),
      makeStation({ id: 'a', x: -120, y: 0, stops: [hStop('l1')] }),
      makeStation({ id: 'c', x: 120, y: 0, stops: [hStop('l1')] }),
      makeStation({ id: 'd', x: 120, y: -120, stops: [vStop('lb')] }),
    ],
    lines: [
      makeLine({ id: 'l1', color: '#c00', edges: ['a|j', 'c|j'] }),
      makeLine({ id: 'lb', color: '#c00', edges: ['d|j'] }),
    ],
  });

const facesFor = (doc: MapDoc): RegionFace[] =>
  buildOverlapRegions(buildBands(doc.stations, doc.lines, doc.lineOrder), []);

/** Rotation- and direction-invariant content key of one face's rings. */
const keyOf = (f: RegionFace): string =>
  f.face
    .map((ring) => {
      const pts = ring.map((p) => `${clipperQuant(p.x)},${clipperQuant(p.y)}`);
      const variants: string[] = [];
      for (const seq of [pts, [...pts].reverse()]) {
        for (let s = 0; s < seq.length; s++) {
          variants.push([...seq.slice(s), ...seq.slice(0, s)].join(' '));
        }
      }
      return variants.sort()[0];
    })
    .sort()
    .join('|');

describe('self-overlap faces (branch mouths)', () => {
  it('a branching line yields a mouth face covered by its two arms', () => {
    const faces = facesFor(branchDoc());
    expect(faces.length).toBeGreaterThan(0);
    // Every face here is a self face of l1: two distinct per-arm cover ids.
    for (const f of faces) {
      expect(f.lineIds).toHaveLength(2);
      expect(new Set(f.lineIds).size).toBe(2);
      for (const id of f.lineIds) expect(id).toContain('l1');
    }
  });

  it('golden parity: the real branch equals the two-line workaround, geometrically', () => {
    const branch = facesFor(branchDoc());
    const workaround = facesFor(workaroundDoc());
    expect(branch.length).toBe(workaround.length);
    expect(branch.map(keyOf).sort()).toEqual(workaround.map(keyOf).sort());
    const area = (fs: RegionFace[]) => fs.reduce((s, f) => s + faceArea(f.face), 0);
    expect(area(branch)).toBeCloseTo(area(workaround), 6);
  });

  it('a corner-only line yields NO self faces, however many bends it has', () => {
    const doc = makeDoc({
      stations: [
        makeStation({ id: 'a', x: -120, y: 0, stops: [hStop('l1')] }),
        makeStation({ id: 'b', x: 0, y: 0, stops: [hStop('l1')] }),
        makeStation({ id: 'c', x: 0, y: -120, stops: [vStop('l1')] }),
        makeStation({ id: 'd', x: 120, y: -120, stops: [hStop('l1')] }),
        makeStation({ id: 'e', x: 120, y: -240, stops: [vStop('l1')] }),
      ],
      lines: [makeLine({ id: 'l1', color: '#c00', edges: ['a|b', 'b|c', 'c|d', 'd|e'] })],
    });
    expect(facesFor(doc)).toEqual([]);
  });

  it('covers stay bare line ids where only one arm is present', () => {
    // A second line crossing the trunk far from the junction: that face's
    // cover must read exactly [l1, lx] — no arm spelling leaks out of the
    // self-overlapped component.
    const base = branchDoc();
    const doc = makeDoc({
      stations: [
        ...Object.values(base.stations),
        makeStation({ id: 'n', x: -60, y: -100, stops: [vStop('lx')] }),
        makeStation({ id: 's', x: -60, y: 100, stops: [vStop('lx')] }),
      ],
      lines: [base.lines['l1'], makeLine({ id: 'lx', color: '#00c', edges: ['n|s'] })],
    });
    const faces = facesFor(doc);
    const atCrossing = faces.filter((f) => f.bbox.x0 < -40 && f.bbox.x1 > -80);
    expect(atCrossing.length).toBeGreaterThan(0);
    for (const f of atCrossing) expect(f.lineIds).toEqual(['l1', 'lx']);
  });

  it('the incremental build matches the reference, cold and warm', () => {
    const doc = branchDoc();
    const bands = buildBands(doc.stations, doc.lines, doc.lineOrder);
    const ref = buildOverlapRegions(bands, []);
    const cold = buildRegionsIncremental(bands, [], null);
    expect(cold.faces.map(keyOf).sort()).toEqual(ref.map(keyOf).sort());
    const warm = buildRegionsIncremental(bands, [], cold.state);
    expect(warm.reused).toBe(true);
    expect(warm.faces.map(keyOf).sort()).toEqual(ref.map(keyOf).sort());
  });

  it('stop markers do not manufacture extra self faces', () => {
    const doc = branchDoc();
    const bands = buildBands(doc.stations, doc.lines, doc.lineOrder);
    const markers = buildStopMarkers(doc.stations, doc.lines, doc.lineOrder);
    const withMarkers = buildOverlapRegions(bands, markers);
    // The mouth face is still there…
    expect(withMarkers.length).toBeGreaterThan(0);
    // …and every self-covered face still sits at the junction, not at the
    // plain stops the markers decorate.
    for (const f of withMarkers) {
      if (f.lineIds.some((id) => id !== 'l1' && id.includes('l1'))) {
        expect(f.bbox.x0).toBeLessThan(40);
        expect(f.bbox.x1).toBeGreaterThan(-40);
      }
    }
  });
});
